# run.py

from app import create_app, db
from app.models import Cita  # Asegura que el modelo esté cargado

app = create_app()

if __name__ == "__main__":
    # Crear las tablas automáticamente si no existen
    with app.app_context():
        db.create_all()
        print("Tablas creadas con éxito.")

    # Iniciar el servidor de desarrollo
    app.run()
