/**
 * Utilidades compartidas: sanitización, validación, helpers de auth.
 */
"use strict";

const { HttpsError } = require("firebase-functions/v2/https");

// --- Sanitización HTML mínima (sin librería externa para mantener deps livianas) ---
// Reemplaza caracteres que tienen significado en HTML por entidades.
// Usar para todo string que vaya a renderizarse en el cliente con innerHTML.
function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// --- Neutralización de CSV/Formula injection ---
// Si una celda empieza con =, +, -, @, \t o \r, podría ejecutar fórmulas
// si alguien luego abre los datos en Excel/Sheets. La defensa estándar
// es prefijar la celda con apóstrofo para que se lea como texto literal.
function neutralizeFormulaInjection(str) {
    if (str == null) return "";
    const s = String(str);
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
}

// --- Auth helpers ---

// Lanza si el caller no está autenticado.
function assertAuth(request) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }
}

// Lanza si el caller no es profesor (custom claim).
// Nota: cuando promovemos a alguien a admin, también le seteamos profesor=true,
// por lo que un admin pasa este chequeo automáticamente.
function assertProfesor(request) {
    assertAuth(request);
    const claims = request.auth.token || {};
    if (claims.profesor !== true) {
        throw new HttpsError(
            "permission-denied",
            "Esta acción requiere permisos de profesor."
        );
    }
}

// Lanza si el caller no es admin (custom claim).
// Admin es el rol con más privilegios: gestiona profesores, ve pagos, refunds.
function assertAdmin(request) {
    assertAuth(request);
    const claims = request.auth.token || {};
    if (claims.admin !== true) {
        throw new HttpsError(
            "permission-denied",
            "Esta acción requiere permisos de admin."
        );
    }
}

// Lanza si el caller no tiene email verificado.
// Profesor/admin pasan automáticamente (su rol viene de un proceso fuera de
// la web, no podemos exigirles verificación que probablemente no hicieron).
// Para alumnos: bloquea spam de cuentas con emails descartables / inválidos.
function assertEmailVerified(request) {
    assertAuth(request);
    const claims = request.auth.token || {};
    if (claims.profesor === true || claims.admin === true) return;
    if (claims.email_verified !== true) {
        throw new HttpsError(
            "permission-denied",
            "Tenés que verificar tu correo electrónico antes de continuar. Revisá tu bandeja de entrada (y la de spam) y hacé click en el enlace que te enviamos.",
            { reason: "email_not_verified" }
        );
    }
}

// --- Validación de payload de pregunta ---
const RESPUESTAS_VALIDAS = new Set(["A", "B", "C", "D"]);
const MAX_ENUNCIADO = 4000;
const MAX_OPCION = 1000;
const MAX_EXPLICACION = 4000;
const MAX_META = 500;

function validateQuestion(q, idx) {
    const errors = [];
    if (!q || typeof q !== "object") {
        return { valid: false, errors: [`Fila ${idx}: registro inválido`] };
    }
    if (!q.enunciado || typeof q.enunciado !== "string") {
        errors.push(`Fila ${idx}: enunciado vacío`);
    } else if (q.enunciado.length > MAX_ENUNCIADO) {
        errors.push(`Fila ${idx}: enunciado excede ${MAX_ENUNCIADO} chars`);
    }
    if (!q.opciones || typeof q.opciones !== "object") {
        errors.push(`Fila ${idx}: opciones ausentes`);
    } else {
        ["A", "B", "C", "D"].forEach((k) => {
            const v = q.opciones[k];
            if (!v || typeof v !== "string") {
                errors.push(`Fila ${idx}: opción ${k} vacía`);
            } else if (v.length > MAX_OPCION) {
                errors.push(`Fila ${idx}: opción ${k} muy larga`);
            }
        });
    }
    if (!RESPUESTAS_VALIDAS.has(q.respuesta_correcta)) {
        errors.push(
            `Fila ${idx}: respuesta_correcta inválida (${q.respuesta_correcta})`
        );
    }
    if (q.explicacion && q.explicacion.length > MAX_EXPLICACION) {
        errors.push(`Fila ${idx}: explicación muy larga`);
    }
    return { valid: errors.length === 0, errors };
}

function clampString(s, max) {
    if (s == null) return "";
    const str = String(s).trim();
    return str.length > max ? str.slice(0, max) : str;
}

module.exports = {
    escapeHtml,
    neutralizeFormulaInjection,
    assertAuth,
    assertProfesor,
    assertAdmin,
    assertEmailVerified,
    validateQuestion,
    clampString,
    MAX_ENUNCIADO,
    MAX_OPCION,
    MAX_EXPLICACION,
    MAX_META,
};
