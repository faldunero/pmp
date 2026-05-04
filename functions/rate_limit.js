/**
 * Rate limiting básico per-user usando Firestore como contador.
 *
 * Estrategia:
 *   - Una doc por (uid, action, ventana de N minutos).
 *   - El path es rate_limits/{uid}_{action}_{bucketTs}
 *   - Usamos transaction para incrementar atómicamente.
 *
 * Ventajas:
 *   - Sin dependencias externas.
 *   - El TTL natural de los buckets viene "for free" (los docs viejos
 *     simplemente se ignoran; un job/Trigger podría limpiarlos cada tanto).
 *
 * Limitación conocida:
 *   - No es preciso bajo concurrencia altísima (pueden coexistir 2 escrituras).
 *   - Suficiente para gating defensivo de un alumno; no para anti-DDoS serio.
 *     Para eso → Cloud Armor o similar.
 *
 * Recomendado: bucket de 1 hora con un cap de 60 invocaciones por hora.
 * Suficiente para uso humano normal (un alumno difícilmente hace 60 simulacros
 * en una hora) y rompe el scraping automatizado.
 */
"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

/**
 * Chequea y consume una unidad de cupo.
 * @param {string} uid                 caller uid
 * @param {string} action              identificador semántico (ej: "getQuestions")
 * @param {number} maxPerWindow        cupo máximo por ventana
 * @param {number} windowSeconds       tamaño de la ventana en segundos (default 3600)
 * @throws HttpsError("resource-exhausted", ...) si excede
 */
async function checkAndConsumeRateLimit(
    uid,
    action,
    maxPerWindow,
    windowSeconds = 3600
) {
    if (!uid) throw new HttpsError("unauthenticated", "Auth requerido.");
    const db = admin.firestore();

    const now = Date.now();
    const bucket = Math.floor(now / 1000 / windowSeconds);
    const docId = `${uid}_${action}_${bucket}`;
    const ref = db.collection("rate_limits").doc(docId);

    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? Number(snap.data().count || 0) : 0;
        if (current >= maxPerWindow) {
            return { allowed: false, current, limit: maxPerWindow };
        }
        if (snap.exists) {
            tx.update(ref, {
                count: admin.firestore.FieldValue.increment(1),
                lastAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } else {
            tx.set(ref, {
                uid,
                action,
                bucket,
                count: 1,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastAt: admin.firestore.FieldValue.serverTimestamp(),
                // expiresAt se puede usar con un TTL policy en Firestore para
                // borrar automáticamente los buckets viejos (configurable
                // desde la consola de GCP -> Firestore -> TTL).
                expiresAt: new Date(now + windowSeconds * 1000 * 2),
            });
        }
        return { allowed: true, current: current + 1, limit: maxPerWindow };
    });

    if (!result.allowed) {
        const minutosHastaReset = Math.ceil(
            ((bucket + 1) * windowSeconds * 1000 - now) / 60000
        );
        throw new HttpsError(
            "resource-exhausted",
            `Llegaste al límite de ${maxPerWindow} llamadas por hora. Probá de nuevo en ~${minutosHastaReset} minutos.`,
            { reason: "rate_limit", retryAfterMinutes: minutosHastaReset }
        );
    }

    return result;
}

module.exports = { checkAndConsumeRateLimit };
