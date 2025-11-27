# validate_cert.py - Script de validación crítica para certificado digital SRI

from billing.models import Empresa
from cryptography.hazmat.primitives.serialization.pkcs12 import load_key_and_certificates
from cryptography.x509 import load_der_x509_certificate
from cryptography.hazmat.backends import default_backend
from datetime import datetime
import os

try:
    # Paso 1: Obtener la primera empresa (ajusta si múltiples)
    empresa = Empresa.objects.first()
    if not empresa:
        print("ERROR: No hay empresas configuradas en la BD.")
        exit(1)
    
    cert_path = empresa.certificado.path
    if not os.path.exists(cert_path):
        print(f"ERROR: Certificado no existe en {cert_path}")
        exit(1)
    
    print(f"OK: Certificado encontrado en {cert_path}")
    
    # Paso 2: Cargar y validar legibilidad
    with open(cert_path, 'rb') as f:
        data = f.read()
    private_key, certificate, additional_certs = load_key_and_certificates(
        data, empresa.certificado_password.encode('utf-8')
    )
    print("OK: Certificado cargado y legible con contraseña proporcionada.")
    
    # Paso 3: Verificar no vencido
    cert = load_der_x509_certificate(certificate.public_bytes(encoding='DER'), default_backend())
    now = datetime.utcnow()
    if now < cert.not_valid_before or now > cert.not_valid_after:
        print(f"ERROR: Certificado vencido. Válido desde {cert.not_valid_before} hasta {cert.not_valid_after}")
    else:
        print(f"OK: Certificado vigente (válido hasta {cert.not_valid_after})")
    
    # Paso 4: Info adicional (opcional: sujeto, issuer)
    print(f"INFO: Sujeto: {cert.subject.rfc4514_string()}")
    print(f"INFO: Emisor: {cert.issuer.rfc4514_string()}")

except Exception as e:
    print(f"ERROR CRÍTICO en validación de certificado: {str(e)}")

print("Validación de certificado completada.")