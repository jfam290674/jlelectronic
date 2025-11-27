# diagnose_error_500.py - Script de diagnóstico para error 500 en SRI

try:
    # Paso 1: Importar dependencias clave de SRI
    import zeep
    import requests
    import signxml
    import cryptography
    import lxml.etree as etree  # Para validación XML/XSD
    print("OK: Todas las dependencias importadas correctamente.")
except ImportError as e:
    print(f"ERROR: Falta módulo - {str(e)}")
    exit(1)  # Salir si faltan imports básicos

try:
    # Paso 2: Test básico de certificado (asumiendo path en settings o modelo Empresa)
    from billing.models import Empresa
    empresa = Empresa.objects.first()  # Toma la primera empresa; ajusta si hay múltiples
    if not empresa:
        print("ADVERTENCIA: No hay empresas configuradas en BD.")
    else:
        from cryptography.hazmat.primitives.serialization.pkcs12 import load_key_and_certificates
        with open(empresa.certificado.path, 'rb') as f:
            data = f.read()
        load_key_and_certificates(data, empresa.certificado_password.encode())
        print("OK: Certificado cargado y legible (no vencido verificado manualmente).")
except Exception as e:
    print(f"ERROR en certificado: {str(e)}")

try:
    # Paso 3: Test de lógica SRI básica (crear cliente Zeep para WS SRI)
    from billing.services.sri.client import get_sri_client  # Asume función en client.py; ajusta si difiere
    client = get_sri_client(ambiente=1)  # 1=Pruebas; ajusta según config
    print("OK: Cliente SRI inicializado.")
    # Test de llamada dummy (recepción, no envío real)
    response = client.service.validarComprobante('<xml>dummy</xml>')  # Esto fallará intencionalmente si WS no responde
    print("OK: Llamada SRI dummy ejecutada.")
except Exception as e:
    print(f"ERROR en lógica SRI: {str(e)}")

print("Diagnóstico completado. Revisa mensajes arriba para issues específicos.")