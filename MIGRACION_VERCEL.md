# Migración de Hosting a Vercel

Estado: archivos de configuración preparados (`vercel.json`, `.vercelignore`).
Pasos manuales pendientes — **te toca a vos**, yo no puedo:
- Acceder a tu cuenta de GitHub / Vercel.
- Hacer push a tu repositorio.
- Modificar las Authorized Domains de tu proyecto Firebase.

---

## Arquitectura post-migración

```
Browser
   │
   ├── HTML / CSS / JS  ←── Vercel (CDN global)
   │
   └── Cloud Functions  ←── Firebase (us-central1)
       Firestore, Auth, App Check
```

Frontend en Vercel, todo lo demás sigue en Firebase. El cliente llama a las
Cloud Functions vía SDK exactamente igual que antes — no cambia ni una línea
de código JS.

---

## Pasos en orden

### 1. Subir el código a un repositorio Git

Si todavía no tenés repo:

```bash
cd /Users/felipealdunate/Desktop/Desarrollo/pmp-simulator
git init
git add .
git commit -m "Initial commit"
```

Después creá un repo en GitHub (o GitLab) y conectalo:

```bash
git remote add origin git@github.com:TU_USUARIO/pmp-simulator.git
git branch -M main
git push -u origin main
```

> **Crítico antes de pushear:** verificá que `llave.json` (la service account
> de Firebase) está en `.gitignore`. Si quedó commiteada, hay que rotar la key
> en Firebase Console → Project Settings → Service Accounts.

### 2. Importar el repo a Vercel

1. Andá a [vercel.com](https://vercel.com), creá cuenta si no tenés (sign in con GitHub es lo más rápido).
2. *Add New → Project → Import Git Repository*.
3. Elegí el repo `pmp-simulator`.
4. **Framework Preset**: *Other* (es estático puro).
5. **Root Directory**: dejar `./` (la raíz).
6. **Build Command**: dejar vacío.
7. **Output Directory**: dejar vacío (se sirve la raíz).
8. **Install Command**: dejar vacío.
9. *Deploy*.

Vercel detecta el `vercel.json` y aplica los headers de seguridad
automáticamente. En 30 segundos tenés una URL tipo
`pmp-simulator-xyz.vercel.app`.

### 3. Agregar el dominio Vercel a Firebase Authorized Domains

**Sin este paso, el login con Google va a fallar con `auth/unauthorized-domain`.**

Firebase Console → Authentication → Settings → **Authorized domains** → Add domain:

- `tu-app.vercel.app` (la URL exacta que te dio Vercel)
- Si conectás un dominio custom después (ej: `pmpsimulator.com`), también
  agregalo acá.

### 4. (Opcional) Conectar dominio custom

En Vercel → tu proyecto → Settings → Domains → Add → seguir las instrucciones
DNS. Vercel emite el certificado SSL automáticamente. Después agregalo
también a Firebase Authorized Domains.

### 5. Probar el deploy

Abrí `https://tu-app.vercel.app` y verificá:

- [ ] El login con email/password funciona.
- [ ] El login con Google funciona (popup).
- [ ] Un alumno puede empezar y finalizar un simulacro.
- [ ] El admin ve el panel de suscripciones.
- [ ] No hay errores de CSP en la consola del navegador.
- [ ] En DevTools → Network → headers de la respuesta tienen
      `Content-Security-Policy`, `Strict-Transport-Security`, etc.

---

## Lo que sigue corriendo en Firebase

Estos comandos siguen funcionando igual que antes (los corrés vos cuando
necesites cambiar lógica de backend):

```bash
# Cloud Functions
firebase deploy --only functions

# Reglas de Firestore
firebase deploy --only firestore:rules

# Hosting (si querés mantener Firebase Hosting como backup, opcional)
firebase deploy --only hosting
```

Si NO querés mantener Firebase Hosting más, podés:
- Dejar el archivo `firebase.json` como está pero no correr más `--only hosting`.
- O sacar la sección `"hosting"` de `firebase.json`.
- (No tocar nada de `functions`, `firestore`, etc. — siguen vivos.)

---

## Lo que NO cambió

- API key de Firebase en `index.html` (se queda — no es secret).
- PayPal secrets en Firebase Secret Manager.
- Firestore rules.
- Cloud Functions (incluyendo URLs como
  `https://us-central1-pmp-simulator-pro-c656a.cloudfunctions.net/...`).
- App Check (si lo activás, está atado al projectId, no al hosting).

---

## Si algún día querés migrar Functions también a Vercel

Es factible pero NO recomendado en este proyecto:

- Cada función callable de Firebase tendría que reescribirse como Vercel
  serverless function (`api/getQuestions.js`, etc.).
- La autenticación cambiaría (de Firebase callable + auto-token a verificar
  un ID token a mano usando `firebase-admin` desde Vercel).
- Las transactions de Firestore con `runTransaction` siguen funcionando
  igual usando `firebase-admin` desde Vercel.
- Los secrets pasan de Firebase Secret Manager a Vercel Environment Variables.
- El webhook de PayPal pasaría a un endpoint Vercel.

Esfuerzo estimado: 1-2 semanas de trabajo + testing exhaustivo del flujo
de pago. No vale la pena salvo que estés saliendo de Firebase entero.

---

## Rollback

Si algo sale mal, volvés a Firebase Hosting con un solo comando:

```bash
firebase deploy --only hosting
```

Tu `firebase.json` sigue intacto, sigue siendo un deploy válido.
