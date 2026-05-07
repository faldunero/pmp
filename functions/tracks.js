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
// Fallback hardcoded — usado cuando tracks/ aún no fue sembrado en Firestore.
// Garantiza que la UX del alumno no se rompa antes del bootstrap.
// ---------------------------------------------------------------------------
const TRACK_FALLBACK_PMP = {
    id: "pmp",
    titulo: "Preparación PMP",
    descripcionCorta: "Apoyo para examen del PMI",
    descripcionLarga: "Material de estudio independiente para preparar el examen del Project Management Institute. Incluye un simulador con 180 preguntas y análisis por dominio.",
    entidad: "Project Management Institute",
    siglas: "PMP",
    colorHex: "#2563eb",
    paletaIconBg: "#eff6ff",
    paletaIconFg: "#1e40af",
    status: "available",
    oficial: false,
    simuladorPreguntasCollection: "preguntas_pmp",
    simuladorTamanos: [20, 40, 60, 80, 100, 120, 140, 180],
    simuladorTamanoExamenCompleto: 180,
};

// ---------------------------------------------------------------------------
// getTrackDetail — devuelve la estructura completa: track + cursos + lecciones
// (solo metadatos de lecciones, NO el contenido). Útil para la pantalla
// "Vista interna del curso" y el sidebar del lector.
//
// Si el caller es alumno, las lecciones en estado draft NO se devuelven
// (no debe ver lo que aún no está publicado).
//
// Diseño defensivo:
//   - Si el track no existe en Firestore Y es "pmp", devolvemos el fallback
//     hardcoded para que el alumno siempre pueda llegar al simulador.
//   - Cualquier curso con datos malformados se omite, no rompe la respuesta.
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

        let trackSnap;
        try {
            trackSnap = await trackRef.get();
        } catch (e) {
            console.warn("getTrackDetail: error leyendo track:", e?.message);
        }

        // Fallback si el track no existe (bootstrap no corrido)
        if (!trackSnap || !trackSnap.exists) {
            if (trackId === "pmp") {
                return { track: { ...TRACK_FALLBACK_PMP }, cursos: [] };
            }
            throw new HttpsError("not-found", "Track no encontrado.");
        }

        const track = trackSnap.data() || {};
        const cursos = [];
        try {
            const cursosSnap = await trackRef.collection("cursos").orderBy("orden", "asc").get();
            for (const cdoc of cursosSnap.docs) {
                try {
                    const c = cdoc.data() || {};
                    let leccionesDocs = [];
                    try {
                        const lsnap = await cdoc.ref.collection("lecciones").orderBy("orden", "asc").get();
                        leccionesDocs = lsnap.docs;
                    } catch (e) {
                        console.warn(`getTrackDetail: lecciones de ${cdoc.id}:`, e?.message);
                    }
                    const lecciones = leccionesDocs
                        .map((ldoc) => {
                            const l = ldoc.data() || {};
                            if (!isProfesor && l.status !== "published") return null;
                            return {
                                id: ldoc.id,
                                titulo: l.titulo || "",
                                orden: l.orden || 0,
                                tiempoEstimadoMin: l.tiempoEstimadoMin || null,
                                status: l.status || "draft",
                                publicadoEn: l.publicadoEn?.toDate?.()?.toISOString?.() || null,
                            };
                        })
                        .filter(Boolean);

                    cursos.push({
                        id: cdoc.id,
                        titulo: c.titulo || cdoc.id,
                        descripcion: c.descripcion || "",
                        orden: c.orden || 0,
                        tiempoEstimadoMin: c.tiempoEstimadoMin || null,
                        lecciones_total: c.lecciones_total || lecciones.length,
                        status: c.status || "draft",
                        lecciones,
                    });
                } catch (e) {
                    console.warn(`getTrackDetail: curso ${cdoc.id} skipped:`, e?.message);
                }
            }
        } catch (e) {
            console.warn("getTrackDetail: error leyendo cursos:", e?.message);
        }

        return {
            track: {
                id: trackSnap.id,
                titulo: track.titulo || trackSnap.id,
                descripcionCorta: track.descripcionCorta || "",
                descripcionLarga: track.descripcionLarga || track.descripcionCorta || "",
                entidad: track.entidad || "",
                siglas: track.siglas || "",
                colorHex: track.colorHex || "#2563eb",
                paletaIconBg: track.paletaIconBg || "#eff6ff",
                paletaIconFg: track.paletaIconFg || "#1e40af",
                status: track.status || "coming_soon",
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
//
// Diseño defensivo:
//   - validateSession se hace en try/catch para que un sessionId stale no
//     deje al alumno con un dashboard vacío (peor UX). Si falla, se loguea
//     pero seguimos.
//   - Las queries a Firestore están envueltas para que un track con datos
//     malformados no rompa toda la respuesta.
//   - Para evitar requerir índices compuestos en Firestore, leemos las
//     lecciones con orderBy simple y filtramos `status==published` en código.
//   - Si no hay tracks sembrados todavía, devolvemos una entrada default
//     de "Preparación PMP" para que el dashboard nunca esté vacío (el
//     simulador siempre vive).
// ---------------------------------------------------------------------------
exports.getDashboardAlumno = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true || claims.admin === true;

        if (!isProfesor) {
            try {
                await validateSession(request.auth.uid, request.data?.sessionId, claims);
            } catch (e) {
                // No tirar el dashboard por un sessionId stale: solo loguear.
                console.warn("validateSession en dashboard (no-fatal):", e?.message);
            }
        }

        const db = admin.firestore();
        const uid = request.auth.uid;

        // Lectura tolerante a fallos de tracks y progreso.
        let tracksDocs = [];
        let progresoDocs = [];
        try {
            const [tracksSnap, progresoSnap] = await Promise.all([
                db.collection("tracks").orderBy("orden", "asc").get(),
                db.collection("progreso").where("uid", "==", uid).get(),
            ]);
            tracksDocs = tracksSnap.docs;
            progresoSnap.forEach((d) => progresoDocs.push(d));
        } catch (e) {
            console.error("Error leyendo tracks/progreso (no-fatal):", e?.message);
        }

        const progresoPorLeccion = new Map();
        progresoDocs.forEach((d) => {
            const p = d.data();
            progresoPorLeccion.set(p.leccionId, p);
        });

        const tracks = [];
        for (const tdoc of tracksDocs) {
            try {
                const t = tdoc.data() || {};
                let cursosDocs = [];
                try {
                    const cursosSnap = await tdoc.ref.collection("cursos").orderBy("orden", "asc").get();
                    cursosDocs = cursosSnap.docs;
                } catch (e) {
                    console.warn(`Track ${tdoc.id}: error leyendo cursos:`, e?.message);
                }

                let totalLecciones = 0;
                let completadas = 0;
                let proximaLeccion = null;

                for (const cdoc of cursosDocs) {
                    let lecDocs = [];
                    try {
                        // SIN where compuesto: traemos todas las lecciones del curso ordenadas
                        // y filtramos status=published en código (evita necesidad de índice).
                        const lecSnap = await cdoc.ref.collection("lecciones").orderBy("orden", "asc").get();
                        lecDocs = lecSnap.docs;
                    } catch (e) {
                        console.warn(`Curso ${cdoc.id}: error leyendo lecciones:`, e?.message);
                    }

                    for (const ldoc of lecDocs) {
                        const ld = ldoc.data() || {};
                        if (ld.status !== "published") continue; // filtro en memoria
                        totalLecciones++;
                        const p = progresoPorLeccion.get(ldoc.id);
                        if (p?.completada) {
                            completadas++;
                        } else if (!proximaLeccion) {
                            proximaLeccion = {
                                leccionId: ldoc.id,
                                cursoId: cdoc.id,
                                cursoTitulo: cdoc.data()?.titulo || "",
                                cursoOrden: cdoc.data()?.orden || 0,
                                titulo: ld.titulo || "",
                                orden: ld.orden || 0,
                                tiempoEstimadoMin: ld.tiempoEstimadoMin || null,
                            };
                        }
                    }
                }

                tracks.push({
                    id: tdoc.id,
                    titulo: t.titulo || tdoc.id,
                    descripcionCorta: t.descripcionCorta || "",
                    siglas: t.siglas || "",
                    colorHex: t.colorHex || "#2563eb",
                    paletaIconBg: t.paletaIconBg || "#eff6ff",
                    paletaIconFg: t.paletaIconFg || "#1e40af",
                    status: t.status || "coming_soon",
                    lecciones_total: totalLecciones,
                    lecciones_completadas: completadas,
                    porcentaje: totalLecciones > 0 ? Math.round((completadas / totalLecciones) * 100) : 0,
                    proximaLeccion,
                });
            } catch (e) {
                console.warn(`Track ${tdoc.id} skipped (no-fatal):`, e?.message);
            }
        }

        // Fallback: si tracks/ está vacío (bootstrap aún no corrido) o todos
        // fallaron, devolvemos un PMP virtual con simulador disponible para que
        // el alumno siempre pueda llegar a algún lado.
        if (tracks.length === 0) {
            tracks.push({
                id: "pmp",
                titulo: "Preparación PMP",
                descripcionCorta: "Apoyo para examen del PMI",
                siglas: "PMP",
                colorHex: "#2563eb",
                paletaIconBg: "#eff6ff",
                paletaIconFg: "#1e40af",
                status: "available",
                lecciones_total: 0,
                lecciones_completadas: 0,
                porcentaje: 0,
                proximaLeccion: null,
            });
        }

        const totalLeccionesGlobal = tracks.reduce((acc, t) => acc + t.lecciones_total, 0);
        const totalCompletadasGlobal = tracks.reduce((acc, t) => acc + t.lecciones_completadas, 0);

        return {
            tracks,
            resumen: {
                tracksActivos: tracks.filter((t) => t.status === "available").length,
                leccionesCompletadas: totalCompletadasGlobal,
                leccionesTotal: totalLeccionesGlobal,
            },
        };
    }
);
