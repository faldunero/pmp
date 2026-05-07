/**
 * Cloud Functions de tracks (rutas de certificación).
 *
 * Endpoints:
 *   - listTracks           → catálogo público (metadatos solamente).
 *   - getTrackDetail       → estructura del track con sus cursos y lecciones.
 *   - getLeccion           → contenido completo de una lección, con gating.
 *   - getDashboardAlumno   → progreso del alumno en todos los tracks.
 *   - marcarLeccionCompletada → registra avance del alumno.
 *
 * Observación clave: las reglas Firestore bloquean la lectura DIRECTA del
 * contenido de las lecciones desde el cliente. Toda lectura del contenido
 * pasa por estas funciones, que validan single-session, email verificado,
 * rate limit y publicación.
 */
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { assertAuth, assertEmailVerified } = require("./utils");
const { validateSession } = require("./sessions");
const { checkAndConsumeRateLimit } = require("./rate_limit");

const RATE_LIMIT_GET_LECCION = 300; // alumno leyendo lecciones — límite generoso

// ---------------------------------------------------------------------------
// listTracks — catálogo del portal. Devuelve solo metadatos, sin estructura
// interna ni contenido. Cualquier autenticado puede listarlo.
// ---------------------------------------------------------------------------
exports.listTracks = onCall(
    { region: "us-central1", maxInstances: 10 },
    async (request) => {
        assertAuth(request);
        const db = admin.firestore();
        const snap = await db.collection("tracks").orderBy("orden", "asc").get();
        const tracks = snap.docs.map((d) => {
            const t = d.data() || {};
            return {
                id: d.id,
                titulo: t.titulo || "",
                descripcionCorta: t.descripcionCorta || "",
                entidad: t.entidad || "",
                siglas: t.siglas || "",
                colorHex: t.colorHex || "#2563eb",
                paletaIconBg: t.paletaIconBg || "#dbeafe",
                paletaIconFg: t.paletaIconFg || "#1e40af",
                status: t.status || "coming_soon",
                disponibleDesde: t.disponibleDesde || null,
                oficial: t.oficial === true,
                orden: t.orden || 999,
                lecciones_total: t.lecciones_total || null,
                cursos_total: t.cursos_total || null,
            };
        });
        return { tracks };
    }
);

// ---------------------------------------------------------------------------
// getTrackDetail — devuelve la estructura completa: track + cursos + lecciones
// (solo metadatos de lecciones, NO el contenido). Útil para la pantalla
// "Vista interna del curso" y el sidebar del lector.
//
// Si el caller es alumno, las lecciones en estado draft NO se devuelven
// (no debe ver lo que aún no está publicado).
// ---------------------------------------------------------------------------
exports.getTrackDetail = onCall(
    { region: "us-central1", maxInstances: 10 },
    async (request) => {
        assertAuth(request);
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true || claims.admin === true;

        const { trackId } = request.data || {};
        if (!trackId) throw new HttpsError("invalid-argument", "trackId requerido.");

        const db = admin.firestore();
        const trackRef = db.collection("tracks").doc(trackId);
        const trackSnap = await trackRef.get();
        if (!trackSnap.exists) throw new HttpsError("not-found", "Track no encontrado.");

        const track = trackSnap.data();
        const cursosSnap = await trackRef.collection("cursos").orderBy("orden", "asc").get();

        const cursos = [];
        for (const cdoc of cursosSnap.docs) {
            const c = cdoc.data();
            const leccionesSnap = await cdoc.ref.collection("lecciones").orderBy("orden", "asc").get();
            const lecciones = leccionesSnap.docs
                .map((ldoc) => {
                    const l = ldoc.data();
                    // Para alumnos, solo lecciones publicadas.
                    if (!isProfesor && l.status !== "published") return null;
                    return {
                        id: ldoc.id,
                        titulo: l.titulo,
                        orden: l.orden,
                        tiempoEstimadoMin: l.tiempoEstimadoMin || null,
                        status: l.status,
                        publicadoEn: l.publicadoEn?.toDate?.()?.toISOString?.() || null,
                        // NOTA: NO devolvemos `contenido` acá. Solo metadata.
                    };
                })
                .filter(Boolean);

            cursos.push({
                id: cdoc.id,
                titulo: c.titulo,
                descripcion: c.descripcion,
                orden: c.orden,
                tiempoEstimadoMin: c.tiempoEstimadoMin || null,
                lecciones_total: c.lecciones_total || lecciones.length,
                status: c.status || "draft",
                lecciones,
            });
        }

        return {
            track: {
                id: trackSnap.id,
                titulo: track.titulo,
                descripcionCorta: track.descripcionCorta,
                descripcionLarga: track.descripcionLarga,
                entidad: track.entidad,
                siglas: track.siglas,
                colorHex: track.colorHex,
                paletaIconBg: track.paletaIconBg,
                paletaIconFg: track.paletaIconFg,
                status: track.status,
                oficial: track.oficial === true,
                simuladorPreguntasCollection: track.simuladorPreguntasCollection || null,
                simuladorTamanos: track.simuladorTamanos || [],
                simuladorTamanoExamenCompleto: track.simuladorTamanoExamenCompleto || null,
            },
            cursos,
        };
    }
);

// ---------------------------------------------------------------------------
// getLeccion — devuelve el contenido completo de UNA lección. Esta es la
// función protegida con todos los gates: single-session, email verificado,
// rate limit, y solo lecciones publicadas (excepto admin).
// ---------------------------------------------------------------------------
exports.getLeccion = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true || claims.admin === true;

        if (!isProfesor) {
            await validateSession(request.auth.uid, request.data?.sessionId, claims);
            assertEmailVerified(request);
            await checkAndConsumeRateLimit(request.auth.uid, "getLeccion", RATE_LIMIT_GET_LECCION);
        }

        const { trackId, cursoId, leccionId } = request.data || {};
        if (!trackId || !cursoId || !leccionId) {
            throw new HttpsError("invalid-argument", "trackId, cursoId y leccionId requeridos.");
        }

        const db = admin.firestore();
        const ref = db
            .collection("tracks").doc(trackId)
            .collection("cursos").doc(cursoId)
            .collection("lecciones").doc(leccionId);

        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError("not-found", "Lección no encontrada.");
        const l = snap.data();

        // Alumno: bloqueamos drafts.
        if (!isProfesor && l.status !== "published") {
            throw new HttpsError("permission-denied", "Esta lección aún no está publicada.");
        }

        return {
            id: snap.id,
            titulo: l.titulo,
            orden: l.orden,
            tiempoEstimadoMin: l.tiempoEstimadoMin || null,
            cursoId: l.cursoId,
            trackId: l.trackId,
            contenido: l.contenido || { secciones: [] },
            status: l.status,
            // Para admin: metadata de generación; para alumnos no la incluimos.
            ...(isProfesor && {
                generadoPor: l.generadoPor || null,
                modeloIA: l.modeloIA || null,
                generadoEn: l.generadoEn?.toDate?.()?.toISOString?.() || null,
                publicadoEn: l.publicadoEn?.toDate?.()?.toISOString?.() || null,
                palabras: l.palabras || null,
            }),
        };
    }
);

// ---------------------------------------------------------------------------
// marcarLeccionCompletada — registra el avance del alumno.
//
// Schema de progreso:
//   progreso/{uid}_{leccionId} = { uid, trackId, cursoId, leccionId,
//                                   completada, fechaCompletada, tiempoLeidoSeg,
//                                   notasPersonales }
// ---------------------------------------------------------------------------
exports.marcarLeccionCompletada = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true || claims.admin === true;

        if (!isProfesor) {
            await validateSession(request.auth.uid, request.data?.sessionId, claims);
            assertEmailVerified(request);
        }

        const { trackId, cursoId, leccionId, completada, tiempoLeidoSeg, notasPersonales } = request.data || {};
        if (!trackId || !cursoId || !leccionId) {
            throw new HttpsError("invalid-argument", "trackId, cursoId y leccionId requeridos.");
        }

        const db = admin.firestore();
        const docId = `${request.auth.uid}_${leccionId}`;
        const ref = db.collection("progreso").doc(docId);

        const payload = {
            uid: request.auth.uid,
            trackId,
            cursoId,
            leccionId,
            actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (typeof completada === "boolean") {
            payload.completada = completada;
            if (completada) payload.fechaCompletada = admin.firestore.FieldValue.serverTimestamp();
        }
        if (typeof tiempoLeidoSeg === "number" && tiempoLeidoSeg >= 0 && tiempoLeidoSeg < 60 * 60 * 8) {
            payload.tiempoLeidoSeg = admin.firestore.FieldValue.increment(tiempoLeidoSeg);
        }
        if (typeof notasPersonales === "string" && notasPersonales.length <= 5000) {
            payload.notasPersonales = notasPersonales;
        }

        await ref.set(payload, { merge: true });
        return { ok: true };
    }
);

// ---------------------------------------------------------------------------
// getDashboardAlumno — datos para la pantalla principal del alumno logueado.
// Devuelve sus tracks activos, progreso y una lección sugerida para continuar.
// ---------------------------------------------------------------------------
exports.getDashboardAlumno = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true || claims.admin === true;

        if (!isProfesor) {
            await validateSession(request.auth.uid, request.data?.sessionId, claims);
        }

        const db = admin.firestore();
        const uid = request.auth.uid;

        const [tracksSnap, progresoSnap] = await Promise.all([
            db.collection("tracks").orderBy("orden", "asc").get(),
            db.collection("progreso").where("uid", "==", uid).get(),
        ]);

        // Index del progreso por leccionId
        const progresoPorLeccion = new Map();
        progresoSnap.forEach((d) => {
            const p = d.data();
            progresoPorLeccion.set(p.leccionId, p);
        });

        // Calculamos completadas / total por track
        const tracks = [];
        for (const tdoc of tracksSnap.docs) {
            const t = tdoc.data();
            const cursosSnap = await tdoc.ref.collection("cursos").get();
            let totalLecciones = 0;
            let completadas = 0;
            let ultimaActividad = null;
            let proximaLeccion = null;

            for (const cdoc of cursosSnap.docs) {
                const lecSnap = await cdoc.ref
                    .collection("lecciones")
                    .where("status", "==", "published")
                    .orderBy("orden", "asc")
                    .get();
                for (const ldoc of lecSnap.docs) {
                    totalLecciones++;
                    const p = progresoPorLeccion.get(ldoc.id);
                    if (p?.completada) {
                        completadas++;
                        const ts = p.fechaCompletada?.toDate?.()?.getTime?.() || 0;
                        if (!ultimaActividad || ts > ultimaActividad.ts) {
                            ultimaActividad = { ts, leccionId: ldoc.id, cursoId: cdoc.id };
                        }
                    } else if (!proximaLeccion) {
                        const l = ldoc.data();
                        proximaLeccion = {
                            leccionId: ldoc.id,
                            cursoId: cdoc.id,
                            cursoTitulo: cdoc.data().titulo,
                            cursoOrden: cdoc.data().orden,
                            titulo: l.titulo,
                            orden: l.orden,
                            tiempoEstimadoMin: l.tiempoEstimadoMin || null,
                        };
                    }
                }
            }

            tracks.push({
                id: tdoc.id,
                titulo: t.titulo,
                descripcionCorta: t.descripcionCorta,
                colorHex: t.colorHex,
                paletaIconBg: t.paletaIconBg,
                paletaIconFg: t.paletaIconFg,
                status: t.status,
                lecciones_total: totalLecciones,
                lecciones_completadas: completadas,
                porcentaje: totalLecciones > 0 ? Math.round((completadas / totalLecciones) * 100) : 0,
                proximaLeccion,
                ultimaActividad: ultimaActividad?.ts || null,
            });
        }

        const totalLeccionesGlobal = tracks.reduce((acc, t) => acc + t.lecciones_total, 0);
        const totalCompletadasGlobal = tracks.reduce((acc, t) => acc + t.lecciones_completadas, 0);

        return {
            tracks,
            resumen: {
                tracksActivos: tracks.filter((t) => t.lecciones_completadas > 0).length,
                leccionesCompletadas: totalCompletadasGlobal,
                leccionesTotal: totalLeccionesGlobal,
            },
        };
    }
);
