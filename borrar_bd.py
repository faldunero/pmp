import firebase_admin
from firebase_admin import credentials, firestore

# Configuración
cred = credentials.Certificate("llave.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

def limpiar_base_de_datos():
    coleccion = "preguntas_pmp"
    print(f"⚠️  Preparando para borrar todo en '{coleccion}'...")
    
    docs = db.collection(coleccion).stream()
    contador = 0
    
    for doc in docs:
        doc.reference.delete()
        contador += 1
        if contador % 50 == 0:
            print(f"      Eliminando... {contador} documentos")
            
    print(f"\n✅ ÉXITO: Se han borrado {contador} preguntas. La base de datos está limpia.")

if __name__ == "__main__":
    confirmacion = input("¿Estás SEGURO de borrar TODA la base de datos? (si/no): ")
    if confirmacion.lower() == 'si':
        limpiar_base_de_datos()
    else:
        print("Operación cancelada.")
