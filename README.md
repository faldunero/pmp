Markdown
# PMP Simulator Pro 

**PMP Simulator Pro** es una herramienta web de alto rendimiento diseñada para la preparación intensiva del examen Project Management Professional (PMP). Este simulador replica la experiencia real del examen del PMI, permitiendo a los usuarios entrenar su agilidad mental y la aplicación del "mindset" correcto bajo condiciones de estrés y tiempo controlado.

---

##  Stack Tecnológico

El proyecto está construido bajo una arquitectura **Serverless**, priorizando la velocidad y la disponibilidad:

* **Frontend:** HTML5, CSS3 (Grid & Flexbox) y JavaScript Vanilla (ES6+).
* **Backend:** Firebase Firestore (Base de datos NoSQL en tiempo real).
* **Despliegue:** GitHub Pages para hosting estático.

---

## Características Principales

### Entrenamiento a Medida
* **Bloques Flexibles:** Configuración de exámenes desde 20 hasta 180 preguntas.
* **Simulación Real:** El examen de 180 preguntas incluye las **pausas reglamentarias** obligatorias tras la pregunta 60 y 120, tal como en el centro de examen Pearson VUE.
* **Algoritmo de Aleatoriedad:** Selección dinámica sobre un banco de 321 preguntas para evitar el aprendizaje por memoria de posición.

### 📊 Análisis y Mindset
* **Reporte de Desempeño:** Desglose detallado por Dominio ECO (Personas, Procesos, Entorno de Negocio) y Enfoque (Predictivo, Ágil, Híbrido).
* **Corrección Inteligente:** Feedback inmediato al finalizar con explicación detallada y **Mindset Clave** para cada pregunta (fallida o no contestada).
* **Control de Tiempo:** Cronómetro integrado con cálculo proporcional según la cantidad de preguntas seleccionadas.

---

## Seguridad y Datos

La aplicación utiliza **Firebase Security Rules** para garantizar que el banco de preguntas sea de solo lectura para el cliente, protegiendo la integridad del material de estudio:

```javascript
allow read: if true;
allow write: if false;
Cómo utilizarlo
Accede al simulador en vivo: [TU_URL_DE_GITHUB_PAGES_AQUÍ]

Selecciona la cantidad de preguntas para tu sesión de estudio.

Responde las preguntas aplicando la lógica del PMBOK 7 y la Guía Ágil.

Analiza tus resultados y ajusta tu plan de estudio según los dominios con menor puntaje.

👨‍💻 Autor
Felipe Ignacio Aldunate Romero Delivery Manager & IT Project Lead


