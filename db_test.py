from app import create_app, db  # Importa la app y la base de datos
from sqlalchemy import text  # Importa text para ejecutar SQL directamente

# Crear la aplicación Flask
app = create_app()

# Contexto de la aplicación
with app.app_context():
    # Conectar a la base de datos
    with db.engine.connect() as conn:
        # Ejecutar consulta para verificar la base de datos actual
        result = conn.execute(text("SELECT DATABASE();"))
        for row in result:
            print(f"Base de datos actual: {row[0]}")
