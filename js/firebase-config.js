import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCIjxMJ1837p-rN7Husua5jgVLr9MRi_Fg", 
    authDomain: "pmp-simulator-pro-c656a.firebaseapp.com",
    projectId: "pmp-simulator-pro-c656a",
    storageBucket: "pmp-simulator-pro-c656a.firebasestorage.app",
    messagingSenderId: "574994878534",
    appId: "1:574994878534:web:e9a98ac2d9e0ec85c73a47",
    measurementId: "G-GC4GRLVQ1B"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
