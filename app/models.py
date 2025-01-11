from datetime import datetime
from app import db  # Asegura que db proviene de __init__.py

class Cita(db.Model):
    __tablename__ = 'citas'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    nombre_cliente = db.Column(db.String(100), nullable=False)
    contacto = db.Column(db.String(50), nullable=False)  # Tel¨¦fono o correo electr¨®nico
    fecha = db.Column(db.Date, nullable=False)
    hora = db.Column(db.Time, nullable=False)
    descripcion = db.Column(db.Text, nullable=True)  # Breve descripci¨®n
    estado = db.Column(db.String(20), default='Pendiente')  # Pendiente, Confirmada, Cancelada
    tipo_cita = db.Column(db.String(50), nullable=False)  # Tipo de cita (venta, consulta, etc.)
    fecha_creacion = db.Column(db.DateTime, default=datetime.utcnow)  # Fecha de registro
