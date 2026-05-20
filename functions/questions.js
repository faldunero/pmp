/**
 * Cloud Functions del banco de preguntas.
 *
 * Endurecimiento de seguridad:
 *   • respuesta_correcta NUNCA se devuelve a alumnos (solo profesor/admin).
 *     El alumno no puede saber la respuesta antes de marcarla.
 *   • El puntaje se calcula server-side en gradeAttempt; el cliente solo
 *     manda las respuestas elegidas. Esto cierra el bypass donde un
 *     alumno se auto-correige.
 *   • Email verificado obligatorio para getQuestions / gradeAttempt
 *     (excepto profesor/admin, que pasan por otro proceso de alta).
 *   • Rate limit per-uid: máximo 60 invocaciones de getQuestions por hora,
 *     suficiente para uso humano normal y rompe el scraping automatizado.
 */
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const xlsx = require("xlsx");
const Papa = require("papaparse");

const {
    assertAuth,
    assertProfesor,
    assertEmailVerified,
    validateQuestion,
    neutralizeFormulaInjection,
    clampString,
    MAX_ENUNCIADO,
    MAX_OPCION,
    MAX_EXPLICACION,
    MAX_META,
} = require("./utils");
const { checkAndConsumeAccess } = require("./access");
const { checkAndConsumeRateLimit } = require("./rate_limit");
const { validateSession } = require("./sessions");

const COLECCION = "preguntas_pmp";
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_FILAS = 5000;
const BATCH_SIZE = 400; // Firestore batch límite es 500 ops, dejamos margen

// Cupos de rate limiting (por hora).
const RATE_LIMIT_GET_QUESTIONS = 60;
const RATE_LIMIT_GRADE_ATTEMPT = 120;

// ----------------------------------------------------------------------------
// stripCorrectAnswers — saca el campo respuesta_correcta de cada pregunta
// antes de mandarla al alumno.
// ----------------------------------------------------------------------------
function stripCorrectAnswers(questions) {
    return questions.map((q) => {
        const { respuesta_correcta, Respuesta_correcta, respuesta, ...rest } = q;
        return rest;
    });
}

// ----------------------------------------------------------------------------
// getQuestions
// ----------------------------------------------------------------------------
exports.getQuestions = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);

        const requestedSize = Number(request.data?.requestedSize) || 0;
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true || claims.admin === true;

        if (!isProfesor) {
            await validateSession(request.auth.uid, request.data?.sessionId, claims);
            assertEmailVerified(request);
            await checkAndConsumeRateLimit(
                request.auth.uid,
                "getQuestions",
                RATE_LIMIT_GET_QUESTIONS
            );
        }

        await checkAndConsumeAccess(request.auth.uid, claims, requestedSize);

        const db = admin.firestore();
        const snap = await db.collection(COLECCION).get();
        const raw = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        const questions = isProfesor ? raw : stripCorrectAnswers(raw);
        return { questions, total: questions.length };
    }
);

// ----------------------------------------------------------------------------
// gradeAttempt
// ----------------------------------------------------------------------------
exports.gradeAttempt = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true || claims.admin === true;

        if (!isProfesor) {
            await validateSession(request.auth.uid, request.data?.sessionId, claims);
            assertEmailVerified(request);
            await checkAndConsumeRateLimit(
                request.auth.uid,
                "gradeAttempt",
                RATE_LIMIT_GRADE_ATTEMPT
            );
        }

        const { answers } = request.data || {};
        if (!answers || typeof answers !== "object") {
            throw new HttpsError("invalid-argument", "answers requerido.");
        }

        const ids = Object.keys(answers).slice(0, 500);
        if (ids.length === 0) {
            return { score: 0, total: 0, details: [] };
        }

        const db = admin.firestore();
        const CHUNK = 30;
        const details = [];
        let correct = 0;

        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK);
            const refs = chunk.map((id) => db.collection(COLECCION).doc(id));
            const docs = await db.getAll(...refs);
            docs.forEach((doc) => {
                if (!doc.exists) return;
                const data = doc.data();
                const correctAnswer =
                    data.respuesta_correcta ||
                    data.Respuesta_correcta ||
                    data.respuesta ||
                    null;
                const userPick = answers[doc.id];
                const ok = correctAnswer && userPick === correctAnswer;
                if (ok) correct++;
                details.push({
                    id: doc.id,
                    correctAnswer,
                    userAnswer: userPick || null,
                    correct: !!ok,
                });
            });
        }

        return { score: correct, total: ids.length, details };
    }
);

// ----------------------------------------------------------------------------
// getQuestionsByIds
// Recibe { ids: ["pregunta_001", "pregunta_002", ...] }
// Se usa para reconstruir el reporte de una sesión histórica. El alumno ya
// respondió y el test ya fue calificado — no hay bypass posible.
// Devuelve preguntas CON respuesta_correcta para poder mostrar el detalle.
// Máximo 200 IDs por llamada (un simulacro completo cabe en una sola llamada).
// ----------------------------------------------------------------------------
exports.getQuestionsByIds = onCall(
    { region: "us-central1", maxInstances: 20 },
    async (request) => {
        assertAuth(request);
        const claims = request.auth.token || {};
        const isProfesor = claims.profesor === true || claims.admin === true;

        if (!isProfesor) {
            assertEmailVerified(request);
            await checkAndConsumeRateLimit(
                request.auth.uid,
                "getQuestionsByIds",
                120 // 120 por hora — suficiente para revisar historial
            );
        }

        const ids = request.data?.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new HttpsError("invalid-argument", "ids requerido (array).");
        }
        if (ids.length > 200) {
            throw new HttpsError("invalid-argument", "Máximo 200 ids por llamada.");
        }

        const db = admin.firestore();
        const CHUNK = 30;
        const questions = [];

        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK);
            const refs = chunk.map((id) => db.collection(COLECCION).doc(id));
            const docs = await db.getAll(...refs);
            docs.forEach((doc) => {
                if (doc.exists) questions.push({ id: doc.id, ...doc.data() });
            });
        }

        return { questions };
    }
);

// ----------------------------------------------------------------------------
// uploadQuestions
// ----------------------------------------------------------------------------
exports.uploadQuestions = onCall(
    {
        region: "us-central1",
        maxInstances: 5,
        memory: "512MiB",
        timeoutSeconds: 300,
    },
    async (request) => {
        assertProfesor(request);

        const { fileBase64, filename, mode } = request.data || {};
        if (typeof fileBase64 !== "string" || !filename) {
            throw new HttpsError(
                "invalid-argument",
                "fileBase64 y filename son requeridos."
            );
        }

        const buffer = Buffer.from(fileBase64, "base64");
        if (buffer.length === 0) {
            throw new HttpsError("invalid-argument", "Archivo vacío.");
        }
        if (buffer.length > MAX_FILE_BYTES) {
            throw new HttpsError(
                "invalid-argument",
                `Archivo supera el límite de ${MAX_FILE_BYTES} bytes.`
            );
        }

        const lower = filename.toLowerCase();
        let rows;

        try {
            if (lower.endsWith(".csv")) {
                rows = parseCsvBuffer(buffer);
            } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
                rows = parseXlsxBuffer(buffer);
            } else {
                throw new HttpsError(
                    "invalid-argument",
                    "Formato no soportado. Usa .xlsx, .xls o .csv."
                );
            }
        } catch (e) {
            if (e instanceof HttpsError) throw e;
            logger.error("Parse error en uploadQuestions", e);
            throw new HttpsError(
                "invalid-argument",
                "No pude parsear el archivo: " + (e.message || "desconocido")
            );
        }

        if (rows.length === 0) {
            throw new HttpsError("invalid-argument", "El archivo no tiene filas.");
        }
        if (rows.length > MAX_FILAS) {
            throw new HttpsError(
                "invalid-argument",
                `El archivo tiene ${rows.length} filas, máximo ${MAX_FILAS}.`
            );
        }

        const validated = [];
        const errors = [];
        rows.forEach((raw, i) => {
            const pregunta = normalizeRow(raw);
            const { valid, errors: fieldErrors } = validateQuestion(
                pregunta,
                i + 2
            );
            if (valid) {
                validated.push(pregunta);
            } else {
                errors.push(...fieldErrors);
            }
        });

        if (validated.length === 0) {
            throw new HttpsError("invalid-argument", "No hay filas válidas.", {
                errors: errors.slice(0, 50),
            });
        }

        const db = admin.firestore();
        const replace = mode === "replace";

        if (replace) {
            await deleteCollection(db, COLECCION, BATCH_SIZE);
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        let written = 0;
        for (let i = 0; i < validated.length; i += BATCH_SIZE) {
            const slice = validated.slice(i, i + BATCH_SIZE);
            const batch = db.batch();
            slice.forEach((q) => {
                const docId =
                    q.id != null
                        ? `pregunta_${String(q.id).padStart(3, "0")}`
                        : db.collection(COLECCION).doc().id;
                const ref = db.collection(COLECCION).doc(docId);
                batch.set(ref, {
                    ...q,
                    creadoPor: request.auth.uid,
                    actualizadoEn: now,
                    ...(replace || !q.creadoEn ? { creadoEn: now } : {}),
                });
            });
            await batch.commit();
            written += slice.length;
        }

        logger.info("uploadQuestions completado", {
            actor: request.auth.uid,
            filename,
            mode: replace ? "replace" : "append",
            written,
            invalidCount: errors.length,
        });

        return {
            ok: true,
            written,
            invalidCount: errors.length,
            invalidSample: errors.slice(0, 20),
            mode: replace ? "replace" : "append",
        };
    }
);

// ----------------------------------------------------------------------------
// Parsers
// ----------------------------------------------------------------------------

function parseCsvBuffer(buffer) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const firstLine = text.split(/\r?\n/)[0] || "";
    const delim = firstLine.split(";").length > firstLine.split(",").length
        ? ";"
        : ",";
    const result = Papa.parse(text, {
        header: true,
        delimiter: delim,
        skipEmptyLines: true,
    });
    if (result.errors && result.errors.length) {
        const firstErr = result.errors[0];
        throw new Error(`CSV inválido: ${firstErr.message}`);
    }
    return result.data;
}

function parseXlsxBuffer(buffer) {
    const wb = xlsx.read(buffer, { type: "buffer", cellDates: false });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error("XLSX sin hojas");
    const sheet = wb.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function normalizeRow(row) {
    const get = (...keys) => {
        for (const k of keys) {
            if (row[k] != null && String(row[k]).trim() !== "") return row[k];
        }
        return "";
    };

    const idRaw = get("N°", "No", "Nro", "id", "ID");
    let id = null;
    if (idRaw !== "" && idRaw != null) {
        const n = parseInt(idRaw, 10);
        if (!Number.isNaN(n)) id = n;
    }

    const enunciado = clampString(
        neutralizeFormulaInjection(get("Pregunta", "enunciado", "Enunciado")),
        MAX_ENUNCIADO
    );

    const opciones = {
        A: clampString(neutralizeFormulaInjection(get("Opción A", "Opcion A", "A")), MAX_OPCION),
        B: clampString(neutralizeFormulaInjection(get("Opción B", "Opcion B", "B")), MAX_OPCION),
        C: clampString(neutralizeFormulaInjection(get("Opción C", "Opcion C", "C")), MAX_OPCION),
        D: clampString(neutralizeFormulaInjection(get("Opción D", "Opcion D", "D")), MAX_OPCION),
    };

    const respuesta_correcta = String(
        get("Respuesta\nCorrecta", "Respuesta Correcta", "RespuestaCorrecta", "respuesta_correcta")
    )
        .trim()
        .toUpperCase();

    const explicacion = clampString(
        neutralizeFormulaInjection(get("Explicación", "Explicacion", "explicacion")),
        MAX_EXPLICACION
    );

    const dominio_eco = clampString(
        neutralizeFormulaInjection(get("Dominio ECO", "Dominio", "dominio_eco")),
        MAX_META
    );
    const oficial_pmi = clampString(
        neutralizeFormulaInjection(
            get("Tarea ECO (Oficial PMI)", "Tarea ECO", "oficial_pmi")
        ),
        MAX_META
    );
    const enfoque = clampString(
        neutralizeFormulaInjection(get("Enfoque", "enfoque")),
        MAX_META
    );
    const mindset_clave = clampString(
        neutralizeFormulaInjection(
            get("Trick PMP / Mindset (Clave)", "Mindset", "mindset_clave")
        ),
        MAX_META
    );

    return {
        id,
        enunciado,
        opciones,
        respuesta_correcta,
        explicacion,
        dominio_eco,
        oficial_pmi,
        enfoque,
        mindset_clave,
    };
}

// ----------------------------------------------------------------------------
// Borrado de colección (modo replace)
// ----------------------------------------------------------------------------
async function deleteCollection(db, path, batchSize) {
    const ref = db.collection(path);
    const query = ref.orderBy("__name__").limit(batchSize);
    while (true) {
        const snap = await query.get();
        if (snap.empty) return;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        if (snap.size < batchSize) return;
    }
}
