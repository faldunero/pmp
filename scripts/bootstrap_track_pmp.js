/**
 * Bootstrap del track "Preparación PMP" en Firestore.
 *
 * Crea la estructura completa del track con sus 9 cursos y 109 lecciones.
 * TODAS las lecciones quedan en estado `draft` y SIN contenido — solo títulos,
 * orden y tiempo estimado. El contenido real se genera después con Cloud
 * Function `generarLeccionConIA` (corre con la API de Anthropic).
 *
 * Uso:
 *   1. Asegurarse de tener `llave.json` (service account) en la raíz del repo.
 *   2. cd a la raíz del repo y correr:
 *        node scripts/bootstrap_track_pmp.js
 *
 * Idempotente: si los cursos / lecciones ya existen, los actualiza con merge.
 * No borra nada; si decides cambiar la estructura, hacelo manualmente o
 * agregando un script de cleanup.
 */
"use strict";

const path = require("path");
const fs = require("fs");

const KEY_PATH = path.resolve(__dirname, "..", "llave.json");
if (!fs.existsSync(KEY_PATH)) {
    console.error(
        "[ERR] No encuentro llave.json en la raíz del repo. Bajá la service account de Firebase Console."
    );
    process.exit(1);
}

const admin = require("firebase-admin");
admin.initializeApp({
    credential: admin.credential.cert(require(KEY_PATH)),
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ─────────────────────────────────────────────────────────────────────
// Estructura del track PMP — debe coincidir 1:1 con lo diseñado:
//   9 cursos · 109 lecciones · ~24 horas estimadas
// ─────────────────────────────────────────────────────────────────────
const TRACK = {
    id: "pmp",
    titulo: "Preparación PMP",
    descripcionCorta: "Material de apoyo para el examen del Project Management Institute",
    descripcionLarga: "Banco de preguntas y cursos modulares alineados al ECO vigente para que llegues al examen oficial sabiendo cómo te paras. Material de estudio independiente, no oficial.",
    entidad: "Project Management Institute",
    siglas: "PMP",
    colorHex: "#2563eb",
    paletaIconBg: "#dbeafe",
    paletaIconFg: "#1e40af",
    status: "available",
    oficial: false,
    simuladorPreguntasCollection: "preguntas_pmp",
    simuladorTamanos: [20, 40, 60, 80, 100, 120, 140, 180],
    simuladorTamanoExamenCompleto: 180,
    orden: 1,
};

const CURSOS = [
    {
        id: "01-fundamentos-pmbok",
        orden: 1,
        titulo: "Fundamentos del PMBOK",
        descripcion: "Marco conceptual, ciclo de vida, stakeholders y gobernanza",
        tiempoEstimadoMin: 160,
        lecciones: [
            { titulo: "Qué es y qué no es la dirección de proyectos", tiempoMin: 14 },
            { titulo: "El PMBOK: estructura y enfoque del estándar", tiempoMin: 12 },
            { titulo: "Proyecto, programa, portafolio y operaciones", tiempoMin: 12 },
            { titulo: "Ciclos de vida del proyecto", tiempoMin: 14 },
            { titulo: "Áreas de conocimiento del PMBOK", tiempoMin: 16 },
            { titulo: "Grupos de procesos: ITTO en la práctica", tiempoMin: 18 },
            { titulo: "Stakeholders: identificación y clasificación", tiempoMin: 14 },
            { titulo: "Triple restricción: alcance, tiempo, costo", tiempoMin: 12 },
            { titulo: "Gobernanza de proyectos y oficina PMO", tiempoMin: 12 },
            { titulo: "Roles del director de proyectos", tiempoMin: 12 },
            { titulo: "El Talent Triangle del PMI", tiempoMin: 10 },
            { titulo: "Glosario clave del PMBOK", tiempoMin: 14 },
        ],
    },
    {
        id: "02-dominio-personas",
        orden: 2,
        titulo: "Dominio Personas",
        descripcion: "Liderazgo, equipos, conflictos, comunicación efectiva",
        tiempoEstimadoMin: 190,
        lecciones: [
            { titulo: "Liderazgo situacional en proyectos", tiempoMin: 14 },
            { titulo: "Conflictos y técnicas de resolución", tiempoMin: 18 },
            { titulo: "Comunicación con stakeholders", tiempoMin: 12 },
            { titulo: "Servant leadership en equipos ágiles", tiempoMin: 14 },
            { titulo: "Inteligencia emocional del project manager", tiempoMin: 12 },
            { titulo: "Equipos de alto desempeño: cómo construirlos", tiempoMin: 16 },
            { titulo: "Coaching y mentoring del equipo", tiempoMin: 14 },
            { titulo: "Equipos virtuales y distribuidos", tiempoMin: 12 },
            { titulo: "Negociación y persuasión", tiempoMin: 14 },
            { titulo: "Empoderamiento del equipo", tiempoMin: 12 },
            { titulo: "Manejo de stakeholders difíciles", tiempoMin: 14 },
            { titulo: "Diversidad e inclusión en el equipo", tiempoMin: 12 },
            { titulo: "Motivación: teorías clásicas y aplicación", tiempoMin: 14 },
            { titulo: "Reconocimiento y celebración de logros", tiempoMin: 12 },
        ],
    },
    {
        id: "03-dominio-procesos",
        orden: 3,
        titulo: "Dominio Procesos",
        descripcion: "Planificación, ejecución, monitoreo, cierre y entregas",
        tiempoEstimadoMin: 245,
        lecciones: [
            { titulo: "Iniciación: el acta de constitución", tiempoMin: 14 },
            { titulo: "Definir el alcance y la EDT/WBS", tiempoMin: 16 },
            { titulo: "Planificación del cronograma: técnicas clave", tiempoMin: 18 },
            { titulo: "Estimación de costos y línea base", tiempoMin: 16 },
            { titulo: "Plan de gestión de calidad", tiempoMin: 14 },
            { titulo: "Plan de gestión de recursos", tiempoMin: 12 },
            { titulo: "Plan de gestión de comunicaciones", tiempoMin: 12 },
            { titulo: "Plan de gestión de riesgos: identificación y análisis", tiempoMin: 18 },
            { titulo: "Tipos de procesos integradores", tiempoMin: 22 },
            { titulo: "Plan de gestión de adquisiciones", tiempoMin: 14 },
            { titulo: "Ejecución del trabajo: dirigir y gestionar", tiempoMin: 14 },
            { titulo: "Aseguramiento y control de calidad", tiempoMin: 12 },
            { titulo: "Monitoreo de costos: valor ganado (EVM)", tiempoMin: 18 },
            { titulo: "Control integrado de cambios", tiempoMin: 16 },
            { titulo: "Gestión de problemas e incidentes", tiempoMin: 12 },
            { titulo: "Cierre del proyecto o la fase", tiempoMin: 12 },
            { titulo: "Lecciones aprendidas: documentar y compartir", tiempoMin: 12 },
            { titulo: "Métricas y reportes de desempeño", tiempoMin: 13 },
        ],
    },
    {
        id: "04-dominio-entorno",
        orden: 4,
        titulo: "Dominio Entorno de negocio",
        descripcion: "Estrategia, valor, cumplimiento y cambio organizacional",
        tiempoEstimadoMin: 110,
        lecciones: [
            { titulo: "Estrategia organizacional y alineación de proyectos", tiempoMin: 14 },
            { titulo: "Valor del negocio y caso de negocio", tiempoMin: 12 },
            { titulo: "Beneficios: identificación, entrega y sostenibilidad", tiempoMin: 14 },
            { titulo: "Cumplimiento normativo y regulatorio", tiempoMin: 12 },
            { titulo: "Cambio organizacional: gestión y resistencia", tiempoMin: 14 },
            { titulo: "Factores ambientales de la empresa (EEF)", tiempoMin: 10 },
            { titulo: "Activos de los procesos de la organización (OPA)", tiempoMin: 10 },
            { titulo: "Innovación y mejora continua", tiempoMin: 12 },
            { titulo: "Sostenibilidad y proyectos sociales", tiempoMin: 12 },
        ],
    },
    {
        id: "05-enfoques-predictivos",
        orden: 5,
        titulo: "Enfoques predictivos",
        descripcion: "Cascada, gestión clásica de alcance, tiempo y costos",
        tiempoEstimadoMin: 140,
        lecciones: [
            { titulo: "Cuándo elegir un enfoque predictivo", tiempoMin: 12 },
            { titulo: "Definición y baseline del alcance", tiempoMin: 14 },
            { titulo: "Diagrama de Gantt y método de la ruta crítica", tiempoMin: 18 },
            { titulo: "Estimación PERT y por tres puntos", tiempoMin: 14 },
            { titulo: "Curva S y línea base de costos", tiempoMin: 14 },
            { titulo: "Compresión y aceleración del cronograma", tiempoMin: 14 },
            { titulo: "Recursos: nivelación y suavizado", tiempoMin: 12 },
            { titulo: "Plan de gestión del valor ganado", tiempoMin: 16 },
            { titulo: "Cierre formal y aceptación de entregables", tiempoMin: 12 },
            { titulo: "Limitaciones del enfoque predictivo", tiempoMin: 14 },
        ],
    },
    {
        id: "06-enfoques-agiles",
        orden: 6,
        titulo: "Enfoques ágiles",
        descripcion: "Scrum, Kanban, manifiesto ágil y métricas de equipo",
        tiempoEstimadoMin: 170,
        lecciones: [
            { titulo: "Manifiesto ágil: valores y principios", tiempoMin: 12 },
            { titulo: "Scrum: roles, eventos y artefactos", tiempoMin: 16 },
            { titulo: "Product Backlog y refinement", tiempoMin: 14 },
            { titulo: "Sprint Planning y compromiso del equipo", tiempoMin: 14 },
            { titulo: "Daily Stand-up: para qué sí y para qué no", tiempoMin: 12 },
            { titulo: "Sprint Review y demos efectivas", tiempoMin: 12 },
            { titulo: "Retrospectiva: técnicas y antipatrones", tiempoMin: 14 },
            { titulo: "Kanban: flujo, WIP y métricas", tiempoMin: 14 },
            { titulo: "User stories y criterios de aceptación", tiempoMin: 14 },
            { titulo: "Estimación ágil: story points y planning poker", tiempoMin: 14 },
            { titulo: "Velocidad y burndown: lectura correcta", tiempoMin: 12 },
            { titulo: "Escalamiento ágil: SAFe, LeSS, Nexus", tiempoMin: 22 },
        ],
    },
    {
        id: "07-enfoques-hibridos",
        orden: 7,
        titulo: "Enfoques híbridos",
        descripcion: "Combinaciones predictivo-ágil y casos de uso reales",
        tiempoEstimadoMin: 105,
        lecciones: [
            { titulo: "Cuándo y por qué un enfoque híbrido", tiempoMin: 12 },
            { titulo: "Mapas de selección de enfoque", tiempoMin: 14 },
            { titulo: "Caso: producto digital con compliance regulatorio", tiempoMin: 14 },
            { titulo: "Caso: construcción con entregas iterativas", tiempoMin: 14 },
            { titulo: "Métricas mixtas: EVM + velocity", tiempoMin: 14 },
            { titulo: "Riesgos típicos de los híbridos", tiempoMin: 12 },
            { titulo: "Comunicación con stakeholders ante cambios de enfoque", tiempoMin: 12 },
            { titulo: "Errores frecuentes al hibridar", tiempoMin: 13 },
        ],
    },
    {
        id: "08-casos-integradores",
        orden: 8,
        titulo: "Casos integradores",
        descripcion: "Ejercicios prácticos que mezclan los tres dominios",
        tiempoEstimadoMin: 210,
        lecciones: [
            { titulo: "Caso 1: Lanzamiento de producto SaaS", tiempoMin: 14 },
            { titulo: "Caso 2: Migración a la nube en banco regulado", tiempoMin: 14 },
            { titulo: "Caso 3: Construcción de planta solar", tiempoMin: 14 },
            { titulo: "Caso 4: Reorganización post-fusión", tiempoMin: 14 },
            { titulo: "Caso 5: Evento masivo internacional", tiempoMin: 14 },
            { titulo: "Caso 6: Conflicto severo en el equipo", tiempoMin: 14 },
            { titulo: "Caso 7: Stakeholder dominante con visión opuesta", tiempoMin: 14 },
            { titulo: "Caso 8: Cambio crítico en mitad de ejecución", tiempoMin: 14 },
            { titulo: "Caso 9: Proyecto que está fuera de presupuesto", tiempoMin: 14 },
            { titulo: "Caso 10: Equipo distribuido en 5 husos horarios", tiempoMin: 14 },
            { titulo: "Caso 11: Producto que el mercado ya no quiere", tiempoMin: 14 },
            { titulo: "Caso 12: Vendor que incumple plazos repetidamente", tiempoMin: 14 },
            { titulo: "Caso 13: Crisis reputacional del proyecto", tiempoMin: 14 },
            { titulo: "Caso 14: Cierre forzado por decisión externa", tiempoMin: 14 },
            { titulo: "Caso 15: Auditoría externa a mitad del proyecto", tiempoMin: 14 },
        ],
    },
    {
        id: "09-tips-mindset",
        orden: 9,
        titulo: "Tips y mindset de examen",
        descripcion: "Cómo leer enunciados largos, manejo del tiempo, errores comunes",
        tiempoEstimadoMin: 135,
        lecciones: [
            { titulo: "Cómo lee preguntas el PMI: el enfoque del enunciado", tiempoMin: 14 },
            { titulo: "Mindset PMP: la respuesta más profesional, no la más rápida", tiempoMin: 14 },
            { titulo: "Trampas frecuentes: distractores que parecen correctos", tiempoMin: 14 },
            { titulo: "Manejo del tiempo: 230 minutos para 180 preguntas", tiempoMin: 12 },
            { titulo: "Pausas estratégicas en el examen", tiempoMin: 10 },
            { titulo: "Qué hacer cuando dudas entre dos opciones", tiempoMin: 12 },
            { titulo: "Preguntas de drag-and-drop y multiselect", tiempoMin: 12 },
            { titulo: "Cuándo elegir 'comunicar' como respuesta", tiempoMin: 14 },
            { titulo: "Cuándo elegir 'el plan dice X' como respuesta", tiempoMin: 14 },
            { titulo: "Errores típicos del último día antes del examen", tiempoMin: 10 },
            { titulo: "Después del examen: aprobado o no, qué sigue", tiempoMin: 9 },
        ],
    },
];

// ─────────────────────────────────────────────────────────────────────
// Validación rápida — para evitar quedarnos cortos en la siembra.
// ─────────────────────────────────────────────────────────────────────
function validar() {
    const totalCursos = CURSOS.length;
    const totalLecciones = CURSOS.reduce((acc, c) => acc + c.lecciones.length, 0);
    const tiempoTotal = CURSOS.reduce((acc, c) => acc + c.tiempoEstimadoMin, 0);
    console.log(`[INFO] Track ${TRACK.id}: ${totalCursos} cursos, ${totalLecciones} lecciones, ${Math.round(tiempoTotal / 60)} h estimadas`);
    if (totalCursos !== 9) throw new Error(`Esperaba 9 cursos, encontré ${totalCursos}.`);
    if (totalLecciones !== 109) throw new Error(`Esperaba 109 lecciones, encontré ${totalLecciones}.`);
}

// ─────────────────────────────────────────────────────────────────────
// Siembra. Usa merge: true para que correr el script más de una vez no
// pise progreso si ya generaste contenido para alguna lección.
// ─────────────────────────────────────────────────────────────────────
async function sembrar() {
    validar();

    const trackRef = db.collection("tracks").doc(TRACK.id);

    console.log(`[INFO] Sembrando track ${TRACK.id}...`);
    await trackRef.set(
        {
            ...TRACK,
            actualizadoEn: FieldValue.serverTimestamp(),
            sembradoEn: FieldValue.serverTimestamp(),
        },
        { merge: true }
    );

    let totalLeccionesEscritas = 0;

    for (const curso of CURSOS) {
        const cursoRef = trackRef.collection("cursos").doc(curso.id);
        await cursoRef.set(
            {
                id: curso.id,
                titulo: curso.titulo,
                descripcion: curso.descripcion,
                orden: curso.orden,
                tiempoEstimadoMin: curso.tiempoEstimadoMin,
                lecciones_total: curso.lecciones.length,
                status: "draft",
                actualizadoEn: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        for (let i = 0; i < curso.lecciones.length; i++) {
            const l = curso.lecciones[i];
            const orden = i + 1;
            // ID legible para que sea fácil debuggear y citarla.
            const leccionId = `${curso.id}_l${String(orden).padStart(2, "0")}`;
            const leccionRef = cursoRef.collection("lecciones").doc(leccionId);

            // Solo escribimos campos estructurales si la lección no existe.
            // Si ya existe (re-corrida), preservamos el contenido generado.
            const snap = await leccionRef.get();
            const yaExiste = snap.exists;

            const payload = {
                id: leccionId,
                titulo: l.titulo,
                orden,
                tiempoEstimadoMin: l.tiempoMin,
                cursoId: curso.id,
                trackId: TRACK.id,
                actualizadoEn: FieldValue.serverTimestamp(),
            };
            if (!yaExiste) {
                payload.status = "draft";
                payload.contenido = null;
                payload.generadoPor = null;
                payload.modeloIA = null;
                payload.generadoEn = null;
                payload.publicadoEn = null;
                payload.creadoEn = FieldValue.serverTimestamp();
            }

            await leccionRef.set(payload, { merge: true });
            totalLeccionesEscritas++;
        }
        console.log(`[OK]   Curso ${String(curso.orden).padStart(2, "0")} ${curso.titulo} — ${curso.lecciones.length} lecciones`);
    }

    console.log(`[OK]   Track sembrado. Total: ${totalLeccionesEscritas} lecciones.`);
    console.log(`       Próximo paso: setear ANTHROPIC_API_KEY y correr generación con IA.`);
}

sembrar()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("[ERR]", e);
        process.exit(99);
    });
