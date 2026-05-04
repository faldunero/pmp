"use strict";

/**
 * Punto de entrada de Cloud Functions.
 *
 * Las funciones individuales viven en archivos separados:
 *   - auth.js       -> setProfesorClaim, setAdminClaim, getMyRole, listUsersWithRoles
 *   - questions.js  -> getQuestions, gradeAttempt, uploadQuestions
 *   - access.js     -> getMyAccess, getTrialConfig, setTrialConfig (config admin)
 *   - paypal.js     -> listPlans, getPaypalClientId, createPaypalOrder, capturePaypalOrder, paypalWebhook
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
