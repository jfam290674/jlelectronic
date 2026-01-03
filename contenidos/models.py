from django.db import models

class Marca(models.Model):
    nombre = models.CharField(max_length=100, unique=True)
    def __str__(self): return self.nombre

class Modelo(models.Model):
    marca = models.ForeignKey(Marca, on_delete=models.CASCADE, related_name='modelos')
    nombre = models.CharField(max_length=100)
    class Meta:
        unique_together = ('marca', 'nombre')
    def __str__(self): return f'{self.marca} {self.nombre}'

def upload_video_path(instance, filename):
    return f'videos/{instance.marca_id}/{instance.modelo_id}/{filename}'

def upload_manual_path(instance, filename):
    return f'manuales/{instance.marca_id}/{instance.modelo_id}/{filename}'

def upload_imagen_path(instance, filename):
    return f'imagenes/{instance.marca_id}/{instance.modelo_id}/{filename}'

class Video(models.Model):
    titulo = models.CharField(max_length=200)
    marca = models.ForeignKey(Marca, on_delete=models.PROTECT)
    modelo = models.ForeignKey(Modelo, on_delete=models.PROTECT)
    archivo = models.FileField(upload_to=upload_video_path)
    creado = models.DateTimeField(auto_now_add=True)
    def __str__(self): return self.titulo

class Manual(models.Model):
    titulo = models.CharField(max_length=200)
    marca = models.ForeignKey(Marca, on_delete=models.PROTECT)
    modelo = models.ForeignKey(Modelo, on_delete=models.PROTECT)
    archivo = models.FileField(upload_to=upload_manual_path)
    creado = models.DateTimeField(auto_now_add=True)
    def __str__(self): return self.titulo

class Imagen(models.Model):
    titulo = models.CharField(max_length=200)
    marca = models.ForeignKey(Marca, on_delete=models.PROTECT)
    modelo = models.ForeignKey(Modelo, on_delete=models.PROTECT)
    archivo = models.FileField(upload_to=upload_imagen_path)
    creado = models.DateTimeField(auto_now_add=True)
    def __str__(self): return self.titulo