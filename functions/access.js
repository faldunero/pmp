/**
 * Acceso de alumnos al simulador (gating freemium + suscripción).
 *
 * Reglas de negocio:
 *   - Profesor / admin → siempre tienen acceso ilimitado.
 *   - Alumno con acceso_validUntil > hoy → tiene acceso pago vigente.
 *   - Alumno sin acceso pago vigente → entra al modo free trial, configurable
 *     por el admin desde el panel de mantenimiento.
 *
 * Modos de free trial (controlados por config/free_trial):
 *   - "una_vez": el alumno puede hacer N simulacros gratuitos en total
 *     (donde N = "intentosTotales", default 1). Una vez consumidos, expira.
 *   - "por_dias": el alumno tiene acceso libre durante D días desde su
 *     fecha de registro (donde D = "diasGratis"). No hay contador, solo
 *     fecha. Expirado el plazo, necesita pagar.
 *   - "ilimitado": acceso libre sin restricción (modo demo / pre-launch).
 *
 * En todos los modos, el admin define qué tamaños están permitidos durante
 * el trial (tamanosPermitidos: [20, 40, ...]). Los simulacros más grandes
 * siempre requieren plan pagado.
 *
 * Estos datos viven en usuarios/{uid}:
 *   - acceso_validUntil          (ISO string)         escrito por checkout PayPal
 *   - simulacros_gratis_usados   (number)             escrito por checkAndConsume
 *   - fechaRegistro              (ISO string)         escrito al crear el perfil
 *
 * Las reglas de Firestore impiden que el cliente modifique estos campos.
 * Solo Cloud Functions (admin SDK) los escribe.
 */
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { assertAuth, assertAdmin } = require("./utils");

// Configuración por defecto (compat con el comportamiento histórico).
// Se usa cuando aún no existe el doc config/free_trial en Firestore.
const DEFAULT_TRIAL_CONFIG = Object.freeze({
    modo: "una_vez",
    intentosTotales: 1,
    diasGratis: 7,
    tamanosPermitidos: [20],
    planesIncluidos: [],
});

const MODOS_VALIDOS = ["una_vez", "por_dias", "ilimitado"];
const TAMANOS_VALIDOS = [20, 40, 60, 80, 100, 120, 140, 180];

// ----------------------------------------------------------------------------
// loadTrialConfig — helper interno. Lee config/free_trial; si falta, default.
// ----------------------------------------------------------------------------
async function loadTrialConfig() {
    const db = admin.firestore();
    const snap = await db.collection("config").doc("free_trial").get();
    if (!snap.exists) return { ...DEFAULT_TRIAL_CONFIG };
    const data = snap.data() || {};
    // Merge con defaults para tolerar config incompleta.
    return {
        modo: MODOS_VALIDOS.includes(data.modo) ? data.modo : DEFAULT_TRIAL_CONFIG.modo,
        intentosTotales: Number.isFinite(data.intentosTotales) && data.intentosTotales > 0
            ? Math.floor(data.intentosTotales)
            : DEFAULT_TRIAL_CONFIG.intentosTotales,
        diasGratis: Number.isFinite(data.diasGratis) && data.diasGratis > 0
            ? Math.floor(data.diasGratis)
            : DEFAULT_TRIAL_CONFIG.diasGratis,
        tamanosPermitidos: Array.isArray(data.tamanosPermitidos) && data.tamanosPermitidos.length > 0
            ? data.tamanosPermitidos.filter((n) => TAMANOS_VALIDOS.includes(Number(n))).map(Number)
            : [...DEFAULT_TRIAL_CONFIG.tamanosPermitidos],
        planesIncluidos: Array.isArray(data.planesIncluidos)
            ? data.planesIncluidos.map((s) => String(s))
            : [...DEFAULT_TRIAL_CONFIG.planesIncluidos],
    };
}

// ----------------------------------------------------------------------------
// getTrialConfig — devuelve la config actual al cliente.
//   - Cualquier autenticado puede leerla (para mostrar la UI correcta al alumno)
//   - El cliente NO se basa en esta config para gating: el server siempre
//     re-valida en checkAndConsumeAccess. La devolvemos para UX nada más.
// ----------------------------------------------------------------------------
exports.getTrialConfig = onCall(
    { region: "us-central1", maxInstances: 10 },
    async (request) => {
        assertAuth(request);
        const config = await loadTrialConfig();
        return { config };
    }
);

// ----------------------------------------------------------------------------
// setTrialConfig — escribe la config. Solo admin.
//   Payload:
//     {
//       modo: "una_vez" | "por_dias" | "ilimitado",
//       intentosTotales?: number   (si modo === una_vez)
//       diasGratis?: number         (si modo === por_dias)
//       tamanosPermitidos: number[] (subset de TAMANOS_VALIDOS)
//       planesIncluidos?: string[]  (SKUs del catálogo PayPal)
//     }
// ----------------------------------------------------------------------------
exports.setTrialConfig = onCall(
    { region: "us-central1", maxInstances: 5 },
    async (request) => {
        assertAdmin(request);

        const data = request.data || {};
        const modo = String(data.modo || "");
        if (!MODOS_VALIDOS.includes(modo)) {
            throw new HttpsError(
                "invalid-argument",
                `modo inválido. Debe ser uno de: ${MODOS_VALIDOS.join(", ")}.`
            );
        }

        const tamanos = Array.isArray(data.tamanosPermitidos) ? data.tamanosPermitidos : [];
        const tamanosLimpios = tamanos
            .map((n) => Number(n))
            .filter((n) => TAMANOS_VALIDOS.includes(n));
        if (tamanosLimpios.length === 0) {
            throw new HttpsError(
                "invalid-argument",
                "tamanosPermitidos no puede estar vacío. Selecciona al menos uno."
            );
        }

        const intentosTotales = Number(data.intentosTotales);
        if (modo === "una_vez" && (!Number.isFinite(intentosTotales) || intentosTotales < 1 || intentosTotales > 50)) {
            throw new HttpsError(
                "invalid-argument",
                "intentosTotales debe ser un entero entre 1 y 50 cuando modo es 'una_vez'."
            );
        }

        const diasGratis = Number(data.diasGratis);
        if (modo === "por_dias" && (!Number.isFinite(diasGratis) || diasGratis < 1 || diasGratis > 365)) {
            throw new HttpsError(
                "invalid-argument",
                "diasGratis debe ser un entero entre 1 y 365 cuando modo es 'por_dias'."
            );
        }

        const planesIncluidos = Array.isArray(data.planesIncluidos)
            ? data.planesIncluidos.map((s) => String(s)).slice(0, 20)
            : [];

        const payload = {
            modo,
            intentosTotales: modo === "una_vez" ? Math.floor(intentosTotales) : DEFAULT_TRIAL_CONFIG.intentosTotales,
            diasGratis: modo === "por_dias" ? Math.floor(diasGratis) : DEFAULT_TRIAL_CONFIG.diasGratis,
            tamanosPermitidos: tamanosLimpios,
            planesIncluidos,
            actualizadoPor: request.auth.uid,
            actualizadoEn: new Date().toISOString(),
        };

        const db = admin.firestore();
        await db.collection("config").doc("free_trial").set(payload);

        // AUDIT: cambio de configuración global del trial. Útil para detectar
        // si un admin comprometido empieza a regalar acceso.
        logger.info("AUDIT_CONFIG_CHANGE setTrialConfig", {
            audit: "config_change",
            action: "setTrialConfig",
            actor: request.auth.uid,
            actorEmail: request.auth.token?.email || null,
            payload: {
                modo,
                intentosTotales: payload.intentosTotales,
                diasGratis: payload.diasGratis,
                tamanos: tamanosLimpios,
                planesIncluidos,
            },
            ts: new Date().toISOString(),
        });

        return { ok: true, config: payload };
    }
);

// ----------------------------------------------------------------------------
// getMyAccess — estado de acceso del caller para que el frontend pinte la UI.
// ----------------------------------------------------------------------------
exports.getMyAccess = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true;
        const isAdmin = claims.admin === true;

        const config = await loadTrialConfig();

        // Profesor/admin tienen acceso ilimitado y no necesitan pagar.
        if (isProfesor || isAdmin) {
            return {
                tieneAccesoPago: true,
                validUntil: null,
                freeTrialDisponible: false,
                simulacrosGratisUsados: 0,
                esProfesor: isProfesor,
                esAdmin: isAdmin,
                trialConfig: config,
            };
        }

        const db = admin.firestore();
        const userSnap = await db.collection("usuarios").doc(request.auth.uid).get();
        const userData = userSnap.exists ? userSnap.data() : {};

        const validUntilRaw = userData.acceso_validUntil || null;
        const validUntil = validUntilRaw ? new Date(validUntilRaw) : null;
        const now = new Date();
        const tieneAccesoPago = validUntil != null && validUntil > now;

        const simulacrosGratisUsados = Number(userData.simulacros_gratis_usados || 0);
        const fechaRegistroRaw = userData.fechaRegistro || userData.creadoEn || null;
        const fechaRegistro = fechaRegistroRaw ? new Date(fechaRegistroRaw) : null;

        // Disponibilidad del free trial según el modo configurado.
        let freeTrialDisponible = false;
        let trialDiasRestantes = null;
        if (!tieneAccesoPago) {
            if (config.modo === "ilimitado") {
                freeTrialDisponible = true;
            } else if (config.modo === "una_vez") {
                freeTrialDisponible = simulacrosGratisUsados < config.intentosTotales;
            } else if (config.modo === "por_dias" && fechaRegistro) {
                const msDesdeRegistro = now.getTime() - fechaRegistro.getTime();
                const diasDesdeRegistro = msDesdeRegistro / (1000 * 60 * 60 * 24);
                trialDiasRestantes = Math.max(0, Math.ceil(config.diasGratis - diasDesdeRegistro));
                freeTrialDisponible = trialDiasRestantes > 0;
            }
        }

        return {
            tieneAccesoPago,
            validUntil: validUntil ? validUntil.toISOString() : null,
            freeTrialDisponible,
            simulacrosGratisUsados,
            trialDiasRestantes,
            esProfesor: false,
            esAdmin: false,
            trialConfig: config,
        };
    }
);

// ----------------------------------------------------------------------------
// checkAndConsumeAccess — helper interno usado por questions.js antes de
// devolver el banco. Verifica que el caller pueda iniciar un simulacro del
// tamaño solicitado bajo la config actual. Si está usando free trial en
// modo "una_vez", incrementa el contador atómicamente.
// Throws HttpsError si no tiene acceso.
// ----------------------------------------------------------------------------
async function checkAndConsumeAccess(uid, claims, requestedSize) {
    const isProfesor = claims?.profesor === true;
    const isAdmin = claims?.admin === true;

    // Profesor/admin: pasan sin chequeo.
    if (isProfesor || isAdmin) return { mode: "rol_libre" };

    const size = Number(requestedSize) || 0;
    if (size <= 0) {
        throw new HttpsError("invalid-argument", "Tamaño de simulacro inválido.");
    }

    const config = await loadTrialConfig();
    const db = admin.firestore();
    const userRef = db.collection("usuarios").doc(uid);

    return await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const userData = userSnap.exists ? userSnap.data() : {};

        const validUntilRaw = userData.acceso_validUntil || null;
        const validUntil = validUntilRaw ? new Date(validUntilRaw) : null;
        const now = new Date();
        const tieneAccesoPago = validUntil != null && validUntil > now;

        if (tieneAccesoPago) {
            return { mode: "pago", validUntil: validUntil.toISOString() };
        }

        // Sin acceso pago → entrar al modo free trial según config.
        if (!config.tamanosPermitidos.includes(size)) {
            throw new HttpsError(
                "permission-denied",
                `El simulacro gratuito está limitado a estos tamaños: ${config.tamanosPermitidos.join(", ")}. Comprá un plan para acceder a simulacros más grandes.`,
                {
                    reason: "free_size_limit",
                    tamanosPermitidos: config.tamanosPermitidos,
                }
            );
        }

        if (config.modo === "ilimitado") {
            return { mode: "ilimitado" };
        }

        if (config.modo === "una_vez") {
            const usados = Number(userData.simulacros_gratis_usados || 0);
            if (usados >= config.intentosTotales) {
                throw new HttpsError(
                    "permission-denied",
                    "Ya consumiste todos tus simulacros gratuitos. Comprá un plan para seguir simulando.",
                    { reason: "expired" }
                );
            }
            tx.set(
                userRef,
                { simulacros_gratis_usados: usados + 1 },
                { merge: true }
            );
            return { mode: "free_trial", restantes: config.intentosTotales - (usados + 1) };
        }

        if (config.modo === "por_dias") {
            const fechaRegistroRaw = userData.fechaRegistro || userData.creadoEn || null;
            const fechaRegistro = fechaRegistroRaw ? new Date(fechaRegistroRaw) : null;
            if (!fechaRegistro) {
                throw new HttpsError(
                    "failed-precondition",
                    "No se pudo determinar tu fecha de registro. Contactá al profesor."
                );
            }
            const msTrans = now.getTime() - fechaRegistro.getTime();
            const dias = msTrans / (1000 * 60 * 60 * 24);
            if (dias > config.diasGratis) {
                throw new HttpsError(
                    "permission-denied",
                    `Tu período gratuito de ${config.diasGratis} días terminó. Comprá un plan para seguir simulando.`,
                    { reason: "expired" }
                );
            }
            return { mode: "free_trial_dias", diasRestantes: Math.ceil(config.diasGratis - dias) };
        }

        // Caso default por seguridad.
        throw new HttpsError("internal", "Modo de free trial no reconocido.");
    });
}

exports.checkAndConsumeAccess = checkAndConsumeAccess;
exports.loadTrialConfig = loadTrialConfig;
exports.DEFAULT_TRIAL_CONFIG = DEFAULT_TRIAL_CONFIG;
