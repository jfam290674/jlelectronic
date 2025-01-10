from flask import Flask

# Crear una instancia de Flask
app = Flask(__name__)

# Importar las rutas
from app import routes
