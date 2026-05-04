/**
 * Bootstrap: asigna el custom claim `profesor: true` al primer admin.
 *
 * Uso:
 *   1. Bajá la service account JSON desde Firebase Console:
 *      Project Settings -> Service Accounts -> Generate new private key
 *      Guardala como `llave.json` en la raíz del repo (ya está en .gitignore).
 *   2. cd a la raíz del repo y corré:
 *        node scripts/bootstrap_admin.js faldunate@gmail.com
 *
 * Después de correrlo, faldunate@gmail.com debe cerrar sesión y volver a entrar
 * para que el token nuevo traiga el claim. A partir de ese momento, el resto de
 * los admins se asignan vía la Cloud Function setProfesorClaim sin necesidad
 * de tocar la service account de nuevo.
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

async function main() {
    const email = process.argv[2];
    if (!email) {
        console.error("Uso: node scripts/bootstrap_admin.js <email>");
        process.exit(1);
    }

    let user;
    try {
        user = await admin.auth().getUserByEmail(email);
    } catch (e) {
        console.error(`[ERR] No existe usuario con email ${email}.`);
        console.error(
            "       Primero registrate en la app web, después corré este script."
        );
        process.exit(2);
    }

    // Bootstrap del primer admin: le damos AMBOS claims.
    // - profesor: true → puede ver dashboard de alumnos, banco de preguntas, etc.
    // - admin:    true → puede gestionar otros usuarios y (en el futuro) pagos.
    const claims = { ...(user.customClaims || {}), profesor: true, admin: true };
    await admin.auth().setCustomUserClaims(user.uid, claims);
    await admin.auth().revokeRefreshTokens(user.uid);

    console.log(`[OK] Custom claims { profesor:true, admin:true } asignados a ${email} (uid ${user.uid}).`);
    console.log(
        "      Cerrá sesión y volvé a entrar en la web para que el token traiga los claims."
    );
}

main().catch((e) => {
    console.error("[ERR]", e);
    process.exit(99);
});
