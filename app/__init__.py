import pymysql
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

# Usar PyMySQL como backend para SQLAlchemy
pymysql.install_as_MySQLdb()

# Crear una instancia de Flask
app = Flask(__name__)

# Configuraci¨®n de la base de datos MySQL
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql://nexosdel_citas:4Pz{Q$U%YH2}@localhost/nexosdel_citas'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Inicializar SQLAlchemy
db = SQLAlchemy(app)

# Importar las rutas
from app import routes
