from app import app

# Ruta principal
@app.route('/')
def home():
    return "¡Hola desde Visual Studio Code! Este cambio se refleja en GitHub y cPanel."

# Nueva ruta: About
@app.route('/about')
def about():
    return "Esta es la página de 'Acerca de'. Aquí podrías describir tu aplicación."
