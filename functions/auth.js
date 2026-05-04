/**
 * Gestión de roles administrativos vía custom claims de Firebase Auth.
 *
 * Modelo de roles:
 *   - alumno      : sin custom claims especiales
 *   - profesor    : { profesor: true }                 supervisa, sube preguntas
 *   - admin       : { profesor: true, admin: true }    + gestiona usuarios y pagos
 *
 * Reglas de quién puede tocar qué:
 *   - setProfesorClaim → solo admin (un profesor NO puede crear más profesores)
 *   - setAdminClaim    → solo otro admin
 *   - listUsersWithRoles → solo admin
 *
 * El claim NO se puede setear desde el cliente: solo Cloud Functions
 * (validando que el caller ya es admin) o el bootstrap script local
 * (con la service account) pueden hacerlo.
 */
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { assertAdmin } = require("./utils");

// Promueve o despromueve a un usuario al rol profesor.
// Solo callable por usuarios que YA son admin.
exports.setProfesorClaim = onCall(
    { region: "us-central1", maxInstances: 5 },
    async (request) => {
        assertAdmin(request);

        const { targetUid, profesor } = request.data || {};
        if (typeof targetUid !== "string" || targetUid.length === 0) {
            throw new HttpsError("invalid-argument", "targetUid requerido.");
        }
        if (typeof profesor !== "boolean") {
            throw new HttpsError("invalid-argument", "profesor debe ser boolean.");
        }

        const target = await admin.auth().getUser(targetUid);
        const currentClaims = target.customClaims || {};

        // Si el usuario es admin, NO se le puede quitar profesor sin quitar antes admin.
        // (admin implica profesor; si solo le sacamos profesor, queda en estado inconsistente)
        if (currentClaims.admin === true && profesor === false) {
            throw new HttpsError(
                "failed-precondition",
                "Este usuario es admin. Quitale primero el rol admin antes de quitarle profesor."
            );
        }

        const newClaims = { ...currentClaims, profesor };
        if (!profesor) delete newClaims.profesor;

        await admin.auth().setCustomUserClaims(targetUid, newClaims);
        await admin.auth().revokeRefreshTokens(targetUid);

        // AUDIT: cambio de rol. Buscar "AUDIT_ROLE_CHANGE" en Cloud Logging
        // para configurar alertas de seguridad sobre acciones admin.
        logger.info("AUDIT_ROLE_CHANGE setProfesorClaim", {
            audit: "role_change",
            action: "setProfesorClaim",
            actor: request.auth.uid,
            actorEmail: request.auth.token?.email || null,
            target: targetUid,
            newValue: profesor,
            ts: new Date().toISOString(),
        });

        return {
            ok: true,
            targetUid,
            profesor,
            note: "El usuario debe cerrar sesión y volver a entrar para refrescar su token.",
        };
    }
);

// Promueve o despromueve a un usuario al rol admin.
// Solo callable por otro admin.
// Cuando se promueve a admin, automáticamente se le da también profesor=true.
exports.setAdminClaim = onCall(
    { region: "us-central1", maxInstances: 5 },
    async (request) => {
        assertAdmin(request);

        const { targetUid, admin: makeAdmin } = request.data || {};
        if (typeof targetUid !== "string" || targetUid.length === 0) {
            throw new HttpsError("invalid-argument", "targetUid requerido.");
        }
        if (typeof makeAdmin !== "boolean") {
            throw new HttpsError("invalid-argument", "admin debe ser boolean.");
        }

        // Auto-revoke guard: un admin no puede sacarse el rol a sí mismo.
        // Esto evita que el sistema se quede sin admins por accidente.
        if (request.auth.uid === targetUid && makeAdmin === false) {
            throw new HttpsError(
                "failed-precondition",
                "No puedes auto-revocarte el rol admin. Pídele a otro admin que lo haga."
            );
        }

        const target = await admin.auth().getUser(targetUid);
        const currentClaims = target.customClaims || {};

        let newClaims;
        if (makeAdmin) {
            // Al promover a admin, también garantizamos profesor=true.
            newClaims = { ...currentClaims, profesor: true, admin: true };
        } else {
            // Al despromover, dejamos profesor como estaba (puede seguir siendo profesor).
            newClaims = { ...currentClaims };
            delete newClaims.admin;
        }

        await admin.auth().setCustomUserClaims(targetUid, newClaims);
        await admin.auth().revokeRefreshTokens(targetUid);

        // AUDIT: este es el cambio MÁS sensible. Configurar alerta inmediata
        // en Cloud Logging sobre "AUDIT_ROLE_CHANGE setAdminClaim".
        logger.info("AUDIT_ROLE_CHANGE setAdminClaim", {
            audit: "role_change",
            action: "setAdminClaim",
            severity: "high",
            actor: request.auth.uid,
            actorEmail: request.auth.token?.email || null,
            target: targetUid,
            newValue: makeAdmin,
            ts: new Date().toISOString(),
        });

        return {
            ok: true,
            targetUid,
            admin: makeAdmin,
            note: "El usuario debe cerrar sesión y volver a entrar para refrescar su token.",
        };
    }
);

// Devuelve el estado de los claims del propio caller. Útil para que el cliente
// sepa si renderizar UI profesor / admin sin tener que adivinar.
exports.getMyRole = onCall(
    { region: "us-central1", maxInstances: 10 },
    async (request) => {
        if (!request.auth) {
            return { signedIn: false, profesor: false, admin: false };
        }
        const claims = request.auth.token || {};
        return {
            signedIn: true,
            uid: request.auth.uid,
            profesor: claims.profesor === true,
            admin: claims.admin === true,
        };
    }
);

// Lista todos los usuarios del proyecto con sus roles.
// Solo admin puede invocarla. Usado por la UI de gestión de usuarios.
// Devuelve uid, email, displayName, profesor, admin, creationTime.
exports.listUsersWithRoles = onCall(
    { region: "us-central1", maxInstances: 5, timeoutSeconds: 60 },
    async (request) => {
        assertAdmin(request);

        const result = await admin.auth().listUsers(1000);
        const users = result.users.map((u) => ({
            uid: u.uid,
            email: u.email || "",
            displayName: u.displayName || "",
            emailVerified: u.emailVerified,
            disabled: u.disabled,
            profesor: u.customClaims?.profesor === true,
            admin: u.customClaims?.admin === true,
            creationTime: u.metadata.creationTime,
            lastSignInTime: u.metadata.lastSignInTime,
        }));

        // Para enriquecer con nombre/apellido del perfil de Firestore.
        // (auth.displayName puede estar vacío para usuarios registrados con email/password)
        const db = admin.firestore();
        const profileSnap = await db.collection("usuarios").get();
        const profileById = new Map();
        profileSnap.forEach((d) => profileById.set(d.id, d.data() || {}));

        users.forEach((u) => {
            const p = profileById.get(u.uid);
            if (p) {
                u.nombre = p.nombre || "";
                u.apellido = p.apellido || "";
                u.pais = p.pais || "";
            }
        });

        // Ordenar: admins primero, después profesores, después alumnos.
        users.sort((a, b) => {
            const ra = a.admin ? 0 : a.profesor ? 1 : 2;
            const rb = b.admin ? 0 : b.profesor ? 1 : 2;
            if (ra !== rb) return ra - rb;
            return (a.email || "").localeCompare(b.email || "");
        });

        return { users, total: users.length };
    }
);
