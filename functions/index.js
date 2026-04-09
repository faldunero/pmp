const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");

admin.initializeApp();

// Forzamos la región a us-central1 y permitimos acceso CORS
setGlobalOptions({ region: "us-central1" });

exports.getQuestions = onRequest({ cors: true }, async (req, res) => {
    const db = admin.firestore();
    try {
        const snapshot = await db.collection("preguntas_pmp").get();
        const questions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(questions);
    } catch (error) {
        console.error("Error obteniendo preguntas:", error);
        res.status(500).send("Error interno");
    }
});
