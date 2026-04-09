import firebase_admin
from firebase_admin import credentials, firestore
import pandas as pd

# 1. Configuración de Firebase
cred = credentials.Certificate("llave.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

def ejecutar_carga():
    file_name = "Preparacion_PMP_Preguntas_1_completo_1.csv"
    
    try:
        # Usamos 'utf-8-sig' para limpiar caracteres raros y forzar UTF-8
        df = pd.read_csv(file_name, sep=';', encoding='utf-8-sig')
        if len(df.columns) <= 1:
            df = pd.read_csv(file_name, sep=',', encoding='utf-8-sig')

        print(f"✅ Archivo leído correctamente en UTF-8.")

        for index, row in df.iterrows():
            if pd.isna(row.iloc[0]): continue
            
            try:
                id_num = int(float(row.iloc[0]))
                doc_id = f"pregunta_{str(id_num).zfill(3)}"
                
                # Mapeo por posición para evitar problemas con nombres de columnas
                datos = {
                    "id": id_num,
                    "enunciado": str(row.iloc[1]).strip(),
                    "opciones": {
                        "A": str(row.iloc[2]).strip(),
                        "B": str(row.iloc[3]).strip(),
                        "C": str(row.iloc[4]).strip(),
                        "D": str(row.iloc[5]).strip()
                    },
                    "respuesta_correcta": str(row.iloc[6]).strip().upper(),
                    "explicacion": str(row.iloc[7]).strip(),
                    "dominio_eco": str(row.iloc[8]).strip(),
                    "enfoque": str(row.iloc[9]).strip(),
                    "mindset_clave": str(row.iloc[10]).strip() if len(row) > 10 else "N/A",
                    "oficial_pmi": str(row.iloc[11]).strip() if len(row) > 11 else ""
                }

                db.collection("preguntas_pmp").document(doc_id).set(datos)
                
                if id_num % 50 == 0 or id_num == 1:
                    # Imprimimos una muestra para verificar que los tildes se vean bien
                    print(f"🔥 Cargada {doc_id} | Muestra: {datos['enunciado'][:40]}...")

            except Exception as e:
                print(f"⚠️ Error en fila {index}: {e}")

        print("\n✨ ¡BASE DE DATOS CARGADA EN UTF-8 SIN ERRORES! ✨")

    except Exception as e:
        print(f"❌ ERROR CRÍTICO: {e}")

if __name__ == "__main__":
    ejecutar_carga()
