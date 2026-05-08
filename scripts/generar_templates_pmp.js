/**
 * Generador de templates de contenido para las 109 lecciones del track PMP.
 *
 * Uso (una sola vez):
 *   node scripts/generar_templates_pmp.js
 *
 * Crea la carpeta `contenido_pmp/` con un archivo .json por cada lección.
 * Cada archivo es un esqueleto con campos a completar. El usuario los edita
 * a su ritmo y después corre `cargar_contenido_pmp.js` para subirlos a Firestore.
 *
 * Idempotente: si la carpeta ya existe y un archivo está, NO lo sobrescribe.
 * Eso protege el trabajo ya hecho. Si querés regenerar uno desde cero,
 * borralo a mano y volvé a correr el generador.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DESTINO = path.resolve(__dirname, "..", "contenido_pmp");

// ─────────────────────────────────────────────────────────────────────
// Estructura del track. DEBE coincidir con bootstrap_track_pmp.js.
// Si modificás títulos/orden allá, actualizalos también acá.
// ─────────────────────────────────────────────────────────────────────
const CURSOS = [
    {
        id: "01-fundamentos-pmbok",
        titulo: "Fundamentos del PMBOK",
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
        titulo: "Dominio Personas",
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
        titulo: "Dominio Procesos",
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
        titulo: "Dominio Entorno de negocio",
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
        titulo: "Enfoques predictivos",
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
        titulo: "Enfoques ágiles",
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
        titulo: "Enfoques híbridos",
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
        titulo: "Casos integradores",
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
        titulo: "Tips y mindset de examen",
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
// Plantilla por defecto. Las secciones tienen marcadores [ENTRE CORCHETES]
// que el cargador detecta como "no completado" y omite la lección hasta
// que tengas todo escrito.
// ─────────────────────────────────────────────────────────────────────
function plantillaPorLeccion({ cursoId, leccionTitulo, leccionOrden, tiempoMin }) {
    return {
        _META_titulo: leccionTitulo,
        _META_curso: cursoId,
        _META_orden: leccionOrden,
        _META_tiempo_min: tiempoMin,
        _META_INSTRUCCIONES: "Reemplazá el texto entre [CORCHETES] con tu contenido real. Borrá secciones que no uses. Agregá las que necesites. Cuando esté listo, cambia 'publicar' a true.",
        publicar: false,
        secciones: [
            {
                tipo: "parrafo",
                texto: "[INTRODUCCIÓN: 2-3 oraciones que enganchen al lector y expliquen por qué esta lección importa para el examen.]"
            },
            {
                tipo: "titulo",
                texto: "[PRIMER SUBTÍTULO: el primer concepto importante]"
            },
            {
                tipo: "parrafo",
                texto: "[DESARROLLO: 2-4 oraciones explicando el primer concepto. Sé conversacional, no académico. Reformulá con tus palabras, no copies del PMBOK.]"
            },
            {
                tipo: "lista",
                items: [
                    "[Primer punto clave]",
                    "[Segundo punto clave]",
                    "[Tercer punto clave]"
                ]
            },
            {
                tipo: "titulo",
                texto: "[SEGUNDO SUBTÍTULO: el segundo concepto o aplicación]"
            },
            {
                tipo: "parrafo",
                texto: "[DESARROLLO: explicación del segundo concepto, 2-4 oraciones.]"
            },
            {
                tipo: "callout",
                variante: "tip_examen",
                texto: "[TIP DE EXAMEN: cómo identificar este tema en el enunciado de una pregunta del examen real. Sé específico.]"
            }
        ]
    };
}

// ─────────────────────────────────────────────────────────────────────
// Generación
// ─────────────────────────────────────────────────────────────────────
function main() {
    if (!fs.existsSync(DESTINO)) {
        fs.mkdirSync(DESTINO, { recursive: true });
        console.log(`[OK] Carpeta creada: ${DESTINO}`);
    } else {
        console.log(`[INFO] Carpeta ya existe: ${DESTINO}`);
    }

    let creados = 0;
    let preservados = 0;
    let totalLecciones = 0;

    for (const curso of CURSOS) {
        for (let i = 0; i < curso.lecciones.length; i++) {
            const orden = i + 1;
            totalLecciones++;
            const leccionId = `${curso.id}_l${String(orden).padStart(2, "0")}`;
            const archivo = path.join(DESTINO, `${leccionId}.json`);

            if (fs.existsSync(archivo)) {
                preservados++;
                continue;
            }

            const data = plantillaPorLeccion({
                cursoId: curso.id,
                leccionTitulo: curso.lecciones[i].titulo,
                leccionOrden: orden,
                tiempoMin: curso.lecciones[i].tiempoMin,
            });

            fs.writeFileSync(archivo, JSON.stringify(data, null, 2) + "\n", "utf8");
            creados++;
        }
    }

    console.log(`[OK] Templates listos:`);
    console.log(`     - ${creados} archivos creados nuevos`);
    console.log(`     - ${preservados} archivos ya existían (preservados)`);
    console.log(`     - ${totalLecciones} lecciones totales en el track`);
    console.log(``);
    console.log(`Próximos pasos:`);
    console.log(`  1. Abrí la carpeta contenido_pmp/ en tu editor.`);
    console.log(`  2. Editá una lección a la vez, reemplazando [CORCHETES] con tu contenido.`);
    console.log(`  3. Cuando termines una, cambiá "publicar": false a "publicar": true.`);
    console.log(`  4. Cuando tengas N lecciones listas, corré: node scripts/cargar_contenido_pmp.js`);
}

main();
