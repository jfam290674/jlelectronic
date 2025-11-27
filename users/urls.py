from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views  # importa el módulo completo

app_name = "users"

router = DefaultRouter()
router.register(r'users', views.UserViewSet, basename='users')  # -> /api/auth/users/

urlpatterns = [
    # Registro (username = cédula)
    path('register/', views.RegisterView.as_view(), name='register'),

    # Auth / sesión
    path('csrf/', views.CSRFView.as_view(), name='csrf'),
    path('login/', views.LoginView.as_view(), name='login'),
    path('logout/', views.LogoutView.as_view(), name='logout'),
    path('me/', views.MeView.as_view(), name='me'),

    # Password reset
    path('password/reset/', views.PasswordResetRequestView.as_view(), name='password-reset'),
    path('password/reset/confirm/', views.PasswordResetConfirmView.as_view(), name='password-reset-confirm'),

    # Endpoints del router (CRUD admin de usuarios)
    path('', include(router.urls)),
]
