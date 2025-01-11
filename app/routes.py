# app/routes.py

from flask import Blueprint, render_template, request, redirect, url_for, flash
from app.models import db, Cita
from datetime import datetime

# Crear un Blueprint para manejar las rutas
routes = Blueprint('routes', __name__)

# Ruta raíz (Home)
@routes.route('/')
def home():
    return render_template('home.html')

# Ruta para la página "Acerca de Nosotros"
@routes.route('/about')
def about():
    return render_template('about.html')

# Ruta para listar citas
@routes.route('/citas')
def listar_citas():
    citas = Cita.query.order_by(Cita.fecha, Cita.hora).all()
    return render_template('citas.html', citas=citas)

# Ruta para agregar una nueva cita
@routes.route('/citas/nueva', methods=['GET', 'POST'])
def nueva_cita():
    if request.method == 'POST':
        try:
            nombre_cliente = request.form.get('nombre_cliente', '').strip()
            contacto = request.form.get('contacto', '').strip()
            fecha = request.form.get('fecha', '').strip()
            hora = request.form.get('hora', '').strip()
            descripcion = request.form.get('descripcion', '').strip()
            tipo_cita = request.form.get('tipo_cita', '').strip()

            if not nombre_cliente or not contacto or not fecha or not hora or not tipo_cita:
                flash('Todos los campos requeridos deben ser completados.', 'danger')
                return render_template('nueva_cita.html')

            fecha_obj = datetime.strptime(fecha, '%Y-%m-%d').date()
            hora_obj = datetime.strptime(hora, '%H:%M').time()

            nueva_cita = Cita(
                nombre_cliente=nombre_cliente,
                contacto=contacto,
                fecha=fecha_obj,
                hora=hora_obj,
                descripcion=descripcion,
                tipo_cita=tipo_cita
            )
            db.session.add(nueva_cita)
            db.session.commit()
            flash('¡Cita creada con éxito!', 'success')
            return redirect(url_for('routes.listar_citas'))
        except Exception as e:
            db.session.rollback()
            flash(f'Error al crear la cita: {str(e)}', 'danger')
            return render_template('nueva_cita.html')
    return render_template('nueva_cita.html')

# Ruta para eliminar una cita
@routes.route('/citas/eliminar/<int:id>', methods=['POST'])
def eliminar_cita(id):
    try:
        cita = Cita.query.get_or_404(id)
        db.session.delete(cita)
        db.session.commit()
        flash('¡Cita eliminada con éxito!', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error al eliminar la cita: {str(e)}', 'danger')
    return redirect(url_for('routes.listar_citas'))

# Ruta para editar el estado de una cita
@routes.route('/citas/estado/<int:id>', methods=['POST'])
def cambiar_estado(id):
    try:
        cita = Cita.query.get_or_404(id)
        nuevo_estado = request.form.get('estado', 'Pendiente')
        cita.estado = nuevo_estado
        db.session.commit()
        flash(f'Estado de la cita actualizado a "{nuevo_estado}".', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error al cambiar el estado: {str(e)}', 'danger')
    return redirect(url_for('routes.listar_citas'))

# Ruta para editar los detalles de una cita
@routes.route('/citas/editar/<int:id>', methods=['GET', 'POST'])
def editar_cita(id):
    cita = Cita.query.get_or_404(id)
    if request.method == 'POST':
        try:
            cita.nombre_cliente = request.form.get('nombre_cliente', '').strip()
            cita.contacto = request.form.get('contacto', '').strip()
            cita.fecha = datetime.strptime(request.form.get('fecha', ''), '%Y-%m-%d').date()
            cita.hora = datetime.strptime(request.form.get('hora', ''), '%H:%M').time()
            cita.descripcion = request.form.get('descripcion', '').strip()
            cita.tipo_cita = request.form.get('tipo_cita', '').strip()
            db.session.commit()
            flash('¡Cita actualizada con éxito!', 'success')
            return redirect(url_for('routes.listar_citas'))
        except Exception as e:
            db.session.rollback()
            flash(f'Error al actualizar la cita: {str(e)}', 'danger')
    return render_template('editar_cita.html', cita=cita)
