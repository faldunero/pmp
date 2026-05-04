/**
 * Reset directo de contraseña vía Firebase Admin SDK.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/reset_password.js <email> <nueva_password>
 *
 * Ejemplo:
 *   node scripts/reset_password.js faldunate@gmail.com MiPasswordNueva2026!
 *
 * Útil cuando "Recuperar contraseña" no llega o no funciona.
 * Requiere llave.json en la raíz del repo.
 */
"use strict";

const path = require("path");
const fs = require("fs");

const KEY_PATH = path.resolve(__dirname, "..", "llave.json");
if (!fs.existsSync(KEY_PATH)) {
    console.error("[ERR] No encuentro llave.json en la raíz del repo.");
    process.exit(1);
}

const admin = require("firebase-admin");
admin.initializeApp({
    credential: admin.credential.cert(require(KEY_PATH)),
});

async function main() {
    const email = process.argv[2];
    const newPassword = process.argv[3];
    if (!email || !newPassword) {
        console.error("Uso: node scripts/reset_password.js <email> <nueva_password>");
        process.exit(1);
    }
    if (newPassword.length < 8) {
        console.error("[ERR] La contraseña debe tener al menos 8 caracteres.");
        process.exit(1);
    }

    let user;
    try {
        user = await admin.auth().getUserByEmail(email);
    } catch (e) {
        console.error(`[ERR] No existe usuario con email ${email}.`);
        process.exit(2);
    }

    await admin.auth().updateUser(user.uid, { password: newPassword });
    console.log(`[OK] Contraseña actualizada para ${email}.`);
    console.log(`     Ya podés loguearte en la web con esta nueva contraseña.`);
}

main().catch((e) => {
    console.error("[ERR]", e);
    process.exit(99);
});
