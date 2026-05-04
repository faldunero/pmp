/**
 * Single-session enforcement.
 *
 * Modelo: por cada usuario hay UN sessionId activo en Firestore.
 *   sesiones/{uid} = { sessionId, claimedAt, lastSeen, userAgent }
 *
 * Flujo del cliente:
 *   1. En login (o al cargar la app con sesión persistida), llama claimSession.
 *      Esto genera un nuevo sessionId, lo escribe a sesiones/{uid}, y lo
 *      devuelve al cliente. El cliente lo guarda en localStorage.
 *   2. El cliente subscribe a sesiones/{uid} con onSnapshot. Si el sessionId
 *      en el doc cambia (porque otra sesión tomó la posta), el listener
 *      dispara y forza signOut local.
 *   3. Cada Cloud Function "crítica" (getQuestions, gradeAttempt, etc.)
 *      acepta sessionId en el payload y llama validateSession; si no
 *      coincide, throwea unauthenticated. Esto cierra el caso del token
 *      robado: aunque el atacante tenga un token válido, sin el sessionId
 *      correcto sus llamadas son rechazadas.
 *
 * Edge cases:
 *   - Refresh de página: el cliente reusa el sessionId guardado en localStorage
 *     y lo valida contra el doc. Si coincide, sigue. Si no (otra sesión tomó
 *     control), forza logout.
 *   - Token caducado: Firebase Auth lo refresca solo. El sessionId no caduca
 *     hasta que otra sesión lo reemplace o el usuario haga logout.
 *   - Logout: borra el doc de sesión.
 */
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { assertAuth } = require("./utils");

const COLECCION = "sesiones";

function nuevoSessionId() {
    // 16 bytes hex = 32 chars. Suficiente entropía y compacto.
    return crypto.randomBytes(16).toString("hex");
}

// ----------------------------------------------------------------------------
// claimSession — toma posesión exclusiva de la sesión para este usuario.
// Cualquier otra sesión activa queda "huérfana" y será forzada a salir
// cuando su listener detecte el cambio de sessionId.
// ----------------------------------------------------------------------------
exports.claimSession = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const sessionId = nuevoSessionId();
        const ua = (request.rawRequest?.headers?.["user-agent"] || "").slice(0, 200);
        const ip = (request.rawRequest?.ip || "").slice(0, 64);

        const db = admin.firestore();
        await db.collection(COLECCION).doc(request.auth.uid).set({
            sessionId,
            userAgent: ua,
            ip,
            claimedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        });

        logger.info("AUDIT_SESSION_CLAIM", {
            audit: "session",
            uid: request.auth.uid,
            email: request.auth.token?.email || null,
            ua,
            ip,
            ts: new Date().toISOString(),
        });

        return { sessionId };
    }
);

// ----------------------------------------------------------------------------
// releaseSession — borra el doc de sesión al hacer logout.
// No es estrictamente necesario para la seguridad (el doc se sobreescribe
// en el próximo claim), pero limpia el estado y permite saber quién está
// "online" en este momento.
// ----------------------------------------------------------------------------
exports.releaseSession = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const db = admin.firestore();
        await db.collection(COLECCION).doc(request.auth.uid).delete();
        return { ok: true };
    }
);

// ----------------------------------------------------------------------------
// Helper interno: valida que el sessionId del cliente coincida con el
// que está guardado en Firestore. Si no, throwea unauthenticated.
//
// PROFESOR/ADMIN están EXENTOS: pueden estar logueados desde múltiples
// dispositivos sin restricción (un profesor con tablet + laptop es legítimo,
// y revocar credenciales de admin tiene riesgos operacionales).
// ----------------------------------------------------------------------------
async function validateSession(uid, providedSessionId, claims) {
    if (claims?.profesor === true || claims?.admin === true) return; // exento

    if (!providedSessionId || typeof providedSessionId !== "string") {
        throw new HttpsError(
            "unauthenticated",
            "Sesión inválida. Volvé a iniciar sesión.",
            { reason: "session_missing" }
        );
    }

    const db = admin.firestore();
    const snap = await db.collection(COLECCION).doc(uid).get();
    const stored = snap.exists ? snap.data().sessionId : null;

    if (!stored || stored !== providedSessionId) {
        throw new HttpsError(
            "unauthenticated",
            "Tu sesión fue cerrada porque iniciaste en otro dispositivo. Volvé a entrar.",
            { reason: "session_revoked" }
        );
    }

    // Heartbeat (mejor esfuerzo, no esperamos resultado).
    db.collection(COLECCION)
        .doc(uid)
        .update({ lastSeen: admin.firestore.FieldValue.serverTimestamp() })
        .catch(() => {});
}

exports.validateSession = validateSession;
