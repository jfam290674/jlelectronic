from flask import Flask
from flask_sqlalchemy import SQLAlchemy
import os
import sys

# Asegurarse de que la codificación predeterminada sea UTF-8
if hasattr(sys, 'setdefaultencoding'):
    sys.setdefaultencoding('utf-8')



db = SQLAlchemy()

def create_app():
    app = Flask(__name__)
    
        # Configuración de la base de datos
    app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://nexosdel_citas:4Pz{Q$U%YH2}@localhost/nexosdel_citas'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    app.secret_key = 'afc913bae69160ff2f413725d213e3dc8b6b1a3ee39e757b4c240c33304efe54'


    # Inicializar la base de datos con la app
    db.init_app(app)

    # Registrar las rutas después de inicializar la app
    from app.routes import routes
    app.register_blueprint(routes)

    return app
