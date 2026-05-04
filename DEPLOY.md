# Despliegue de los cambios de seguridad — PMP Simulator Pro

Esta guía es lo único que tenés que ejecutar. Asume que ya tenés `firebase-tools`
instalado y estás logueado al proyecto `pmp-simulator-pro-c656a`.

## 0. Preparación local

```bash
# Login (una sola vez)
firebase login

# Verificar que el alias apunte al proyecto correcto
firebase use pmp-simulator-pro
firebase projects:list

# Bajá la service account JSON desde:
#   Firebase Console > Project Settings > Service Accounts > Generate new private key
# Guardalo en la raíz del repo como llave.json.
# (Ya está en .gitignore — no lo commitees.)
```

> El git history se auditó y NO contiene ninguna service account previa filtrada,
> así que NO hace falta rotar credenciales viejas.

## 1. Instalar dependencias nuevas de las Cloud Functions

```bash
cd functions
npm install
cd ..
```

Esto agrega `papaparse` y `xlsx` (parser seguro) que necesita la función
`uploadQuestions`.

## 2. Desplegar reglas de Firestore

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

A partir de este momento:
- Ningún usuario puede modificar el campo `rol` de su propio doc para escalar a profesor.
- El banco `preguntas_pmp` solo se puede leer directo desde Firestore si tenés el custom claim profesor.
- Los alumnos siguen pudiendo bajar las preguntas a través de la callable `getQuestions` (con auth).
- La colección `payments` queda blindada: nada de escritura desde el cliente.

## 3. Desplegar las Cloud Functions

```bash
firebase deploy --only functions
```

Las nuevas funciones expuestas:
- `setProfesorClaim(targetUid, profesor: bool)` — callable, solo profesores
- `getMyRole()` — callable, devuelve si el caller es profesor
- `getQuestions()` — callable autenticada, reemplaza el endpoint HTTP público anterior
- `gradeAttempt({ answers })` — callable autenticada, califica server-side (mejora futura)
- `uploadQuestions({ fileBase64, filename, mode })` — callable, solo profesores
- `createPaypalOrder({ sku })`, `capturePaypalOrder({ orderID })`, `paypalWebhook` — PayPal (necesita secretos antes)

## 4. Bootstrap del primer admin (faldunate@gmail.com)

Antes de correrlo, asegurate de haberte registrado en la web (la cuenta tiene
que existir en Firebase Auth). Después:

```bash
cd scripts
npm install
cd ..
node scripts/bootstrap_admin.js faldunate@gmail.com
```

Salida esperada:
```
[OK] Custom claim profesor=true asignado a faldunate@gmail.com (uid ...).
```

Cerrá sesión en la web y volvé a entrar para que el token nuevo traiga el
claim. Ahí vas a ver el dashboard profesor y el módulo de carga de preguntas.

A partir de ahora, podés promover/despromover otros profesores desde la consola
del navegador (logueado como profesor):

```js
firebase.app().functions("us-central1")
  .httpsCallable("setProfesorClaim")({ targetUid: "uid-del-otro", profesor: true });
```

(Más adelante esto se puede embeber como botón en la UI; por ahora es CLI.)

## 5. Probar la carga masiva

1. Logueate como faldunate@gmail.com.
2. Vas a ver la tarjeta "Banco de preguntas — Carga masiva desde Excel / CSV".
3. Seleccioná `Preparacion_PMP_Preguntas_1.xlsx` que ya tenés en el repo.
4. Modo "Reemplazar todo" si querés rehacer la base; "Agregar" para sumar nuevas.
5. Click en "Cargar a Firestore".
6. Te debería responder algo como `321 preguntas guardadas (replace)`.

Errores frecuentes:
- `Esta acción requiere permisos de profesor.` → Cerraste y volviste a entrar después del bootstrap?
- `Archivo supera el límite de 8388608 bytes.` → El archivo pesa más de 8MB, dividilo.
- Filas descartadas con "respuesta_correcta inválida" → la columna trae un valor distinto a A/B/C/D (ojo con `a` minúscula en algunas filas — la function la normaliza a mayúscula, así que no debería pasar; si pasa avisame).

## 6. PayPal — cuando tengas el sandbox listo

```bash
# Crear cuenta sandbox en developer.paypal.com → Apps & Credentials → REST API apps
# Anotá Client ID, Client Secret. Crear un Webhook en la misma app, anotá Webhook ID.

firebase functions:secrets:set PAYPAL_CLIENT_ID
firebase functions:secrets:set PAYPAL_CLIENT_SECRET
firebase functions:secrets:set PAYPAL_WEBHOOK_ID
firebase functions:secrets:set PAYPAL_ENV   # sandbox o live

# Re-desplegar para que las funciones reciban los secretos
firebase deploy --only functions:createPaypalOrder,functions:capturePaypalOrder,functions:paypalWebhook
```

URL del webhook que tenés que poner en PayPal Developer:
```
https://us-central1-pmp-simulator-pro-c656a.cloudfunctions.net/paypalWebhook
```

Eventos a suscribir:
- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`

Catálogo de productos: editá `functions/paypal.js` -> `PRODUCTOS`.

La UI del botón de pago todavía no está en `index.html` — la integramos cuando
me pases las credenciales de sandbox y definamos el flujo (¿pago único? ¿gating
del simulador hasta pagar? ¿créditos?).

## 7. Hosting (opcional pero recomendado)

`firebase.json` ya queda configurado para servir el sitio desde Firebase Hosting
con headers de seguridad básicos (`X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`).

```bash
firebase deploy --only hosting
```

URL: https://pmp-simulator-pro-c656a.web.app

## 8. Limpieza

Hay archivos antiguos que podés eliminar del repo (`git status` los muestra como
eliminados pendientes):

```bash
git rm "index 2.html" "index-estable.html" "index.090426.html" 2>/dev/null
git add .
git commit -m "Security hardening: Firestore rules, custom claims, XSS fixes, upload module, PayPal scaffold"
```

## TODO de mejora futura (no bloquea el lanzamiento)

- Mover el grading 100% al server con `gradeAttempt` y dejar de mandar
  `respuesta_correcta` al cliente. Hoy un alumno autenticado todavía puede
  llamar a `getQuestions` y bajar todo el banco con respuestas (severidad
  media; antes era pública sin auth, severidad crítica).
- Exigir email verificado antes de permitir invocar `getQuestions` (chequeo en la function).
- Agregar Firebase App Check para bloquear llamadas desde fuera del navegador real.
- UI integrada para gestionar profesores (hoy es por consola JS).
