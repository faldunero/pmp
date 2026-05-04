/**
 * Integración PayPal — versión productiva.
 *
 * Flujo:
 *   1. cliente -> createPaypalOrder({sku}). Server crea la orden en PayPal y
 *      registra payments/{orderId} con status=pending. Devuelve orderID.
 *   2. cliente abre el Smart Button con ese orderID, el comprador paga.
 *   3. cliente -> capturePaypalOrder({orderID}). Server captura el cobro y
 *      extiende usuarios/{uid}.acceso_validUntil. Devuelve el nuevo validUntil.
 *   4. PayPal -> paypalWebhook (HTTPS público). Verifica firma, registra
 *      el evento, y aplica el efecto idempotentemente (no duplica acceso).
 *
 * Secretos requeridos (Firebase Secret Manager):
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENV
 */
"use strict";

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { assertAuth } = require("./utils");

const PAYPAL_CLIENT_ID = defineSecret("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = defineSecret("PAYPAL_CLIENT_SECRET");
const PAYPAL_WEBHOOK_ID = defineSecret("PAYPAL_WEBHOOK_ID");
const PAYPAL_ENV = defineSecret("PAYPAL_ENV");

// ----------------------------------------------------------------------------
// Catálogo de productos. SKU → metadata.
// El campo `dias` define cuánto tiempo de acceso suma cada compra.
// Para cambiar precios o agregar planes, editar acá y redeployar.
// ----------------------------------------------------------------------------
const PRODUCTOS = {
    pmp_30: {
        label: "1 mes",
        descripcion: "Acceso completo por 30 días",
        price: 15.0,
        currency: "USD",
        dias: 30,
    },
    pmp_90: {
        label: "3 meses",
        descripcion: "Acceso completo por 90 días",
        price: 35.0,
        currency: "USD",
        dias: 90,
    },
    pmp_180: {
        label: "6 meses",
        descripcion: "Acceso completo por 180 días",
        price: 60.0,
        currency: "USD",
        dias: 180,
    },
    pmp_365: {
        label: "1 año",
        descripcion: "Acceso completo por 365 días",
        price: 99.0,
        currency: "USD",
        dias: 365,
    },
};

function paypalApiBase(env) {
    return env === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";
}

async function getAccessToken(clientId, clientSecret, env) {
    // Trim defensivo por si los secretos quedaron con whitespace al pegar.
    clientId = (clientId || "").trim();
    clientSecret = (clientSecret || "").trim();
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`PayPal token error ${res.status}: ${txt}`);
    }
    return (await res.json()).access_token;
}

// ----------------------------------------------------------------------------
// listPlans — devuelve el catálogo al cliente.
// ----------------------------------------------------------------------------
exports.listPlans = onCall(
    { region: "us-central1", maxInstances: 10 },
    async (request) => {
        assertAuth(request);
        const plans = Object.entries(PRODUCTOS).map(([sku, p]) => ({
            sku,
            label: p.label,
            descripcion: p.descripcion,
            price: p.price,
            currency: p.currency,
            dias: p.dias,
        }));
        return { plans };
    }
);

// ----------------------------------------------------------------------------
// getPaypalClientId — el client id se necesita en el frontend para cargar
// el SDK de PayPal. Como es identificador público (no secreto), lo exponemos
// vía callable autenticada para no hardcodearlo en el HTML.
// ----------------------------------------------------------------------------
exports.getPaypalClientId = onCall(
    {
        region: "us-central1",
        secrets: [PAYPAL_CLIENT_ID, PAYPAL_ENV],
        maxInstances: 10,
    },
    async (request) => {
        assertAuth(request);
        // .trim() defensivo: si al setear el secret quedó con un \n del clipboard,
        // lo limpiamos acá para que no termine en la URL del SDK y rompa todo.
        return {
            clientId: (PAYPAL_CLIENT_ID.value() || "").trim(),
            env: (PAYPAL_ENV.value() || "sandbox").trim(),
        };
    }
);

// ----------------------------------------------------------------------------
// createPaypalOrder
// ----------------------------------------------------------------------------
exports.createPaypalOrder = onCall(
    {
        region: "us-central1",
        secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV],
        maxInstances: 10,
    },
    async (request) => {
        assertAuth(request);

        const { sku } = request.data || {};
        const product = PRODUCTOS[sku];
        if (!product) {
            throw new HttpsError("invalid-argument", "SKU desconocido.");
        }

        const env = (PAYPAL_ENV.value() || "sandbox").trim();
        const clientId = PAYPAL_CLIENT_ID.value();
        const clientSecret = PAYPAL_CLIENT_SECRET.value();
        if (!clientId || !clientSecret) {
            throw new HttpsError(
                "failed-precondition",
                "PayPal no está configurado en el servidor (faltan secretos)."
            );
        }

        const token = await getAccessToken(clientId, clientSecret, env);
        const orderRes = await fetch(`${paypalApiBase(env)}/v2/checkout/orders`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                intent: "CAPTURE",
                purchase_units: [
                    {
                        reference_id: sku,
                        amount: {
                            currency_code: product.currency,
                            value: product.price.toFixed(2),
                        },
                        description: `${product.label} - PMP Simulator Pro`,
                    },
                ],
            }),
        });
        if (!orderRes.ok) {
            const txt = await orderRes.text();
            logger.error("PayPal create order failed", { status: orderRes.status, body: txt });
            throw new HttpsError("internal", "Error al crear orden en PayPal.");
        }
        const order = await orderRes.json();

        // Registramos el intent en Firestore con estado pending.
        await admin.firestore().collection("payments").doc(order.id).set({
            uid: request.auth.uid,
            sku,
            amount: product.price,
            currency: product.currency,
            dias: product.dias,
            status: "pending",
            source: "paypal",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return { orderID: order.id, sku, amount: product.price, currency: product.currency };
    }
);

// ----------------------------------------------------------------------------
// capturePaypalOrder — confirma el pago y extiende el acceso.
// Idempotente: el helper aplicarPagoYExtenderAcceso usa transaction y flag
// appliedAt en el payment doc para que si el webhook llega antes/después no
// duplique los días.
// ----------------------------------------------------------------------------
exports.capturePaypalOrder = onCall(
    {
        region: "us-central1",
        secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV],
        maxInstances: 10,
    },
    async (request) => {
        assertAuth(request);
        const { orderID } = request.data || {};
        if (!orderID) {
            throw new HttpsError("invalid-argument", "orderID requerido.");
        }

        const env = (PAYPAL_ENV.value() || "sandbox").trim();
        const token = await getAccessToken(
            PAYPAL_CLIENT_ID.value(),
            PAYPAL_CLIENT_SECRET.value(),
            env
        );

        const db = admin.firestore();
        const payRef = db.collection("payments").doc(orderID);
        const paySnap = await payRef.get();
        if (!paySnap.exists) {
            throw new HttpsError("not-found", "Orden no encontrada.");
        }
        const payment = paySnap.data();
        if (payment.uid !== request.auth.uid) {
            throw new HttpsError("permission-denied", "Esta orden no te pertenece.");
        }

        // Captura en PayPal.
        const res = await fetch(
            `${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );
        const body = await res.json();

        if (!res.ok || body.status !== "COMPLETED") {
            logger.warn("PayPal capture not completed", { orderID, status: res.status, body });
            throw new HttpsError(
                "failed-precondition",
                `PayPal no completó el cobro (status=${body.status || res.status}).`
            );
        }

        // Aplicar efecto idempotentemente.
        const result = await aplicarPagoYExtenderAcceso(db, payment.uid, orderID, "captured");

        // AUDIT: pago capturado y acceso extendido.
        logger.info("AUDIT_PAYMENT capture completed", {
            audit: "payment",
            action: "capturePaypalOrder",
            actor: request.auth.uid,
            actorEmail: request.auth.token?.email || null,
            orderID,
            sku: payment.sku,
            amount: payment.amount,
            currency: payment.currency,
            alreadyApplied: result.alreadyApplied,
            validUntil: result.validUntil.toISOString(),
            ts: new Date().toISOString(),
        });

        return {
            ok: true,
            orderID,
            status: body.status,
            validUntil: result.validUntil.toISOString(),
            alreadyApplied: result.alreadyApplied,
        };
    }
);

// ----------------------------------------------------------------------------
// paypalWebhook — backup asíncrono. Verifica firma de PayPal y aplica el
// efecto si la callable no lo hizo.
// ----------------------------------------------------------------------------
exports.paypalWebhook = onRequest(
    {
        region: "us-central1",
        secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENV],
        maxInstances: 10,
        cors: false,
    },
    async (req, res) => {
        if (req.method !== "POST") {
            res.status(405).send("Method not allowed");
            return;
        }
        const env = (PAYPAL_ENV.value() || "sandbox").trim();
        const webhookId = PAYPAL_WEBHOOK_ID.value();
        if (!webhookId) {
            res.status(500).send("Webhook no configurado");
            return;
        }

        try {
            const token = await getAccessToken(
                PAYPAL_CLIENT_ID.value(),
                PAYPAL_CLIENT_SECRET.value(),
                env
            );

            const verifyBody = {
                auth_algo: req.header("paypal-auth-algo"),
                cert_url: req.header("paypal-cert-url"),
                transmission_id: req.header("paypal-transmission-id"),
                transmission_sig: req.header("paypal-transmission-sig"),
                transmission_time: req.header("paypal-transmission-time"),
                webhook_id: webhookId,
                webhook_event: req.body,
            };

            const verifyRes = await fetch(
                `${paypalApiBase(env)}/v1/notifications/verify-webhook-signature`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(verifyBody),
                }
            );
            const verify = await verifyRes.json();
            if (verify.verification_status !== "SUCCESS") {
                // AUDIT: firma de webhook inválida — posible intento de
                // simular un pago. Configurar alerta sobre AUDIT_PAYMENT_FRAUD.
                logger.warn("AUDIT_PAYMENT_FRAUD webhook firma inválida", {
                    audit: "payment_fraud",
                    action: "paypalWebhook",
                    severity: "high",
                    sourceIp: req.ip || null,
                    verify,
                    ts: new Date().toISOString(),
                });
                res.status(401).send("Invalid signature");
                return;
            }

            const event = req.body || {};
            const eventId = event.id;
            if (!eventId) {
                res.status(400).send("Missing event id");
                return;
            }

            const db = admin.firestore();
            const eventRef = db.collection("payment_events").doc(eventId);

            // Idempotencia por evento.
            const existing = await eventRef.get();
            if (existing.exists) {
                res.status(200).send("Already processed");
                return;
            }
            await eventRef.set({
                type: event.event_type,
                receivedAt: admin.firestore.FieldValue.serverTimestamp(),
                resourceId: event.resource?.id || null,
                raw: event,
            });

            const orderId =
                event.resource?.supplementary_data?.related_ids?.order_id ||
                event.resource?.id;

            if (
                orderId &&
                ["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"].includes(event.event_type)
            ) {
                const payRef = db.collection("payments").doc(orderId);
                const paySnap = await payRef.get();
                if (paySnap.exists) {
                    const payment = paySnap.data();
                    await aplicarPagoYExtenderAcceso(db, payment.uid, orderId, "verified");
                }
            }

            res.status(200).send("OK");
        } catch (e) {
            logger.error("Webhook PayPal error", e);
            res.status(500).send("Server error");
        }
    }
);

// ----------------------------------------------------------------------------
// Helper: extiende acceso_validUntil del usuario en una transaction.
// Idempotente: si payment.appliedAt ya está, devuelve sin tocar nada.
// ----------------------------------------------------------------------------
async function aplicarPagoYExtenderAcceso(db, uid, orderID, nuevoStatus) {
    const userRef = db.collection("usuarios").doc(uid);
    const payRef = db.collection("payments").doc(orderID);

    return await db.runTransaction(async (tx) => {
        const paySnap = await tx.get(payRef);
        if (!paySnap.exists) throw new Error("Payment doc missing");
        const payment = paySnap.data();

        // Idempotencia.
        if (payment.appliedAt) {
            const userSnap = await tx.get(userRef);
            const validUntil = userSnap.data()?.acceso_validUntil
                ? new Date(userSnap.data().acceso_validUntil)
                : new Date();
            return { validUntil, alreadyApplied: true };
        }

        const userSnap = await tx.get(userRef);
        const userData = userSnap.exists ? userSnap.data() : {};
        const now = new Date();
        const currentValidUntil = userData.acceso_validUntil
            ? new Date(userData.acceso_validUntil)
            : null;

        // Si ya tiene acceso vigente, sumar al final del período actual.
        // Si está vencido o nunca tuvo, sumar desde hoy.
        const baseFecha = currentValidUntil && currentValidUntil > now ? currentValidUntil : now;
        const newValidUntil = new Date(
            baseFecha.getTime() + payment.dias * 24 * 60 * 60 * 1000
        );

        tx.set(
            userRef,
            { acceso_validUntil: newValidUntil.toISOString() },
            { merge: true }
        );
        tx.update(payRef, {
            status: nuevoStatus,
            appliedAt: admin.firestore.FieldValue.serverTimestamp(),
            previousValidUntil: currentValidUntil ? currentValidUntil.toISOString() : null,
            newValidUntil: newValidUntil.toISOString(),
        });

        return { validUntil: newValidUntil, alreadyApplied: false };
    });
}
