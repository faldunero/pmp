/**
 * Generación de contenido didáctico con Claude (Anthropic API).
 *
 * Modelo: claude-sonnet-4-6 (config por defecto, configurable).
 *
 * Este módulo expone callables admin-only que generan o regeneran el
 * contenido de una lección. El secreto ANTHROPIC_API_KEY vive en Firebase
 * Secret Manager. NUNCA toca el cliente.
 *
 * Formato del contenido generado:
 *   {
 *     secciones: [
 *       { tipo: "parrafo", texto: "..." },
 *       { tipo: "titulo",  texto: "..." },
 *       { tipo: "lista",   items: ["...", "..."] },
 *       { tipo: "callout", variante: "tip_examen|nota|ejemplo", texto: "..." },
 *       { tipo: "tabla",   headers: [...], filas: [[...], [...]] },
 *     ]
 *   }
 *
 * El cliente lo renderiza recorriendo `secciones` y aplicando un componente
 * por tipo. Esto deja el storage limpio (no markdown ambiguo, no HTML que
 * pueda meter scripts) y permite editar a mano un campo individual.
 */
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");
const { assertAdmin } = require("./utils");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// Modelo por defecto — puede sobreescribirse desde el cliente con `modelo` en el payload.
const MODELO_DEFAULT = "claude-sonnet-4-6";
const MODELOS_VALIDOS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6"];

// Tipos permitidos en el contenido estructurado.
const TIPOS_SECCION = new Set(["parrafo", "titulo", "lista", "callout", "tabla"]);
const VARIANTES_CALLOUT = new Set(["tip_examen", "nota", "ejemplo"]);

// ---------------------------------------------------------------------------
// Helper: arma el prompt para generar una lección.
// La prompt completa va a `system`; el `user` lleva los datos concretos.
// ---------------------------------------------------------------------------
function armarPrompt(datos) {
    const { trackTitulo, cursoTitulo, cursoOrden, cursoTotalLecciones, leccionTitulo, leccionOrden, tiempoMin } = datos;
    const wordsTarget = Math.max(400, tiempoMin * 50); // ~50 palabras por minuto de lectura
    const wordsRange = `${Math.round(wordsTarget * 0.8)}–${Math.round(wordsTarget * 1.2)}`;

    const system = `Eres un instructor experto en preparación para certificaciones profesionales. Tu tarea es escribir el contenido didáctico de UNA lección de apoyo de estudio, en formato JSON estructurado.

Reglas estrictas:
1. Escribe en español neutro (latinoamericano profesional). NO uses "vos" ni "vosotros". Prefiere "tú" sobre formas regionales.
2. NUNCA copies texto literal del PMBOK ni de cualquier material con copyright. Reformula con tus propias palabras.
3. Este material es de APOYO INDEPENDIENTE, NO oficial. No afirmes ser el PMI, Axelos, Scrum.org u otra entidad certificadora.
4. Tono didáctico y conversacional, dirigido a un profesional que se prepara para rendir el examen.
5. Estructura recomendada: párrafo introductorio (1-2 secciones de tipo "parrafo") → desarrollo (2-4 secciones combinando "titulo" + "parrafo" + "lista" + "tabla" cuando ayude) → cierre con UN callout de variante "tip_examen" que conecte el contenido con cómo aparece en el examen real.
6. Longitud objetivo: ${wordsRange} palabras totales en el contenido.
7. Los párrafos deben tener entre 2 y 5 oraciones. NO escribas párrafos enormes.
8. Las listas deben tener entre 3 y 7 items. Cada item es una frase clara, no un párrafo.
9. Las tablas son opcionales: úsalas solo si comparas claramente conceptos. Headers cortos.
10. Incluye AL MENOS un callout de tipo "tip_examen". Puedes agregar callouts "nota" o "ejemplo" si suman valor.

Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta forma exacta:

{
  "secciones": [
    { "tipo": "parrafo", "texto": "..." },
    { "tipo": "titulo", "texto": "..." },
    { "tipo": "lista", "items": ["...", "...", "..."] },
    { "tipo": "callout", "variante": "tip_examen", "texto": "..." },
    { "tipo": "tabla", "headers": ["...", "..."], "filas": [["...", "..."], ["...", "..."]] }
  ]
}

Tipos válidos: parrafo, titulo, lista, callout, tabla.
Variantes de callout: tip_examen, nota, ejemplo.

NO incluyas texto fuera del JSON. NO uses markdown. NO uses HTML. NO uses comentarios. NO incluyas claves adicionales.`;

    const user = `Genera la lección con estos datos:

- Track: ${trackTitulo}
- Curso: ${cursoOrden}. ${cursoTitulo}
- Lección: ${leccionOrden} de ${cursoTotalLecciones} dentro del curso
- Título de la lección: "${leccionTitulo}"
- Tiempo estimado de lectura: ${tiempoMin} minutos (~${wordsRange} palabras totales)

Devuelve únicamente el JSON con la estructura indicada.`;

    return { system, user };
}

// ---------------------------------------------------------------------------
// Helper: valida y limpia el JSON que devolvió Claude. Si algo no encaja,
// lanza error en vez de guardar basura.
// ---------------------------------------------------------------------------
function validarContenido(parsed) {
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.secciones)) {
        throw new HttpsError("internal", "El modelo devolvió un formato inválido (sin secciones).");
    }
    if (parsed.secciones.length < 2 || parsed.secciones.length > 30) {
        throw new HttpsError("internal", `Cantidad de secciones fuera de rango: ${parsed.secciones.length}.`);
    }

    const limpias = parsed.secciones.map((s, i) => {
        if (!s || typeof s !== "object" || !TIPOS_SECCION.has(s.tipo)) {
            throw new HttpsError("internal", `Sección ${i} con tipo inválido: ${s?.tipo}`);
        }
        switch (s.tipo) {
            case "parrafo":
            case "titulo":
                if (typeof s.texto !== "string" || s.texto.length < 5 || s.texto.length > 4000) {
                    throw new HttpsError("internal", `Sección ${i} (${s.tipo}) con texto inválido.`);
                }
                return { tipo: s.tipo, texto: s.texto.trim() };
            case "lista":
                if (!Array.isArray(s.items) || s.items.length < 2 || s.items.length > 15) {
                    throw new HttpsError("internal", `Sección ${i} (lista) con items fuera de rango.`);
                }
                return {
                    tipo: "lista",
                    items: s.items.map((it) => {
                        if (typeof it !== "string" || it.length < 3 || it.length > 800) {
                            throw new HttpsError("internal", `Item de lista con texto inválido.`);
                        }
                        return it.trim();
                    }),
                };
            case "callout":
                if (!VARIANTES_CALLOUT.has(s.variante)) {
                    throw new HttpsError("internal", `Callout con variante inválida: ${s.variante}`);
                }
                if (typeof s.texto !== "string" || s.texto.length < 10 || s.texto.length > 2000) {
                    throw new HttpsError("internal", `Callout con texto inválido.`);
                }
                return { tipo: "callout", variante: s.variante, texto: s.texto.trim() };
            case "tabla":
                if (!Array.isArray(s.headers) || s.headers.length < 2 || s.headers.length > 6) {
                    throw new HttpsError("internal", `Tabla con headers fuera de rango.`);
                }
                if (!Array.isArray(s.filas) || s.filas.length < 1 || s.filas.length > 12) {
                    throw new HttpsError("internal", `Tabla con filas fuera de rango.`);
                }
                return {
                    tipo: "tabla",
                    headers: s.headers.map((h) => String(h).trim().slice(0, 100)),
                    filas: s.filas.map((fila) => {
                        if (!Array.isArray(fila) || fila.length !== s.headers.length) {
                            throw new HttpsError("internal", `Fila de tabla con largo desigual.`);
                        }
                        return fila.map((c) => String(c).trim().slice(0, 500));
                    }),
                };
        }
    });

    // Garantizamos que haya al menos un callout tip_examen.
    const hayTip = limpias.some((s) => s.tipo === "callout" && s.variante === "tip_examen");
    if (!hayTip) {
        throw new HttpsError("internal", "El modelo no incluyó el callout de tip de examen requerido.");
    }

    return { secciones: limpias };
}

// ---------------------------------------------------------------------------
// generarLeccionConIA — genera o regenera el contenido de una lección.
//
// Payload: { trackId, cursoId, leccionId, modelo? }
//
// Resultado: { ok: true, leccionId, modelo, palabras, secciones, tokensIn, tokensOut }
//
// Efectos:
//   - Lee la metadata de la lección (título, tiempoMin, etc.) de Firestore.
//   - Llama a Claude con el prompt de arriba.
//   - Valida el JSON.
//   - Escribe `contenido`, `generadoPor=ai`, `modeloIA`, `generadoEn` y deja
//     `status=draft` (no publicado todavía).
// ---------------------------------------------------------------------------
exports.generarLeccionConIA = onCall(
    {
        region: "us-central1",
        secrets: [ANTHROPIC_API_KEY],
        maxInstances: 5,
        timeoutSeconds: 180,
        memory: "512MiB",
    },
    async (request) => {
        assertAdmin(request);

        const { trackId, cursoId, leccionId, modelo } = request.data || {};
        if (!trackId || !cursoId || !leccionId) {
            throw new HttpsError("invalid-argument", "trackId, cursoId y leccionId son requeridos.");
        }
        const modeloAUsar = MODELOS_VALIDOS.includes(modelo) ? modelo : MODELO_DEFAULT;

        const apiKey = ANTHROPIC_API_KEY.value();
        if (!apiKey) {
            throw new HttpsError(
                "failed-precondition",
                "ANTHROPIC_API_KEY no está configurada. Setear con: firebase functions:secrets:set ANTHROPIC_API_KEY"
            );
        }

        const db = admin.firestore();
        const trackRef = db.collection("tracks").doc(trackId);
        const cursoRef = trackRef.collection("cursos").doc(cursoId);
        const leccionRef = cursoRef.collection("lecciones").doc(leccionId);

        const [trackSnap, cursoSnap, leccionSnap] = await Promise.all([
            trackRef.get(),
            cursoRef.get(),
            leccionRef.get(),
        ]);

        if (!trackSnap.exists || !cursoSnap.exists || !leccionSnap.exists) {
            throw new HttpsError("not-found", "Track, curso o lección no encontrados.");
        }
        const track = trackSnap.data();
        const curso = cursoSnap.data();
        const leccion = leccionSnap.data();

        const cursoTotalLeccionesSnap = await cursoRef.collection("lecciones").count().get();
        const cursoTotalLecciones = cursoTotalLeccionesSnap.data().count;

        const { system, user } = armarPrompt({
            trackTitulo: track.titulo,
            cursoTitulo: curso.titulo,
            cursoOrden: curso.orden,
            cursoTotalLecciones,
            leccionTitulo: leccion.titulo,
            leccionOrden: leccion.orden,
            tiempoMin: leccion.tiempoEstimadoMin || 12,
        });

        const client = new Anthropic({ apiKey });
        let respuesta;
        try {
            respuesta = await client.messages.create({
                model: modeloAUsar,
                max_tokens: 3000,
                temperature: 0.7,
                system,
                messages: [{ role: "user", content: user }],
            });
        } catch (e) {
            logger.error("Anthropic API error", { trackId, cursoId, leccionId, error: e?.message });
            throw new HttpsError("internal", `Error al generar contenido: ${e?.message || "desconocido"}`);
        }

        const textoRespuesta = (respuesta.content || [])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("");

        if (!textoRespuesta) {
            throw new HttpsError("internal", "El modelo no devolvió texto.");
        }

        // Claude a veces envuelve el JSON con markdown ```json … ``` aunque le
        // pidamos que no lo haga. Limpiamos defensivamente.
        const jsonRaw = textoRespuesta
            .replace(/^\s*```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .trim();

        let parsed;
        try {
            parsed = JSON.parse(jsonRaw);
        } catch (e) {
            logger.error("JSON parse fail", { jsonRaw: jsonRaw.slice(0, 500) });
            throw new HttpsError("internal", "El modelo devolvió un JSON inválido. Reintenta.");
        }

        const contenido = validarContenido(parsed);
        const palabras = contadorDePalabras(contenido);

        await leccionRef.set(
            {
                contenido,
                palabras,
                status: "draft",
                generadoPor: "ai",
                modeloIA: modeloAUsar,
                generadoEn: admin.firestore.FieldValue.serverTimestamp(),
                generadoPorUid: request.auth.uid,
                actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        // AUDIT
        logger.info("AUDIT_AI_GENERATION lección generada", {
            audit: "ai_generation",
            actor: request.auth.uid,
            trackId,
            cursoId,
            leccionId,
            modelo: modeloAUsar,
            tokensIn: respuesta.usage?.input_tokens || null,
            tokensOut: respuesta.usage?.output_tokens || null,
            palabras,
            ts: new Date().toISOString(),
        });

        return {
            ok: true,
            leccionId,
            modelo: modeloAUsar,
            palabras,
            secciones: contenido.secciones.length,
            tokensIn: respuesta.usage?.input_tokens || null,
            tokensOut: respuesta.usage?.output_tokens || null,
        };
    }
);

function contadorDePalabras(contenido) {
    let n = 0;
    for (const s of contenido.secciones) {
        if (s.texto) n += s.texto.split(/\s+/).filter(Boolean).length;
        if (Array.isArray(s.items)) for (const it of s.items) n += String(it).split(/\s+/).filter(Boolean).length;
        if (Array.isArray(s.filas))
            for (const f of s.filas) for (const c of f) n += String(c).split(/\s+/).filter(Boolean).length;
    }
    return n;
}

// ---------------------------------------------------------------------------
// publicarLeccion — pasa una lección de draft a published. Solo admin.
// ---------------------------------------------------------------------------
exports.publicarLeccion = onCall(
    { region: "us-central1", maxInstances: 5 },
    async (request) => {
        assertAdmin(request);
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
        const data = snap.data();
        if (!data.contenido) {
            throw new HttpsError("failed-precondition", "La lección no tiene contenido. Generá primero.");
        }

        await ref.update({
            status: "published",
            publicadoEn: admin.firestore.FieldValue.serverTimestamp(),
            publicadoPorUid: request.auth.uid,
            actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
        });

        logger.info("AUDIT_LESSON_PUBLISH", {
            audit: "lesson_publish",
            actor: request.auth.uid,
            trackId,
            cursoId,
            leccionId,
            ts: new Date().toISOString(),
        });

        return { ok: true };
    }
);

// ---------------------------------------------------------------------------
// despublicarLeccion — vuelve una publicada a draft (para edición).
// ---------------------------------------------------------------------------
exports.despublicarLeccion = onCall(
    { region: "us-central1", maxInstances: 5 },
    async (request) => {
        assertAdmin(request);
        const { trackId, cursoId, leccionId } = request.data || {};
        if (!trackId || !cursoId || !leccionId) {
            throw new HttpsError("invalid-argument", "trackId, cursoId y leccionId requeridos.");
        }
        const db = admin.firestore();
        const ref = db
            .collection("tracks").doc(trackId)
            .collection("cursos").doc(cursoId)
            .collection("lecciones").doc(leccionId);
        await ref.update({
            status: "draft",
            actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: true };
    }
);

// ---------------------------------------------------------------------------
// actualizarLeccion — edición manual del contenido por parte del admin.
// El admin puede editar texto antes de publicar (corregir tono, agregar
// matices que no salieron bien). Marca `generadoPor: "edited"`.
// ---------------------------------------------------------------------------
exports.actualizarLeccion = onCall(
    { region: "us-central1", maxInstances: 5 },
    async (request) => {
        assertAdmin(request);
        const { trackId, cursoId, leccionId, contenido } = request.data || {};
        if (!trackId || !cursoId || !leccionId) {
            throw new HttpsError("invalid-argument", "trackId, cursoId y leccionId requeridos.");
        }
        if (!contenido) throw new HttpsError("invalid-argument", "contenido requerido.");

        const limpio = validarContenido(contenido);
        const palabras = contadorDePalabras(limpio);

        const db = admin.firestore();
        const ref = db
            .collection("tracks").doc(trackId)
            .collection("cursos").doc(cursoId)
            .collection("lecciones").doc(leccionId);

        await ref.update({
            contenido: limpio,
            palabras,
            generadoPor: "edited",
            editadoPorUid: request.auth.uid,
            editadoEn: admin.firestore.FieldValue.serverTimestamp(),
            actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
        });

        return { ok: true, palabras };
    }
);
