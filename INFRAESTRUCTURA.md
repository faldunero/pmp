# PMP Simulator Pro — Infraestructura y Operaciones

Documento de referencia técnica del proyecto. Cubre lo que ya está configurado,
cómo operar el día a día, advertencias importantes y lo que quedó pendiente.

Última actualización: abril 2026 (al cierre del Sprint 3).

---

## 1. Resumen ejecutivo

El proyecto vive en Firebase (Hosting + Firestore + Cloud Functions + Auth)
en el proyecto `pmp-simulator-pro-c656a`. Tiene autenticación con tres roles
(alumno / profesor / admin), banco de preguntas cargable desde Excel, paywall
freemium con cobro vía PayPal sandbox, y reglas de seguridad endurecidas.

URL pública: https://pmp-simulator-pro-c656a.web.app

Usuario administrador: `faldunate@gmail.com`

---

## 2. Stack y arquitectura

### Frontend

Un solo `index.html` (~1900 líneas) servido desde Firebase Hosting. Usa
Firebase Web SDK v9 (modo compat) para Auth, Firestore y Functions. El SDK de
PayPal Smart Buttons se carga dinámicamente con el Client ID que sirve la
Cloud Function `getPaypalClientId`.

### Backend (Cloud Functions, Node 22, región `us-central1`)

| Function | Tipo | Quién puede llamar | Para qué sirve |
|---|---|---|---|
| `getMyRole` | onCall | Cualquier autenticado | Devuelve los flags `profesor` y `admin` del caller. |
| `getMyAccess` | onCall | Cualquier autenticado | Devuelve estado de acceso (validUntil, free trial). |
| `getQuestions` | onCall | Cualquier autenticado (con gating) | Devuelve el banco de preguntas, validando acceso del alumno. |
| `gradeAttempt` | onCall | Cualquier autenticado | Califica un intento server-side (no usado todavía por el frontend). |
| `uploadQuestions` | onCall | Solo profesor/admin | Carga masiva de XLSX o CSV. |
| `setProfesorClaim` | onCall | Solo admin | Promueve / despromueve a profesor. |
| `setAdminClaim` | onCall | Solo admin | Promueve / despromueve a admin (con anti auto-revoke). |
| `listUsersWithRoles` | onCall | Solo admin | Lista todos los usuarios con sus roles para la UI admin. |
| `listPlans` | onCall | Cualquier autenticado | Catálogo de planes de pago. |
| `getPaypalClientId` | onCall | Cualquier autenticado | Devuelve el Client ID público del SDK PayPal. |
| `createPaypalOrder` | onCall | Cualquier autenticado | Crea una orden en PayPal y registra `payments/{orderId}`. |
| `capturePaypalOrder` | onCall | Solo el dueño de la orden | Confirma cobro y extiende `acceso_validUntil`. |
| `paypalWebhook` | onRequest (público) | PayPal (firma verificada) | Backup asíncrono que confirma idempotente. |

### Base de datos (Firestore)

| Colección | Quién lee | Quién escribe | Notas |
|---|---|---|---|
| `usuarios/{uid}` | Dueño y profesor | Dueño (con campos privilegiados blindados) | `acceso_validUntil` y `simulacros_gratis_usados` solo escribibles por Cloud Function. |
| `usuarios/{uid}/historial/{sesion}` | Dueño y profesor | Dueño (create) | Sin update, solo profesor borra. |
| `usuarios/{uid}/historial_canceladas/{sesion}` | Dueño y profesor | Dueño (create) | Tests abandonados. |
| `preguntas_pmp/{id}` | Solo profesor (directo) o cualquier autenticado vía Cloud Function | Solo profesor | Lectura directa bloqueada para alumnos: usan `getQuestions`. |
| `payments/{orderId}` | Dueño (resource.data.uid) y profesor | **Solo Cloud Function** | Cliente nunca escribe. |
| `payment_events/{eventId}` | Solo profesor | **Solo Cloud Function** | Auditoría de webhooks PayPal. |

### Seguridad

- Reglas de Firestore en `firestore.rules` (deployadas, default-deny al final).
- Roles vía custom claims de Firebase Auth (`profesor`, `admin`). No se confía
  en ningún campo `rol` del documento del usuario.
- Sanitización HTML (`escHtml`) en todas las interpolaciones del dashboard
  profesor y del reporte del simulador.
- Validación + neutralización de CSV-injection en la carga masiva.
- Webhook de PayPal verifica firma antes de aceptar.
- Secretos de PayPal en Firebase Secret Manager.

---

## 3. Roles y permisos

| Acción | Alumno | Profesor | Admin |
|---|---|---|---|
| Hacer simulacros | Sí (con gating) | No (solo supervisa) | Sí |
| Editar perfil propio | Sí | Sí | Sí |
| Ver historial propio | Sí | Sí | Sí |
| Ver lista de alumnos | — | Sí | Sí |
| Ver detalle de un alumno | — | Sí | Sí |
| Subir XLSX/CSV de preguntas | — | Sí | Sí |
| Promover / despromover profesor | — | — | Sí |
| Promover / despromover admin | — | — | Sí |
| Comprar planes con PayPal | Sí | — (no necesita) | — (no necesita) |

**Cómo se asigna cada rol:**

- Alumno: por defecto al registrarse en la web.
- Profesor: lo crea un admin desde el botón "Gestionar usuarios".
- Admin: lo crea otro admin desde la misma pantalla. Hoy hay uno solo
  (`faldunate@gmail.com`), creado vía `scripts/bootstrap_admin.js`.

---

## 4. Pasos de configuración (cronológico)

Esto es lo que se ejecutó al levantar la infraestructura. Útil como referencia
si hay que rehacerlo en otro proyecto Firebase o reproducirlo.

### 4.1. Service account local

1. Bajar la service account desde
   https://console.firebase.google.com/project/pmp-simulator-pro-c656a/settings/serviceaccounts/adminsdk
2. Generate new private key → guardar como `llave.json` en la raíz del repo.
3. Confirmar que `.gitignore` incluye `llave.json` (ya lo incluye).

### 4.2. Apuntar Firebase CLI al proyecto correcto

```bash
firebase use pmp-simulator-pro-c656a
```

`.firebaserc` debe contener:

```json
{ "projects": { "default": "pmp-simulator-pro-c656a" } }
```

### 4.3. Instalar dependencias

```bash
cd functions && npm install && cd ..
cd scripts  && npm install && cd ..
```

Dependencias clave de functions: `firebase-admin`, `firebase-functions`,
`papaparse`, `xlsx` (sheet.js).

### 4.4. Habilitar APIs en GCP

Desde la consola web (o las habilita el CLI al deployar):

- Cloud Functions API
- Cloud Build API
- Artifact Registry API
- Secret Manager API (https://console.cloud.google.com/apis/library/secretmanager.googleapis.com?project=pmp-simulator-pro-c656a)

### 4.5. Permisos de la cuenta de compute para Cloud Build

GCP cambió en 2024: la cuenta `<projectNumber>-compute@developer.gserviceaccount.com`
ya no trae permisos por defecto.

En https://console.cloud.google.com/iam-admin/iam?project=pmp-simulator-pro-c656a
→ Otorgar acceso → principal `509518346611-compute@developer.gserviceaccount.com`
→ rol **Cuenta de servicio de Cloud Build**. (Este número de proyecto es el de
`pmp-simulator-pro-c656a`.)

### 4.6. Deploy inicial

```bash
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```

### 4.7. Bootstrap del primer admin

```bash
node scripts/bootstrap_admin.js faldunate@gmail.com
```

Asigna `profesor: true` y `admin: true` en el token. La cuenta debe estar
registrada antes en la web (ya sea con email/password o con "Continuar con
Google"). Después del script, **cerrá sesión y volvé a entrar** para que el
token traiga los claims.

### 4.8. Carga del banco inicial de preguntas

Logueado como admin:

1. Dashboard Profesor → tarjeta "Banco de preguntas".
2. Seleccionar `Preparacion_PMP_Preguntas_1.xlsx`.
3. Modo "Reemplazar todo".
4. "Cargar a Firestore". Resultado esperado: `321 preguntas guardadas`.

### 4.9. Configurar PayPal sandbox

a. App en https://developer.paypal.com/dashboard/applications/sandbox →
   Default Application. De ahí: Client ID + Secret.

b. Webhook en la misma app:
   - URL: `https://us-central1-pmp-simulator-pro-c656a.cloudfunctions.net/paypalWebhook`
   - Eventos: `Checkout order approved` y `Payment capture completed`.
   - PayPal genera un Webhook ID al guardarlo.

c. Cargar los 4 secretos en Firebase. **Importante:** usar `printf` y
   `--data-file -` para evitar newlines invisibles del clipboard:

```bash
printf '%s' 'CLIENT_ID' | firebase functions:secrets:set PAYPAL_CLIENT_ID --data-file -
printf '%s' 'SECRET'    | firebase functions:secrets:set PAYPAL_CLIENT_SECRET --data-file -
printf '%s' 'WEBHOOK_ID' | firebase functions:secrets:set PAYPAL_WEBHOOK_ID --data-file -
printf '%s' 'sandbox'   | firebase functions:secrets:set PAYPAL_ENV --data-file -
```

d. Re-desplegar las funciones que usan los secretos:

```bash
firebase deploy --only functions:getPaypalClientId,functions:createPaypalOrder,functions:capturePaypalOrder,functions:paypalWebhook
```

---

## 5. Operaciones cotidianas

### 5.1. Promover un profesor

1. Logueado como admin → Dashboard Profesor → "Gestionar usuarios".
2. Buscar al usuario por email.
3. Click "Hacer profesor" → confirmar.
4. El usuario debe cerrar sesión y volver a entrar.

### 5.2. Promover otro admin

Mismo flujo, pero el botón es "Hacer admin". Solo se ofrece sobre usuarios que
ya son profesor (admin implica profesor).

### 5.3. Cargar nuevas preguntas

- **Modo append**: agrega/sobreescribe por ID. Si subís un archivo con IDs nuevos,
  se agregan; si tienen IDs existentes, se actualizan.
- **Modo replace**: borra TODA la colección antes de cargar. Útil para limpiar
  preguntas huérfanas de cargas previas.

### 5.4. Editar precios o agregar planes nuevos

Editar `functions/paypal.js`, objeto `PRODUCTOS`. Después:

```bash
firebase deploy --only functions:listPlans,functions:createPaypalOrder
```

La pantalla de planes los toma automáticamente sin tocar HTML.

### 5.5. Pasar PayPal de sandbox a Live

1. Cuenta Business real en PayPal (no sandbox).
2. Crear app en https://developer.paypal.com/dashboard/applications/live →
   nuevo Client ID y Secret distintos.
3. Configurar webhook en LIVE con la misma URL y eventos.
4. Actualizar los 4 secretos (incluyendo `PAYPAL_ENV` a `live`).
5. Re-deploy de las funciones de PayPal.

A partir de ahí los pagos son reales. PayPal cobra fees ~2.9% + USD 0.30 por
transacción.

### 5.6. Resetear contraseña de un usuario sin email

```bash
node scripts/reset_password.js faldunate@gmail.com NuevaPassword123!
```

Útil cuando el correo de "Recuperar contraseña" no llega.

### 5.7. Ver logs de Cloud Functions

```bash
firebase functions:log
```

O en la consola: https://console.firebase.google.com/project/pmp-simulator-pro-c656a/functions/logs

### 5.8. Ver datos en Firestore

https://console.firebase.google.com/project/pmp-simulator-pro-c656a/firestore

Colecciones útiles para auditar:
- `usuarios` → ver quién está registrado y su `acceso_validUntil`.
- `payments` → ver pagos con su `status` (`pending`, `captured`, `verified`).
- `payment_events` → log de webhooks recibidos.

---

## 6. Warnings y consideraciones

### 6.1. Bypass de scraping de respuestas (severidad: media)

Cualquier alumno autenticado puede invocar `getQuestions` y recibir el banco
completo, incluido el campo `respuesta_correcta`. Está documentado como TODO.
La regla de Firestore bloquea la lectura directa de `preguntas_pmp` (solo
profesor), pero la callable sí devuelve todo porque el reporte de fin de
simulacro lo necesita para el feedback al alumno.

**Mitigación futura**: implementar `gradeAttempt` server-side y dejar de mandar
`respuesta_correcta` al cliente. La función ya está esquemáticamente lista en
`functions/questions.js`, falta integrarla al flujo de `finalizado()` en el
HTML. Reduce la severidad de media a baja.

### 6.2. Free trial consume al iniciar, no al finalizar

Un alumno puede iniciar la "Práctica 20" gratis y abandonar sin terminarla.
Igual cuenta como consumido (`simulacros_gratis_usados = 1`). No puede empezar
otra. Es por diseño para evitar abuso. Si querés cambiarlo a "consumir al
finalizar", hay que mover el incremento desde `checkAndConsumeAccess` hacia
una llamada explícita después de `finalizado()`.

### 6.3. Idempotencia de los pagos

`capturePaypalOrder` y `paypalWebhook` usan transacción + flag `appliedAt` en
el doc del payment para no duplicar días si ambos llegan. Si por alguna razón
el cliente intenta capturar dos veces, la segunda devuelve `alreadyApplied:
true` sin sumar.

### 6.4. Profesor no puede simular

El guard `if (isProfesor && !isAdmin)` en `empezar()` bloquea simulacros para
profesores puros. Admin sí puede para poder probar la experiencia. Si querés
que un profesor pruebe el simulador, dale claim admin temporalmente.

### 6.5. Aut-revoke de admin bloqueado

`setAdminClaim` rechaza si el caller intenta auto-revocarse. Esto evita que el
sistema se quede sin admins. Para cambiar el "último admin", hay que crear
otro primero o usar `scripts/bootstrap_admin.js`.

### 6.6. Cross-Origin-Opener-Policy warnings

En la consola del navegador aparecen warnings tipo
`Cross-Origin-Opener-Policy policy would block the window.closed call` cuando
se usa Google sign-in o el popup de PayPal. Es ruido informativo, no afecta
funcionalidad. PayPal y Firebase ya tienen fallbacks con `postMessage`.

### 6.7. Secretos con whitespace invisible

Cuando pegás un secret en `firebase functions:secrets:set` desde el clipboard,
puede colarse un newline o espacio. Las funciones tienen `.trim()` defensivo,
pero la mejor práctica al setear es usar:

```bash
printf '%s' 'VALOR' | firebase functions:secrets:set NOMBRE --data-file -
```

### 6.8. Costo de imágenes Cloud Build

Cada deploy de functions construye una imagen en Artifact Registry. Configuré
una cleanup policy de 30 días, así no se acumulan eternamente. Si después de
muchos deploys ves cargo elevado en GCP Billing, revisá Artifact Registry y
ajustá la política.

### 6.9. Email de recuperación de contraseña a veces no llega

Firebase manda los emails desde
`noreply@pmp-simulator-pro-c656a.firebaseapp.com`. Gmail los puede mandar a
spam o promociones. Si un usuario no lo recibe, recordale revisar carpetas o
usá `scripts/reset_password.js` directo.

### 6.10. Repositorio Git todavía no commiteado

Hay archivos eliminados pendientes (`index 2.html`, `index-estable.html`,
`index.090426.html`, `cargar.py.old`) y los nuevos (`firestore.rules`,
`functions/`, `scripts/`, `INFRAESTRUCTURA.md`, etc.) sin commit. Conviene:

```bash
git rm "index 2.html" "index-estable.html" "index.090426.html" cargar.py.old 2>/dev/null
git add .
git commit -m "Sprint 1+2+3: roles, carga XLSX, PayPal sandbox"
git push origin main
```

---

## 7. Pendientes (TODO)

Por orden de impacto:

1. **PayPal Live**: pasar de sandbox a producción cuando esté validada la
   experiencia (sección 5.5).

2. **Editor individual de preguntas**: pantalla en el dashboard profesor para
   listar / buscar / editar / borrar preguntas sin volver a subir XLSX. Era
   parte del Sprint 4 acordado pero no se implementó.

3. **Mover grading a server (`gradeAttempt`)**: cierra el bypass del banco con
   respuestas. Función ya escrita, falta cablearla al flujo de `finalizado()`
   en `index.html`.

4. **Email verificado obligatorio para `getQuestions`**: hoy se permite simular
   apenas el usuario está autenticado. Agregar `if (!request.auth.token.email_verified)
   throw HttpsError` cierra spam.

5. **Panel admin de pagos**: pantalla para ver lista global de transacciones,
   marcar refunds, métricas (MRR, conversión free→paid). Era parte del Sprint
   5 acordado.

6. **Firebase App Check**: bloquea llamadas a Cloud Functions desde fuera del
   navegador real (curl, scripts, etc.). Requiere SDK de App Check en el
   frontend y validación en cada `onCall`.

7. **Tests automatizados**: hoy no hay. Mínimo: tests de las reglas de
   Firestore con `@firebase/rules-unit-testing`.

8. **Documentación de usuario final**: un FAQ o ayuda dentro de la app para
   alumnos (cómo comprar, qué pasa si se cae internet en medio del simulacro,
   etc.).

---

## 8. Troubleshooting común

### "Missing or insufficient permissions" en el dashboard

Significa que el token del usuario no tiene los claims que las reglas
esperan. Verificar:

1. ¿Corriste el bootstrap? `node scripts/bootstrap_admin.js <email>`.
2. ¿Cerraste sesión y volviste a entrar después? Los claims solo entran en
   tokens nuevos.
3. En DevTools del navegador:

   ```js
   firebase.auth().currentUser.getIdTokenResult(true).then(t => console.log(t.claims));
   ```

### Build failed por permisos en Cloud Build

Asignar el rol "Cuenta de servicio de Cloud Build" a la cuenta
`<projectNumber>-compute@developer.gserviceaccount.com` (sección 4.5).

### Deploy falla con "Secret Manager API has not been used"

Habilitar la API:
https://console.cloud.google.com/apis/library/secretmanager.googleapis.com?project=pmp-simulator-pro-c656a

### SDK de PayPal devuelve 400

99% de las veces es un secret guardado con whitespace invisible. Regrabar con
`printf` (sección 6.7) y re-deployar las funciones de PayPal.

### Index error al deployar

Si `firestore.indexes.json` declara un índice de un solo campo, Firestore lo
rechaza (los crea automáticamente). Solo declarar índices compuestos (2+ campos).

### Aterriza en home de alumno cuando debería ser dashboard

El token no trae el claim. Re-correr bootstrap_admin y hacer
signOut + signIn en la web.

---

## 9. Archivos clave del repositorio

```
pmp-simulator/
├── .firebaserc                      Apunta a pmp-simulator-pro-c656a
├── firebase.json                    Hosting + headers + rules + functions
├── firestore.rules                  Reglas de seguridad (default-deny)
├── firestore.indexes.json           Índices compuestos (payments)
├── index.html                       SPA completa (HTML + CSS + JS inline)
├── llave.json                       Service account local (NO commitear)
├── INFRAESTRUCTURA.md               Este documento
├── DEPLOY.md                        Guía de deploy original (Sprint 1)
├── functions/
│   ├── package.json                 Deps: firebase-admin, papaparse, xlsx
│   ├── index.js                     Punto de entrada que reexporta
│   ├── auth.js                      setProfesor/AdminClaim, listUsers, getMyRole
│   ├── access.js                    getMyAccess, checkAndConsumeAccess
│   ├── questions.js                 getQuestions, gradeAttempt, uploadQuestions
│   ├── paypal.js                    Catálogo + 5 funciones de pago
│   └── utils.js                     Helpers: assertAuth/Profesor/Admin, escape
├── scripts/
│   ├── package.json                 Solo firebase-admin
│   ├── bootstrap_admin.js           Asigna claims al primer admin
│   └── reset_password.js            Reset directo de password
├── Preparacion_PMP_Preguntas_1.xlsx Banco de preguntas (input para upload)
├── cargar.py                        Cargador legacy en Python (no usar)
└── borrar_bd.py                     Borrar BD legacy (no usar)
```

Los `*.py` y `*.csv` están solo por compatibilidad con el flujo viejo. La
operación nueva pasa por la UI admin.

---

## 10. Contacto y referencias

- Proyecto Firebase: `pmp-simulator-pro-c656a`
- Repo Git: https://github.com/faldunero/pmp
- Admin: faldunate@gmail.com
- PayPal sandbox app: developer.paypal.com → Default Application

Para cualquier cambio mayor, consultar primero este documento y la
sección "Pendientes" para no duplicar esfuerzo.
