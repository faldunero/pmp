"use strict";

/**
 * Punto de entrada de Cloud Functions.
 *
 * Las funciones individuales viven en archivos separados:
 *   - auth.js        -> setProfesorClaim, setAdminClaim, getMyRole, listUsersWithRoles
 *   - questions.js   -> getQuestions, gradeAttempt, uploadQuestions (banco simulador)
 *   - access.js      -> getMyAccess, getTrialConfig, setTrialConfig (config admin)
 *   - paypal.js      -> listPlans, getPaypalClientId, createPaypalOrder, capturePaypalOrder, paypalWebhook
 *   - sessions.js    -> claimSession, releaseSession (single-session)
 *   - admin_views.js -> listSubscriptions
 *   - tracks.js      -> listTracks, getTrackDetail, getLeccion, marcarLeccionCompletada, getDashboardAlumno
 *   - ai_content.js  -> generarLeccionConIA, publicarLeccion, despublicarLeccion, actualizarLeccion
 */

const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");

admin.initializeApp();

setGlobalOptions({ region: "us-central1", maxInstances: 20 });

// Auth / claims
const auth = require("./auth");
exports.setProfesorClaim = auth.setProfesorClaim;
exports.setAdminClaim = auth.setAdminClaim;
exports.getMyRole = auth.getMyRole;
exports.listUsersWithRoles = auth.listUsersWithRoles;

// Preguntas
const questions = require("./questions");
exports.getQuestions = questions.getQuestions;
exports.gradeAttempt = questions.gradeAttempt;
exports.uploadQuestions = questions.uploadQuestions;
exports.getQuestionsByIds = questions.getQuestionsByIds;

// Acceso (gating freemium)
const access = require("./access");
exports.getMyAccess = access.getMyAccess;
exports.getTrialConfig = access.getTrialConfig;
exports.setTrialConfig = access.setTrialConfig;

// PayPal
const paypal = require("./paypal");
exports.listPlans = paypal.listPlans;
exports.getPaypalClientId = paypal.getPaypalClientId;
exports.createPaypalOrder = paypal.createPaypalOrder;
exports.capturePaypalOrder = paypal.capturePaypalOrder;
exports.paypalWebhook = paypal.paypalWebhook;

// Single-session enforcement
const sessions = require("./sessions");
exports.claimSession = sessions.claimSession;
exports.releaseSession = sessions.releaseSession;

// Vistas administrativas
const adminViews = require("./admin_views");
exports.listSubscriptions = adminViews.listSubscriptions;

// Tracks (rutas de certificación) — catálogo, estructura, lecciones, dashboard, progreso
const tracks = require("./tracks");
exports.listTracks = tracks.listTracks;
exports.getTrackDetail = tracks.getTrackDetail;
exports.getLeccion = tracks.getLeccion;
exports.marcarLeccionCompletada = tracks.marcarLeccionCompletada;
exports.getDashboardAlumno = tracks.getDashboardAlumno;

// Generación de contenido con IA — DESACTIVADO temporalmente.
// El archivo functions/ai_content.js sigue en el repo. Para reactivar:
//   1. Volver a agregar "@anthropic-ai/sdk" a package.json y npm install.
//   2. Setear el secret: firebase functions:secrets:set ANTHROPIC_API_KEY
//   3. Descomentar las siguientes líneas y redeployar.
// const aiContent = require("./ai_content");
// exports.generarLeccionConIA = aiContent.generarLeccionConIA;
// exports.publicarLeccion = aiContent.publicarLeccion;
// exports.despublicarLeccion = aiContent.despublicarLeccion;
// exports.actualizarLeccion = aiContent.actualizarLeccion;
