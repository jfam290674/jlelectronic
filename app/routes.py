from flask import render_template
from app import app

# Ruta principal
@app.route('/')
def home():
    return render_template('home.html')

# Nueva ruta: About
@app.route('/about')
def about():
    return render_template('about.html')

