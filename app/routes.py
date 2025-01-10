from app import app

@app.route('/')
def home():
    return "¡Hola, mundo! Esta es una aplicación Flask modular."
