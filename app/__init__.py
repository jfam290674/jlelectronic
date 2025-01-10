from flask import Flask

# Crear una instancia de Flask
app = Flask(__name__)

# Importar las rutas
from app import routes
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)

# Configuración de la base de datos SQLite
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///citas.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Inicializar SQLAlchemy
from app.models import db
db.init_app(app)

# Importar las rutas
from app import routes
