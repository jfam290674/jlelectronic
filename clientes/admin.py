# clientes/admin.py
from django.contrib import admin
from .models import Cliente

@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = ('identificador', 'nombre', 'ciudad', 'celular', 'email', 'activo', 'actualizado')
    list_filter = ('activo', 'ciudad')
    search_fields = ('identificador', 'nombre', 'email', 'celular')
    ordering = ('-actualizado',)
