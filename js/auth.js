import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-firestore.js";

async function crearCuenta() {
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-pass').value;
    const nombre = document.getElementById('reg-nombre').value;
    const apellido = document.getElementById('reg-apellido').value;

    if (pass.length < 8) {
        alert("La contraseña debe tener al menos 8 caracteres por seguridad.");
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
        const user = userCredential.user;

        // Guardamos los datos adicionales en Firestore
        await setDoc(doc(db, "usuarios", user.uid), {
            nombre: nombre,
            apellido: apellido,
            genero: document.getElementById('reg-genero').value,
            edad: document.getElementById('reg-edad').value,
            email: email,
            fechaRegistro: new Date()
        });

        alert("¡Alumno registrado con éxito!");
        document.getElementById('home-screen').style.display = 'none';
        document.getElementById('quiz-area').style.display = 'block';
    } catch (error) {
        alert("Error: " + error.message);
    }
}
window.crearCuenta = crearCuenta;
