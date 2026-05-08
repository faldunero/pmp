/**
 * Cargador de contenido de lecciones a Firestore.
 *
 * Lee `contenido_pmp/*.json` y sube cada uno al doc correspondiente del track PMP.
 *
 * Uso:
 *   node scripts/cargar_contenido_pmp.js
 *
 * Comportamiento:
 *   - Si el archivo aún tiene marcadores [ENTRE CORCHETES] → omite (no completado).
 *   - Si está completo y `publicar: true` → guarda con status "published" (visible).
 *   - Si está completo y `publicar: false` → guarda con status "draft" (oculto al alumno).
 *   - Idempotente: si lo corrés varias veces, solo actualiza lo que cambió.
 *
 * Requisitos:
 *   - llave.json (service account) en la raíz del repo.
 *   - El track PMP debe estar sembrado en Firestore. Si no, corré primero:
 *       node scripts/bootstrap_track_pmp.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const KEY_PATH = path.resolve(__dirname, "..", "llave.json");
const CONTENIDO_DIR = path.resolve(__dirname, "..", "contenido_pmp");

if (!fs.existsSync(KEY_PATH)) {
    console.error("[ERR] No encuentro llave.json en la raíz del repo. Bajá la service account de Firebase Console.");
    process.exit(1);
}
if (!fs.existsSync(CONTENIDO_DIR)) {
    console.error(`[ERR] No encuentro la carpeta ${CONTENIDO_DIR}. Corré primero: node scripts/generar_templates_pmp.js`);
    process.exit(1);
}

const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const TRACK_ID = "pmp";
const TIPOS_VALIDOS = new Set(["parrafo", "titulo", "lista", "callout", "tabla"]);
const VARIANTES_CALLOUT = new Set(["tip_examen", "nota", "ejemplo"]);
const REGEX_PLACEHOLDER = /\[[A-ZÁÉÍÓÚÑ][^\]]*\]/; // [TEXTO ENTRE CORCHETES MAYÚSCULAS]

// ─────────────────────────────────────────────────────────────────────
// Validaciones
// ─────────────────────────────────────────────────────────────────────
function tienePlaceholder(texto) {
    return typeof texto === "string" && REGEX_PLACEHOLDER.test(texto);
}

function validarYNormalizarSecciones(secciones, archivoNombre) {
    if (!Array.isArray(secciones) || secciones.length < 2) {
        throw new Error(`Esperaba al menos 2 secciones (encontradas ${secciones?.length || 0})`);
    }
    if (secciones.length > 30) {
        throw new Error(`Demasiadas secciones (${secciones.length}, máximo 30)`);
    }

    const limpias = [];
    let tieneTipExamen = false;

    for (let i = 0; i < secciones.length; i++) {
        const s = secciones[i];
        if (!s || typeof s !== "object") {
            throw new Error(`Sección ${i + 1}: no es un objeto válido`);
        }
        if (!TIPOS_VALIDOS.has(s.tipo)) {
            throw new Error(`Sección ${i + 1}: tipo inválido "${s.tipo}". Válidos: ${[...TIPOS_VALIDOS].join(", ")}`);
        }

        switch (s.tipo) {
            case "parrafo":
            case "titulo": {
                if (typeof s.texto !== "string" || s.texto.trim().length < 5) {
                    throw new Error(`Sección ${i + 1} (${s.tipo}): texto vacío o muy corto`);
                }
                if (s.texto.length > 4000) {
                    throw new Error(`Sección ${i + 1} (${s.tipo}): texto muy largo (>4000 chars)`);
                }
                if (tienePlaceholder(s.texto)) {
                    throw new Error(`Sección ${i + 1} (${s.tipo}): contiene placeholder sin reemplazar (ej: [TEXTO])`);
                }
                limpias.push({ tipo: s.tipo, texto: s.texto.trim() });
                break;
            }
            case "lista": {
                if (!Array.isArray(s.items) || s.items.length < 2) {
                    throw new Error(`Sección ${i + 1} (lista): mínimo 2 items`);
                }
                if (s.items.length > 15) {
                    throw new Error(`Sección ${i + 1} (lista): máximo 15 items`);
                }
                const itemsLimpios = s.items.map((it, j) => {
                    if (typeof it !== "string" || it.trim().length < 3) {
                        throw new Error(`Sección ${i + 1} (lista), item ${j + 1}: texto vacío o muy corto`);
                    }
                    if (it.length > 800) {
                        throw new Error(`Sección ${i + 1} (lista), item ${j + 1}: muy largo (>800 chars)`);
                    }
                    if (tienePlaceholder(it)) {
                        throw new Error(`Sección ${i + 1} (lista), item ${j + 1}: contiene placeholder`);
                    }
                    return it.trim();
                });
                limpias.push({ tipo: "lista", items: itemsLimpios });
                break;
            }
            case "callout": {
                if (!VARIANTES_CALLOUT.has(s.variante)) {
                    throw new Error(`Sección ${i + 1} (callout): variante inválida "${s.variante}". Válidas: ${[...VARIANTES_CALLOUT].join(", ")}`);
                }
                if (typeof s.texto !== "string" || s.texto.trim().length < 10) {
                    throw new Error(`Sección ${i + 1} (callout): texto muy corto (mínimo 10 chars)`);
                }
                if (s.texto.length > 2000) {
                    throw new Error(`Sección ${i + 1} (callout): texto muy largo (>2000 chars)`);
                }
                if (tienePlaceholder(s.texto)) {
                    throw new Error(`Sección ${i + 1} (callout): contiene placeholder`);
                }
                if (s.variante === "tip_examen") tieneTipExamen = true;
                limpias.push({ tipo: "callout", variante: s.variante, texto: s.texto.trim() });
                break;
            }
            case "tabla": {
                if (!Array.isArray(s.headers) || s.headers.length < 2 || s.headers.length > 6) {
                    throw new Error(`Sección ${i + 1} (tabla): headers fuera de rango (2-6)`);
                }
                if (!Array.isArray(s.filas) || s.filas.length < 1 || s.filas.length > 12) {
                    throw new Error(`Sección ${i + 1} (tabla): filas fuera de rango (1-12)`);
                }
                const headers = s.headers.map((h) => String(h).trim().slice(0, 100));
                const filas = s.filas.map((fila, j) => {
                    if (!Array.isArray(fila) || fila.length !== headers.length) {
                        throw new Error(`Sección ${i + 1} (tabla), fila ${j + 1}: cantidad de columnas no coincide con headers`);
                    }
                    return fila.map((c) => {
                        const txt = String(c).trim().slice(0, 500);
                        if (tienePlaceholder(txt)) {
                            throw new Error(`Sección ${i + 1} (tabla): celda contiene placeholder`);
                        }
                        return txt;
                    });
                });
                limpias.push({ tipo: "tabla", headers, filas });
                break;
            }
        }
    }

    if (!tieneTipExamen) {
        throw new Error("Falta al menos un callout de variante 'tip_examen'");
    }

    return { secciones: limpias };
}

function contarPalabras(secciones) {
    let n = 0;
    for (const s of secciones) {
        if (s.texto) n += s.texto.split(/\s+/).filter(Boolean).length;
        if (Array.isArray(s.items)) for (const it of s.items) n += String(it).split(/\s+/).filter(Boolean).length;
        if (Array.isArray(s.filas)) for (const f of s.filas) for (const c of f) n += String(c).split(/\s+/).filter(Boolean).length;
    }
    return n;
}

// ─────────────────────────────────────────────────────────────────────
// Encuentra el cursoId a partir del leccionId.
// El leccionId tiene formato `${cursoId}_l${orden}`, ej: "01-fundamentos-pmbok_l03"
// ─────────────────────────────────────────────────────────────────────
function parsearIds(archivoNombre) {
    const base = archivoNombre.replace(/\.json$/i, "");
    const m = base.match(/^(.+)_l(\d+)$/);
    if (!m) return null;
    return { cursoId: m[1], leccionId: base, orden: parseInt(m[2], 10) };
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main() {
    const archivos = fs.readdirSync(CONTENIDO_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();

    if (archivos.length === 0) {
        console.error(`[ERR] No hay archivos .json en ${CONTENIDO_DIR}.`);
        console.error(`      Corré primero: node scripts/generar_templates_pmp.js`);
        process.exit(1);
    }

    console.log(`[INFO] Procesando ${archivos.length} archivos de contenido...`);
    console.log(``);

    const stats = { publicadas: 0, draft: 0, omitidas: 0, errores: 0, sinCambios: 0 };

    for (const archivo of archivos) {
        const ruta = path.join(CONTENIDO_DIR, archivo);
        const ids = parsearIds(archivo);
        if (!ids) {
            console.warn(`[SKIP] ${archivo} — nombre no coincide con patrón cursoId_lXX.json`);
            stats.omitidas++;
            continue;
        }

        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(ruta, "utf8"));
        } catch (e) {
            console.error(`[ERR ] ${archivo} — JSON inválido: ${e.message}`);
            stats.errores++;
            continue;
        }

        // Validar y normalizar el contenido
        let contenido;
        try {
            contenido = validarYNormalizarSecciones(raw.secciones, archivo);
        } catch (e) {
            // Si la lección aún tiene placeholders es esperado: la omitimos en silencio
            if (/placeholder/i.test(e.message)) {
                stats.omitidas++;
                continue;
            }
            console.error(`[ERR ] ${archivo} — ${e.message}`);
            stats.errores++;
            continue;
        }

        // Subir a Firestore
        const refLeccion = db
            .collection("tracks").doc(TRACK_ID)
            .collection("cursos").doc(ids.cursoId)
            .collection("lecciones").doc(ids.leccionId);

        try {
            const snap = await refLeccion.get();
            if (!snap.exists) {
                console.warn(`[WARN] ${archivo} — la lección no existe en Firestore. Corré bootstrap_track_pmp.js primero.`);
                stats.errores++;
                continue;
            }

            const palabras = contarPalabras(contenido.secciones);
            const publicar = raw.publicar === true;
            const status = publicar ? "published" : "draft";

            // Detectar si hubo cambios (comparación rápida por número de secciones + palabras)
            const datosActuales = snap.data() || {};
            const sinCambios =
                datosActuales.contenido &&
                datosActuales.contenido.secciones?.length === contenido.secciones.length &&
                datosActuales.palabras === palabras &&
                datosActuales.status === status;

            if (sinCambios) {
                stats.sinCambios++;
                continue;
            }

            const payload = {
                contenido,
                palabras,
                status,
                generadoPor: "human",
                editadoEn: FieldValue.serverTimestamp(),
                actualizadoEn: FieldValue.serverTimestamp(),
            };
            if (publicar && !datosActuales.publicadoEn) {
                payload.publicadoEn = FieldValue.serverTimestamp();
            }

            await refLeccion.set(payload, { merge: true });

            const indicador = publicar ? "✓ PUBLICADA" : "→ borrador  ";
            console.log(`[OK  ] ${indicador} ${archivo} — ${palabras} palabras, ${contenido.secciones.length} secciones`);
            if (publicar) stats.publicadas++;
            else stats.draft++;
        } catch (e) {
            console.error(`[ERR ] ${archivo} — error al escribir Firestore: ${e.message}`);
            stats.errores++;
        }
    }

    console.log(``);
    console.log(`[RESUMEN]`);
    console.log(`  Publicadas:     ${stats.publicadas}`);
    console.log(`  En borrador:    ${stats.draft}`);
    console.log(`  Sin cambios:    ${stats.sinCambios}`);
    console.log(`  Omitidas:       ${stats.omitidas} (placeholders sin reemplazar)`);
    console.log(`  Errores:        ${stats.errores}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("[FATAL]", e);
        process.exit(99);
    });
