from django.contrib import admin
from .models import Marca, Modelo, Video, Manual

@admin.register(Marca)
class MarcaAdmin(admin.ModelAdmin):
    search_fields = ('nombre',)

@admin.register(Modelo)
class ModeloAdmin(admin.ModelAdmin):
    list_display = ('marca', 'nombre')
    list_filter = ('marca',)
    search_fields = ('nombre',)

@admin.register(Video)
class VideoAdmin(admin.ModelAdmin):
    list_display = ('titulo', 'marca', 'modelo', 'creado')
    list_filter = ('marca', 'modelo')
    search_fields = ('titulo',)
    autocomplete_fields = ('marca', 'modelo')  # permite buscar/crear con el “+”

@admin.register(Manual)
class ManualAdmin(admin.ModelAdmin):
    list_display = ('titulo', 'marca', 'modelo', 'creado')
    list_filter = ('marca', 'modelo')
    search_fields = ('titulo',)
    autocomplete_fields = ('marca', 'modelo')
