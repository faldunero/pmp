/**
 * Vistas administrativas — agregados de suscripciones y pagos.
 *
 * Solo accesible para admin. Combina datos de:
 *   - usuarios/{uid}             (acceso_validUntil, simulacros_gratis_usados)
 *   - payments/{orderId}         (registro de cada pago PayPal)
 *   - Firebase Auth              (email, displayName, fechas)
 *
 * No paginamos en este primer corte: para volumen pequeño-mediano (≤ 5000
 * usuarios y ≤ 5000 pagos) basta. Si el proyecto crece, hay que paginar
 * la respuesta o moverla a una vista materializada.
 */
"use strict";

const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { assertAdmin } = require("./utils");

const DIA_MS = 24 * 60 * 60 * 1000;

exports.listSubscriptions = onCall(
    { region: "us-central1", maxInstances: 5, timeoutSeconds: 60 },
    async (request) => {
        assertAdmin(request);

        const db = admin.firestore();

        // ─── 1. Cargar todos los usuarios y todos los pagos en paralelo ───
        const [usersSnap, paymentsSnap] = await Promise.all([
            db.collection("usuarios").get(),
            db.collection("payments").orderBy("createdAt", "desc").limit(500).get(),
        ]);

        // ─── 2. Indexar pagos por uid para luego enriquecer la tabla ───
        const pagosPorUid = new Map(); // uid -> [pagos...]
        const todosLosPagos = [];
        paymentsSnap.forEach((doc) => {
            const p = { orderID: doc.id, ...doc.data() };
            // Convertir timestamps de Firestore a ISO para que viajen como JSON
            if (p.createdAt?.toDate) p.createdAt = p.createdAt.toDate().toISOString();
            if (p.appliedAt?.toDate) p.appliedAt = p.appliedAt.toDate().toISOString();
            todosLosPagos.push(p);
            if (!p.uid) return;
            if (!pagosPorUid.has(p.uid)) pagosPorUid.set(p.uid, []);
            pagosPorUid.get(p.uid).push(p);
        });

        // ─── 3. Cargar emails desde Firebase Auth (una sola listUsers) ───
        // Note: si > 1000 usuarios habría que paginar listUsers.
        const authResult = await admin.auth().listUsers(1000);
        const authByUid = new Map();
        authResult.users.forEach((u) => {
            authByUid.set(u.uid, {
                email: u.email || "",
                emailVerified: u.emailVerified,
                disabled: u.disabled,
                lastSignInTime: u.metadata.lastSignInTime,
                creationTime: u.metadata.creationTime,
                customClaims: u.customClaims || {},
            });
        });

        // ─── 4. Construir tabla de suscripciones ───
        const now = Date.now();
        const suscripciones = [];
        usersSnap.forEach((doc) => {
            const data = doc.data() || {};
            const authData = authByUid.get(doc.id) || {};
            // Skip profesores/admins en la tabla — no pagan.
            if (authData.customClaims?.profesor === true || authData.customClaims?.admin === true) return;

            const validUntilStr = data.acceso_validUntil || null;
            const validUntil = validUntilStr ? new Date(validUntilStr) : null;
            const diasRestantes = validUntil
                ? Math.max(0, Math.ceil((validUntil.getTime() - now) / DIA_MS))
                : 0;

            const pagosUsuario = pagosPorUid.get(doc.id) || [];
            const pagosCapturados = pagosUsuario.filter((p) => p.status === "captured");
            const ultimoPago = pagosCapturados[0] || null;
            const totalPagadoUSD = pagosCapturados
                .filter((p) => (p.currency || "USD") === "USD")
                .reduce((acc, p) => acc + Number(p.amount || 0), 0);

            let status;
            if (validUntil && validUntil > new Date()) status = "activo";
            else if (validUntil) status = "vencido";
            else if (pagosCapturados.length > 0) status = "vencido";
            else status = "free_trial";

            suscripciones.push({
                uid: doc.id,
                email: authData.email || data.email || "",
                nombre: `${data.nombre || ""} ${data.apellido || ""}`.trim() || authData.email || "(sin nombre)",
                pais: data.pais || "",
                status,
                validUntil: validUntilStr,
                diasRestantes,
                ultimoPagoSku: ultimoPago?.sku || null,
                ultimoPagoFecha: ultimoPago?.appliedAt || ultimoPago?.createdAt || null,
                totalPagadoUSD: Math.round(totalPagadoUSD * 100) / 100,
                pagosCount: pagosCapturados.length,
                simulacrosGratisUsados: Number(data.simulacros_gratis_usados || 0),
                ultimoLogin: authData.lastSignInTime || null,
                creadoEn: data.creadoEn || authData.creationTime || null,
                emailVerified: authData.emailVerified === true,
                disabled: authData.disabled === true,
            });
        });

        // Ordenar por estado y luego por fecha de vencimiento
        suscripciones.sort((a, b) => {
            const orden = { activo: 0, vencido: 1, free_trial: 2 };
            const oa = orden[a.status] ?? 9;
            const ob = orden[b.status] ?? 9;
            if (oa !== ob) return oa - ob;
            return (b.validUntil || "").localeCompare(a.validUntil || "");
        });

        // ─── 5. Calcular KPIs ───
        const ahora30 = now - 30 * DIA_MS;
        const en7dias = now + 7 * DIA_MS;
        const en30dias = now + 30 * DIA_MS;

        const activos = suscripciones.filter((s) => s.status === "activo");
        const vencenEn7 = activos.filter(
            (s) => s.validUntil && new Date(s.validUntil).getTime() <= en7dias
        );
        const vencenEn30 = activos.filter(
            (s) => s.validUntil && new Date(s.validUntil).getTime() <= en30dias
        );

        const pagosCapturadosTodos = todosLosPagos.filter((p) => p.status === "captured");
        const revenueTotalUSD = pagosCapturadosTodos
            .filter((p) => (p.currency || "USD") === "USD")
            .reduce((acc, p) => acc + Number(p.amount || 0), 0);

        const revenue30dUSD = pagosCapturadosTodos
            .filter((p) => {
                if ((p.currency || "USD") !== "USD") return false;
                const ts = p.appliedAt || p.createdAt;
                return ts && new Date(ts).getTime() >= ahora30;
            })
            .reduce((acc, p) => acc + Number(p.amount || 0), 0);

        // Distribución por plan (solo capturados)
        const planCounts = {};
        pagosCapturadosTodos.forEach((p) => {
            const k = p.sku || "desconocido";
            planCounts[k] = (planCounts[k] || 0) + 1;
        });

        const resumen = {
            suscriptoresActivos: activos.length,
            suscriptoresVencidos: suscripciones.filter((s) => s.status === "vencido").length,
            usuariosFreeTrial: suscripciones.filter((s) => s.status === "free_trial").length,
            vencenEn7Dias: vencenEn7.length,
            vencenEn30Dias: vencenEn30.length,
            pagosCapturados: pagosCapturadosTodos.length,
            pagosPendientes: todosLosPagos.filter((p) => p.status === "pending").length,
            revenueTotalUSD: Math.round(revenueTotalUSD * 100) / 100,
            revenue30dUSD: Math.round(revenue30dUSD * 100) / 100,
            planCounts,
        };

        // ─── 6. Enriquecer pagos con email para la tabla ───
        const pagosConEmail = todosLosPagos.map((p) => ({
            ...p,
            email: authByUid.get(p.uid)?.email || "",
        }));

        return {
            resumen,
            suscripciones,
            pagos: pagosConEmail,
            generadoEn: new Date().toISOString(),
        };
    }
);
