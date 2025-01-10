from app import app

@app.route('/')
def home():
    return "¡Hola desde Visual Studio Code! Este cambio se refleja en GitHub y cPanel."
