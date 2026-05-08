# Cómo escribir el contenido del curso PMP

Sistema simple para que escribas las 109 lecciones a tu ritmo.

## Flujo en 3 pasos

```
[1] Generar templates    →    [2] Editar archivos JSON    →    [3] Subir a Firestore
   (una vez)                 (vos, a tu ritmo)               (cuando tengas N listos)
```

---

## Paso 1: generar la carpeta de templates (una sola vez)

Desde la raíz del repo:

```bash
node scripts/generar_templates_pmp.js
```

Esto crea la carpeta `contenido_pmp/` con **109 archivos .json**, uno por lección.
Cada archivo arranca como un esqueleto con marcadores `[ENTRE CORCHETES]` que
tenés que reemplazar.

> El script es **idempotente**: si lo corrés de nuevo, NO sobrescribe los archivos
> que ya tocaste. Solo crea los que faltan. Tu trabajo está protegido.

---

## Paso 2: editar las lecciones a tu ritmo

Abrí la carpeta `contenido_pmp/` en VS Code (o cualquier editor que entienda JSON).
Cada archivo se llama así: `01-fundamentos-pmbok_l03.json` → curso 01, lección 03.

### Estructura de un archivo

```json
{
  "_META_titulo": "Definir el alcance y la EDT/WBS",
  "_META_curso": "03-dominio-procesos",
  "_META_orden": 2,
  "_META_tiempo_min": 16,
  "_META_INSTRUCCIONES": "Reemplazá ...",
  "publicar": false,
  "secciones": [
    { "tipo": "parrafo", "texto": "Tu introducción..." },
    { "tipo": "titulo", "texto": "Subtítulo" },
    { "tipo": "parrafo", "texto": "Desarrollo del concepto..." },
    { "tipo": "lista", "items": ["Item 1", "Item 2", "Item 3"] },
    { "tipo": "callout", "variante": "tip_examen", "texto": "Tip..." }
  ]
}
```

Los campos con prefijo `_META_` son referencia para que sepas qué lección estás
editando. **No los toques** — el script los ignora.

El campo `publicar` controla qué pasa al subir:
- `false` (por defecto) → la lección se guarda como **borrador**, NO la ven los alumnos.
- `true` → se guarda como **publicada**, los alumnos la ven inmediatamente.

### Tipos de sección que podés usar

#### `parrafo` — bloque de texto normal

```json
{ "tipo": "parrafo", "texto": "Tu texto acá. Entre 5 y 4000 caracteres." }
```

#### `titulo` — subtítulo dentro de la lección

```json
{ "tipo": "titulo", "texto": "Procesos integradores en detalle" }
```

#### `lista` — entre 2 y 15 items

```json
{
  "tipo": "lista",
  "items": [
    "Primer punto importante.",
    "Segundo punto importante.",
    "Tercer punto importante."
  ]
}
```

#### `callout` — bloque destacado, 3 variantes

```json
{ "tipo": "callout", "variante": "tip_examen", "texto": "Cómo identificar este tema en el examen real." }
{ "tipo": "callout", "variante": "nota", "texto": "Aclaración o detalle importante." }
{ "tipo": "callout", "variante": "ejemplo", "texto": "Imaginá un proyecto donde..." }
```

> **Obligatorio:** cada lección debe tener al menos un callout `tip_examen`. Sin
> él, el cargador rechaza la lección.

#### `tabla` — opcional, para comparaciones

```json
{
  "tipo": "tabla",
  "headers": ["Predictivo", "Ágil"],
  "filas": [
    ["Alcance fijo", "Alcance evolutivo"],
    ["Cambios costosos", "Cambios baratos"]
  ]
}
```

### Reglas a recordar

| Regla | Detalle |
|---|---|
| Mínimo 2 secciones | Y máximo 30 |
| Párrafos / títulos | 5 a 4000 caracteres |
| Listas | 2 a 15 items, cada uno 3 a 800 caracteres |
| Callouts | 10 a 2000 caracteres |
| Tablas | 2 a 6 columnas, 1 a 12 filas |
| Tip de examen | Obligatorio: al menos un callout `tip_examen` |
| Sin placeholders | El cargador omite cualquier lección que aún tenga `[TEXTO ENTRE CORCHETES]` |

### Ejemplo completo (lección lista para subir)

```json
{
  "_META_titulo": "Tipos de procesos integradores",
  "_META_curso": "03-dominio-procesos",
  "_META_orden": 9,
  "_META_tiempo_min": 22,
  "publicar": true,
  "secciones": [
    {
      "tipo": "parrafo",
      "texto": "En esta lección vas a entender por qué los procesos integradores son el corazón del dominio Procesos del PMP, y cuándo elegir uno sobre otro frente a una situación ambigua del examen."
    },
    {
      "tipo": "titulo",
      "texto": "Qué es un proceso integrador"
    },
    {
      "tipo": "parrafo",
      "texto": "Un proceso integrador coordina actividades, recursos y entregables a través de las distintas áreas del proyecto. Su valor está en mantener la coherencia entre lo que pasa en una fase y lo que viene después."
    },
    {
      "tipo": "lista",
      "items": [
        "Desarrollar el acta de constitución del proyecto.",
        "Desarrollar el plan para la dirección del proyecto.",
        "Dirigir y gestionar el trabajo del proyecto.",
        "Realizar el control integrado de cambios.",
        "Cerrar el proyecto o la fase."
      ]
    },
    {
      "tipo": "callout",
      "variante": "tip_examen",
      "texto": "Cuando el enunciado dice 'el proyecto requiere alinear varios entregables del equipo', la respuesta casi siempre apunta a un proceso integrador, no a uno específico de un área."
    }
  ]
}
```

---

## Paso 3: subir el contenido a Firestore

Cuando tengas N lecciones listas (cualquier número), corré:

```bash
node scripts/cargar_contenido_pmp.js
```

El script:
1. Lee todos los archivos `contenido_pmp/*.json`.
2. Omite los que aún tienen placeholders (`[ENTRE CORCHETES]`).
3. Valida formato y reglas.
4. Sube a Firestore con `status: "published"` o `status: "draft"` según el campo `publicar`.
5. Te imprime un resumen al final.

> **Es idempotente**: podés correrlo cuantas veces quieras. Solo actualiza lo que cambió.

### Output típico

```
[INFO] Procesando 109 archivos de contenido...

[OK  ] ✓ PUBLICADA 03-dominio-procesos_l09.json — 720 palabras, 8 secciones
[OK  ] → borrador   03-dominio-procesos_l10.json — 580 palabras, 6 secciones
...

[RESUMEN]
  Publicadas:     2
  En borrador:    3
  Sin cambios:    0
  Omitidas:       104 (placeholders sin reemplazar)
  Errores:        0
```

---

## Tips para escribir rápido sin perder calidad

- **Espejá la estructura de las que diseñamos juntos**: intro corta → 2-3 secciones de desarrollo → tip de examen al cierre.
- **Hablá en segunda persona neutra** ("vas a entender", "tu trabajo es"). Sin "vos" ni "vosotros".
- **No copies del PMBOK literal**. Reformulá con tus palabras — además te ayuda a entender mejor.
- **Cada tip de examen debe ser concreto y accionable**. "Cuando el enunciado dice X, la respuesta apunta a Y."
- **Una lección por sentada**. Son ~600-800 palabras. Te toma 15-25 minutos cada una si dominás el tema.

## Si encontrás problemas

- **El script omite mi lección y dice "placeholders sin reemplazar"** → buscá en tu archivo cualquier texto entre `[CORCHETES MAYÚSCULAS]` y reemplazalo.
- **El script tira "Falta callout tip_examen"** → agregá un `{ "tipo": "callout", "variante": "tip_examen", "texto": "..." }` al final.
- **El script tira "JSON inválido"** → te falta una coma o tenés un quote sin cerrar. Pegá el archivo en [jsonlint.com](https://jsonlint.com) para encontrarlo.
- **El script tira "Lección no existe en Firestore"** → corré primero `node scripts/bootstrap_track_pmp.js` (siembra la estructura).

## Resumen de comandos

```bash
# Una sola vez al inicio
node scripts/bootstrap_track_pmp.js          # siembra estructura del track
node scripts/generar_templates_pmp.js         # crea 109 archivos vacíos

# Cada vez que termines de escribir N lecciones
node scripts/cargar_contenido_pmp.js          # sube tu contenido
```

Listo. Todo el material que escribas queda en Git (la carpeta `contenido_pmp/`),
así tenés versionado y backup automático.
