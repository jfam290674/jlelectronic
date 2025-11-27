# bodega/views.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Mapping, Any, Iterable, List, Dict
import logging
from decimal import Decimal  # puede quedar aunque no se use, no rompe

from django.apps import apps
from django.db import transaction, IntegrityError
from django.db.models import Q, QuerySet
from django.utils import timezone

from rest_framework import mixins, status, viewsets
from rest_framework import serializers as drf_serializers
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny, IsAdminUser, BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import ValidationError as DRFValidationError

from .models import (
    PRODUCT_MODEL,
    InventorySettings,
    MinLevel,
    Movement,
    MovementLine,
    PartRequest,
    StockAlert,
    StockItem,
    Warehouse,
    TechPurchase,
    Machine,
)

# Permisos
from .permissions import IsTechViewer, CanRequestParts, _in_groups  # usamos _in_groups

# Serializadores
from .serializers import (
    WarehouseSerializer,
    InventorySettingsSerializer,
    StockItemSerializer,
    MinLevelSerializer,
    MovementSerializer,
    StockAlertSerializer,
    PartRequestSerializer,
    ProductEmbeddedSerializer,
    TechPurchaseSerializer,
    MachineSerializer,
)

# Selectores
from .selectors import (
    stock_queryset,
    movements_queryset,
    alerts_queryset,
    negative_stock_queryset,
)

# Filtros y paginación
from .filters import StockFilter, MovementFilter, StockAlertFilter
from .pagination import InventoryPagination, InventoryLargePagination

# Servicios
from .services import apply_movement, revert_movement

logger = logging.getLogger(__name__)

# ======================================================================================
# Helpers
# ======================================================================================


def _get_product_model():
    return apps.get_model(PRODUCT_MODEL)


# ======================================================================================
# ViewSets
# ======================================================================================


class WarehouseViewSet(viewsets.ModelViewSet):
    """
    CRUD de bodegas con orden estable (combos del wizard).
    """
    serializer_class = WarehouseSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = InventoryPagination

    filterset_fields = ("active",)
    search_fields = ("name", "code", "address")
    ordering_fields = ("name", "code", "id")
    ordering = ("name", "id")

    def get_queryset(self) -> QuerySet[Warehouse]:
        return Warehouse.objects.all().order_by(*self.ordering)


class StockViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    Lista de stock por (producto, bodega).

    Política anti-500:
      - Si NO viene búsqueda textual (?q=...), devolvemos SIEMPRE payload "seguro".
      - Si viene ?q=... o ?use_full=1, usamos selector/fallback y/o enriquecemos por lotes
        sin tocar instancias de producto (solo .values()).
    """
    serializer_class = StockItemSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = InventoryLargePagination
    filter_backends: list = []  # evitamos sorpresas

    _default_order = ("warehouse__name", "id")

    # ---------------------- QS SEGURO ----------------------
    def _safe_base_qs(self, params: Mapping[str, Any]) -> QuerySet[StockItem]:
        """
        QS seguro: sin join a Producto; filtra por IDs y negativos; orden estable.
        """
        qs = StockItem.objects.select_related("warehouse").all()

        wh = (params.get("warehouse") or "").strip()
        if wh:
            try:
                qs = qs.filter(warehouse_id=int(wh))
            except Exception:
                pass

        prod = (params.get("product") or "").strip()
        if prod:
            try:
                qs = qs.filter(product_id=int(prod))
            except Exception:
                pass

        neg = (params.get("negatives") or "").strip().lower()
        if neg in ("1", "true", "yes", "on", "si", "sí"):
            qs = qs.filter(quantity__lt=0)

        return qs.order_by(*self._default_order)

    # ------------------- FALLBACK DE SERIALIZACIÓN -------------------
    def _safe_serialize_item(self, obj: StockItem) -> dict:
        """
        Dict compatible con el front, sin consultar el modelo de producto.
        Tolerante a filas con datos raros.
        """
        try:
            ml = MinLevel.objects.filter(
                product_id=obj.product_id,
                warehouse_id=obj.warehouse_id,
            ).only("min_qty").first()
        except Exception:
            ml = None

        # warehouse_name: si acceder al related falla, devolvemos None
        try:
            wname = getattr(obj.warehouse, "name", None)
        except Exception:
            wname = None

        return {
            "id": obj.id,
            "product": obj.product_id,
            "warehouse": obj.warehouse_id,
            "warehouse_name": wname,
            "quantity": str(obj.quantity),
            "allow_negative": obj.allow_negative,
            "product_info": {"id": str(obj.product_id)},  # NO tocar PRODUCT_MODEL aquí
            "min_qty": (str(getattr(ml, "min_qty", "")) if ml else None),
        }

    def _serialize_page_with_fallback(
        self,
        rows: Iterable[StockItem],
        *,
        request: Request,
    ) -> List[dict]:
        """
        Serializa cada fila con el ModelSerializer; si alguna falla,
        cae a la versión "segura" de esa fila. Nunca rompe todo el listado.
        """
        out: List[dict] = []
        for o in rows:
            try:
                data = StockItemSerializer(o, context={"request": request}).data
                if isinstance(data.get("quantity"), (int, float)):
                    data["quantity"] = str(data["quantity"])
                out.append(data)
            except Exception:
                out.append(self._safe_serialize_item(o))
        return out

    def _safe_paginated_response(self, qs: QuerySet[StockItem]) -> Response:
        page = self.paginate_queryset(qs)
        if page is not None:
            data = [self._safe_serialize_item(o) for o in page]
            return self.paginator.get_paginated_response(data)  # type: ignore[attr-defined]
        data = [self._safe_serialize_item(o) for o in qs]
        return Response(data)

    # ------------------- Enriquecimiento por lotes (sin instancias) -------------------
    def _embed_products_batch(self, product_ids: Iterable[int]) -> Dict[int, Dict[str, Any]]:
        """
        Obtiene Product -> dict embebido por lotes, usando .values() (no FieldFile.url,
        no instancias, no select_related de objetos). Máxima tolerancia.
        ✅ Incluye CATEGORÍA.
        """
        try:
            ids = {int(pid) for pid in product_ids if pid is not None}
        except Exception:
            ids = set()
        if not ids:
            return {}

        try:
            Product = _get_product_model()
            # AÑADIDO: "categoria" para filtrado en frontend
            rows = list(
                Product.objects.filter(pk__in=ids).values(
                    "id",
                    # equivalencias
                    "codigo",  # code
                    "codigo_alterno",  # alt_code
                    "nombre_equipo",  # brand
                    "modelo",  # model
                    "foto",  # photo (ruta/nombre)
                    "categoria",  # para filtrado
                    # relacionados a texto
                    "tipo__nombre",  # type
                    "ubicacion__marca",  # location.marca
                    "ubicacion__numero_caja",  # location.caja
                )
            )
        except Exception:
            return {}

        out: Dict[int, Dict[str, Any]] = {}
        for r in rows:
            try:
                pid = int(r.get("id"))
            except Exception:
                continue

            marca = r.get("ubicacion__marca")
            caja = r.get("ubicacion__numero_caja")
            location = f"{marca} / Caja {caja}" if (marca and caja) else None

            # Normalizar categoría a mayúsculas
            cat_raw = r.get("categoria")
            categoria_norm = str(cat_raw).strip().upper() if cat_raw else None

            out[pid] = {
                "id": str(pid),
                "photo": r.get("foto") or None,
                "brand": r.get("nombre_equipo") or None,
                "model": r.get("modelo") or None,
                "code": r.get("codigo") or None,
                "alt_code": r.get("codigo_alterno") or None,
                "type": r.get("tipo__nombre") or None,
                "location": location,
                "categoria": categoria_norm,
            }
        return out

    # ------------------- OBTENCIÓN DEL QUERYSET -------------------
    def get_queryset(self) -> QuerySet[StockItem]:
        params = self.request.query_params
        qtxt = (params.get("q") or "").strip()
        use_full = (params.get("use_full") or "").strip().lower() in ("1", "true", "yes")

        if not qtxt and not use_full:
            # Lista "normal": SIEMPRE seguro
            return self._safe_base_qs(params)

        # Con búsqueda textual o "use_full", intentamos selector optimizado
        try:
            qs = stock_queryset(params).select_related("warehouse")
            if not params.get("ordering"):
                qs = qs.order_by(*self._default_order)
            return qs
        except Exception:
            return self._safe_base_qs(params)

    # ------------------- LIST -------------------
    def list(self, request: Request, *args, **kwargs):
        """
        Garantiza JSON incluso si falla el serializer completo.
        Si venimos por ruta "segura", no invocamos el serializer DRF en absoluto.
        En modo "completo", si alguna fila falla, se serializa esa fila en modo seguro.
        """
        params = request.query_params
        qtxt = (params.get("q") or "").strip()
        use_full = (params.get("use_full") or "").strip().lower() in ("1", "true", "yes")

        # ============ Modo seguro directo ============   (sin q y sin use_full)
        if not qtxt and not use_full:
            try:
                qs = self.get_queryset()  # ya es seguro
                return self._safe_paginated_response(qs)
            except Exception as e:
                return Response({"detail": f"Error listando stock (safe): {e}"}, status=400)

        # ============ Modo 'use_full' SIN búsqueda: seguro + enriquecido ============

        if use_full and not qtxt:
            try:
                qs = self._safe_base_qs(params)  # QS sin joins
                page = self.paginate_queryset(qs)
                rows = page if page is not None else list(qs)

                # Base segura
                base = [self._safe_serialize_item(o) for o in rows]

                # Enriquecer product_info por lotes SIN instancias
                try:
                    pid_list = [getattr(o, "product_id", None) for o in rows]
                except Exception:
                    pid_list = []
                embed_map = self._embed_products_batch(pid_list)

                for item in base:
                    try:
                        pid = int(item.get("product"))
                        info = embed_map.get(pid)
                        if info:
                            item["product_info"] = info
                    except Exception:
                        continue

                if page is not None:
                    return self.paginator.get_paginated_response(base)  # type: ignore[attr-defined]
                return Response(base)
            except Exception:
                # Si fallara el enriquecimiento, devolvemos la versión segura
                try:
                    return self._safe_paginated_response(self._safe_base_qs(params))
                except Exception as e2:
                    return Response(
                        {"detail": f"Error listando stock (use_full safe/enriched fallback): {e2}"},
                        status=400,
                    )

        # ============ Modo "completo" con fallback por fila (hay q=...) ============

        try:
            qs = self.get_queryset()
            page = self.paginate_queryset(qs)
            if page is not None:
                data = self._serialize_page_with_fallback(page, request=request)
                return self.get_paginated_response(data)
            data = self._serialize_page_with_fallback(qs, request=request)
            return Response(data)
        except drf_serializers.ValidationError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            # Si algo global falla, devolvemos todo en modo seguro
            try:
                qs = self._safe_base_qs(params)
                return self._safe_paginated_response(qs)
            except Exception as e2:
                return Response({"detail": f"Error listando stock (fallback): {e2}"}, status=400)


class MinLevelViewSet(viewsets.ModelViewSet):
    """
    Mínimos por (producto, bodega).
    """
    queryset = MinLevel.objects.select_related("warehouse", "product")
    serializer_class = MinLevelSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = InventoryPagination


# ---------- PERMISO LOCAL PARA EDITAR MOVIMIENTOS (admin o bodeguero) ----------
class _CanEditMovement(BasePermission):
    message = "No tiene permiso para editar movimientos."

    def has_permission(self, request: Request, view) -> bool:  # type: ignore[override]
        u = getattr(request, "user", None)
        if not u or not u.is_authenticated:
            return False
        # Superuser / staff / grupos ADMIN o BODEGUERO
        return bool(u.is_superuser or u.is_staff or _in_groups(u, ("ADMIN", "BODEGUERO")))


class MachineViewSet(viewsets.ModelViewSet):
    """
    CRUD de máquinas por cliente.

    Endpoints reales (por inclusión en urls.py del módulo):
      - GET  /api/inventory/maquinas/?client=<id>&page_size=1000
      - POST /api/inventory/maquinas/
    """

    serializer_class = MachineSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = InventoryPagination

    def get_queryset(self) -> QuerySet[Machine]:
        qs = (
            Machine.objects.select_related("client")
            .all()
            .order_by("client_id", "name", "brand", "model", "serial", "id")
        )

        client_id = (self.request.query_params.get("client") or "").strip()
        if client_id:
            try:
                qs = qs.filter(client_id=int(client_id))
            except (TypeError, ValueError):
                # Si el parámetro client no es entero, ignoramos el filtro silenciosamente.
                pass

        return qs


class MovementViewSet(viewsets.ModelViewSet):
    """
    Movimientos de inventario.

    - CREATE: crea movimiento y aplica impacto en stock (apply_movement).
    - LIST / RETRIEVE: lectura normal (excluye anulados en get_queryset).
    - UPDATE/PATCH:
        · Admin o Bodeguero.
        · Pensado para actualizar 'note' y 'authorization_reason'.
        · Si el serializer expone `items` y existe el servicio
          `update_movement_items_and_stock` en services.py, se delega en él
          para modificar ítems + recalcular stock por delta.
          (El flujo normal de UI es **solo meta**; para corregir cantidades
          se debe ANULAR el movimiento y crear uno nuevo).
    - DESTROY (DELETE): sólo Admin/Superuser.
        · Crea y aplica un movimiento inverso (reversión real de stock).
        · Marca el movimiento original con soft delete (voided_at/voided_by).
        · Devuelve ambos movimientos (`{ voided_movement, reverse_movement }`).
    """
    serializer_class = MovementSerializer
    filterset_class = MovementFilter
    pagination_class = InventoryPagination

    def get_permissions(self):
        """
        Regla de permisos:
        - list/retrieve/create: cualquier autenticado.
        - update/partial_update: Admin/Bodeguero/Superuser.
        - destroy: sólo Admin/Superuser.
        """
        if self.action in ("update", "partial_update"):
            return [IsAuthenticated(), _CanEditMovement()]
        if self.action == "destroy":
            return [IsAuthenticated(), IsAdminUser()]
        return [IsAuthenticated()]

    def get_queryset(self) -> QuerySet[Movement]:
        # Aseguramos excluir anulados (soft delete) del flujo normal
        return movements_queryset(self.request.query_params).filter(voided_at__isnull=True)

    # -------- LIST con fallback anti-500 --------
    def _safe_serialize_movement(self, mv: Movement, request: Request) -> Dict[str, Any]:
        """
        Intenta serializar un movimiento con MovementSerializer.
        Si falla, devuelve un payload mínimo estable compatible con el frontend.
        """
        try:
            return MovementSerializer(mv, context={"request": request}).data
        except Exception as e:
            logger.exception("Error serializando Movement %s: %s", getattr(mv, "pk", None), e)

            # Nombre de usuario "a mano"
            user_label = None
            try:
                u = getattr(mv, "user", None)
                if u:
                    full_name = ""
                    try:
                        full_name = (u.get_full_name() or "").strip()
                    except Exception:
                        full_name = ""
                    if full_name:
                        user_label = full_name
                    elif getattr(u, "username", None):
                        user_label = str(u.username)
                    elif getattr(u, "email", None):
                        user_label = str(u.email)
                    else:
                        user_label = f"Usuario #{getattr(u, 'pk', '')}"
            except Exception:
                user_label = None

            return {
                "id": mv.pk,
                "date": getattr(mv, "date", None),
                "type": getattr(mv, "type", None),
                "user": getattr(mv, "user_id", None),
                "user_name": user_label,
                "note": getattr(mv, "note", None),
                "needs_regularization": bool(getattr(mv, "needs_regularization", False)),
                # No arriesgamos serializar líneas si el serializer falló
                "lines": [],
            }

    def list(self, request: Request, *args, **kwargs):
        """
        Lista de movimientos con política anti-500:
        - NO usa filter_backends / MovementFilter (evitamos errores de filtros legacy).
        - Respeta ?ordering=-date,-id cuando es posible, sin romper si es inválido.
        - Serializa cada movimiento con MovementSerializer; si alguno falla,
          cae a un payload mínimo para ese movimiento.
        """
        params = request.query_params
        try:
            qs = self.get_queryset()

            # Aplicar ordering de query param si viene, pero sin reventar
            ordering_param = (params.get("ordering") or "").strip()
            if ordering_param:
                try:
                    fields = [f.strip() for f in ordering_param.split(",") if f.strip()]
                    if fields:
                        qs = qs.order_by(*fields)
                except Exception as e:
                    logger.warning("Ordering inválido en movimientos (%r): %s", ordering_param, e)

            page = self.paginate_queryset(qs)
            rows = page if page is not None else list(qs)

            data = [self._safe_serialize_movement(mv, request) for mv in rows]

            if page is not None:
                return self.get_paginated_response(data)
            return Response(data)

        except drf_serializers.ValidationError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.exception("Error listando movimientos: %s", e)
            return Response(
                {"detail": f"Error listando movimientos: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
    @transaction.atomic
    def create(self, request: Request, *args, **kwargs):
        """
        Crea movimiento + aplica impacto en stock.

        Anti-500:
        - Convierte errores de validación/dominio en 400 con mensaje legible.
        - Asegura rollback explícito en errores de negocio (no deja stock/movimientos a medias).
        - Si falla la representación del serializer, devuelve un payload mínimo estable en 201.
        """
        serializer = self.get_serializer(data=request.data, context={"request": request})

        def _err_to_text(detail) -> str:
            if isinstance(detail, dict):
                parts = []
                for k, v in detail.items():
                    t = _err_to_text(v)
                    parts.append(t if k in ("non_field_errors", "detail") else f"{k}: {t}")
                return " | ".join([p for p in parts if p])
            if isinstance(detail, (list, tuple)):
                return " | ".join(_err_to_text(x) for x in detail)
            return str(detail)

        # -------- Validación de datos de entrada --------
        try:
            serializer.is_valid(raise_exception=True)
        except drf_serializers.ValidationError as e:
            # Errores de validación del serializer -> 400 y rollback
            transaction.set_rollback(True)
            return Response({"detail": _err_to_text(e.detail)}, status=status.HTTP_400_BAD_REQUEST)

        # -------- Persistencia del movimiento (sin tocar stock aún) --------
        try:
            # Importante: el serializer NO aplica stock ni recibe kwargs inesperados
            movement: Movement = serializer.save()
        except IntegrityError as e:
            transaction.set_rollback(True)
            logger.exception("Error de integridad creando Movement: %s", e)
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            transaction.set_rollback(True)
            logger.exception("Error inesperado creando Movement: %s", e)
            return Response(
                {"detail": "Error creando el movimiento de inventario."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # -------- Aplicar impacto en stock --------
        try:
            apply_movement(
                movement,
                authorizer=getattr(request, "user", None),
                authorization_reason=request.data.get("authorization_reason", "") or "",
            )
        except DRFValidationError as e:
            # Errores de negocio de apply_movement -> 400 y rollback
            transaction.set_rollback(True)
            return Response({"detail": str(e.detail or e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:
            # Errores de dominio -> 400 y rollback
            transaction.set_rollback(True)
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            # Cualquier otro error interno en la aplicación del stock -> 400 y rollback
            transaction.set_rollback(True)
            logger.exception("Error aplicando movimiento a stock (apply_movement): %s", e)
            return Response(
                {"detail": "Error aplicando el movimiento a stock."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # -------- Rehidratar para representación robusta --------
        try:
            movement = (
                Movement.objects.select_related("authorized_by")
                .prefetch_related(
                    "lines",
                    "lines__product",
                    "lines__warehouse_from",
                    "lines__warehouse_to",
                )
                .get(pk=movement.pk)
            )
        except Exception as e:
            # Si aquí falla algo, igualmente el movimiento y el stock ya están aplicados
            logger.exception("Error rehidratando Movement %s: %s", movement.pk, e)

        headers = self.get_success_headers({"id": movement.pk})

        # Intentar representación completa, con fallback anti-500
        try:
            data = self.get_serializer(movement, context={"request": request}).data
        except Exception as rep_err:
            logger.exception("Error representando Movement %s: %s", movement.pk, rep_err)
            # Usamos el mismo fallback mínimo que en list/retrieve
            data = self._safe_serialize_movement(movement, request)

        return Response(data, status=status.HTTP_201_CREATED, headers=headers)

    @transaction.atomic
    def perform_update(self, serializer):
        """
        Actualiza un movimiento:

          - Siempre permite 'note' y 'authorization_reason'.
          - No permite editar un movimiento anulado.
          - Si el serializer trae `items` y existe el servicio
            `update_movement_items_and_stock` en `bodega.services`,
            se delega en él la edición real (reemplazo de líneas + recálculo
            de stock por delta).
          - El flujo normal de UI es **meta-only** (note / authorization_reason).
            Para corregir cantidades/productos se debe ANULAR y crear uno nuevo.
        """
        instance: Movement = self.get_object()

        if getattr(instance, "is_voided", False) or instance.voided_at is not None:
            raise DRFValidationError("No se puede editar un movimiento que ya fue anulado.")

        validated = getattr(serializer, "validated_data", {}) or {}

        # Guardar meta primero (nota/motivo); el serializer no toca líneas aquí.
        serializer.save()

        items = validated.get("items")
        if items is None:
            # Sólo meta (nota / autorización) — flujo UI principal
            return

        # Intentar usar servicio especializado (si está disponible) para edición + stock
        try:
            from . import services as inventory_services  # import local para evitar ciclos
            update_fn = getattr(inventory_services, "update_movement_items_and_stock", None)
        except Exception:
            update_fn = None

        if callable(update_fn):
            update_fn(
                movement=instance,
                items=items,
                user=getattr(self.request, "user", None),
                authorization_reason=validated.get("authorization_reason")
                or instance.authorization_reason
                or "",
            )
            return

        # Fallback legacy: reemplaza líneas manteniendo bodegas inferidas,
        # pero SIN recalcular stock (modo compatibilidad).
        # NOTA: Para cumplir normativa de kárdex, lo recomendable es
        # implementar `update_movement_items_and_stock` en services.py,
        # y evitar usar este fallback en operaciones reales.
        first = instance.lines.order_by("id").first()
        if not first:
            raise DRFValidationError("No hay líneas existentes para inferir bodegas en la edición.")

        mv_type = instance.type
        src_id = getattr(first, "warehouse_from_id", None)
        tgt_id = getattr(first, "warehouse_to_id", None)

        instance.lines.all().delete()
        new_lines: List[MovementLine] = []

        for it in items:
            product_id = int(str(it["product"]))
            qty = int(str(it["quantity"]))

            if mv_type == Movement.TYPE_IN:
                if not tgt_id:
                    raise DRFValidationError("No se pudo inferir la bodega destino del movimiento.")
                new_lines.append(
                    MovementLine(
                        movement=instance,
                        product_id=product_id,
                        warehouse_to_id=tgt_id,
                        quantity=qty,
                    )
                )
            elif mv_type == Movement.TYPE_OUT:
                if not src_id:
                    raise DRFValidationError("No se pudo inferir la bodega origen del movimiento.")
                new_lines.append(
                    MovementLine(
                        movement=instance,
                        product_id=product_id,
                        warehouse_from_id=src_id,
                        quantity=qty,
                    )
                )
            elif mv_type == Movement.TYPE_TRANSFER:
                if not (src_id and tgt_id):
                    raise DRFValidationError("No se pudieron inferir las bodegas de la transferencia.")
                new_lines.append(
                    MovementLine(
                        movement=instance,
                        product_id=product_id,
                        warehouse_from_id=src_id,
                        warehouse_to_id=tgt_id,
                        quantity=qty,
                    )
                )
            else:  # Ajuste
                # En ajuste intentamos conservar el patrón de la primera línea
                if src_id and not tgt_id:
                    new_lines.append(
                        MovementLine(
                            movement=instance,
                            product_id=product_id,
                            warehouse_from_id=src_id,
                            quantity=qty,
                        )
                    )
                elif tgt_id and not src_id:
                    new_lines.append(
                        MovementLine(
                            movement=instance,
                            product_id=product_id,
                            warehouse_to_id=tgt_id,
                            quantity=qty,
                        )
                    )
                else:
                    raise DRFValidationError("No se pudo inferir la bodega del ajuste.")

        MovementLine.objects.bulk_create(new_lines)
        # En este modo compatibilidad NO se recalcula stock aquí.
        # Cuando `update_movement_items_and_stock` esté disponible en services.py,
        # la rama anterior será la responsable de aplicar el delta de stock.

    @transaction.atomic
    def destroy(self, request: Request, *args, **kwargs):
        """
        ANULACIÓN de movimiento (DELETE lógico con reversión):

        - Crea y aplica el movimiento inverso mediante `revert_movement`.
        - Marca el movimiento original como anulado (voided_at/voided_by).
        - Actualiza el stock volviendo al valor previo (por efecto del inverso).
        - Devuelve ambos movimientos para que el FE pueda refrescar UI.

        Contract:
        DELETE /api/inventory/movements/:id/ -> 200
        {
          "voided_movement": {...},
          "reverse_movement": {...}
        }
        """
        instance = self.get_object()

        # Respuesta amigable si ya estaba anulado
        if getattr(instance, "is_voided", False) or instance.voided_at is not None:
            return Response({"detail": "El movimiento ya fue anulado previamente."}, status=400)

        try:
            # revert_movement debe:
            #   - generar un movimiento inverso,
            #   - aplicar el efecto en stock,
            #   - dejar el kárdex trazable.
            reverse_mv = revert_movement(instance, reverted_by=request.user)
        except TypeError:
            # Compatibilidad por si revert_movement no acepta keyword
            reverse_mv = revert_movement(instance, request.user)  # type: ignore[arg-type]
        except DRFValidationError as e:
            return Response({"detail": str(e.detail or e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.exception("Error revirtiendo movimiento %s: %s", instance.pk, e)
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Asegurar marcado explícito como anulado
        if getattr(instance, "voided_at", None) is None:
            instance.voided_at = timezone.now()
            instance.voided_by = request.user
            try:
                instance.save(update_fields=["voided_at", "voided_by"])
            except Exception as e:
                logger.exception("Error marcando voided Movement %s: %s", instance.pk, e)

        data = {
            "voided_movement": MovementSerializer(instance, context={"request": request}).data,
            "reverse_movement": MovementSerializer(reverse_mv, context={"request": request}).data,
        }
        return Response(data, status=status.HTTP_200_OK)

    # ---- Trazabilidad ----
    @action(detail=False, methods=["get"], url_path="trace/by-client")
    def trace_by_client(self, request: Request):
        client_id = request.query_params.get("client_id")
        if not client_id:
            return Response({"detail": "client_id es requerido"}, status=400)
        qs = self.get_queryset().filter(lines__client_id=client_id)
        ser = self.get_serializer(qs, many=True, context={"request": request})
        return Response(ser.data)

    @action(detail=False, methods=["get"], url_path="trace/by-machine")
    def trace_by_machine(self, request: Request):
        machine_id = request.query_params.get("machine_id")
        if not machine_id:
            return Response({"detail": "machine_id es requerido"}, status=400)
        qs = self.get_queryset().filter(lines__machine_id=machine_id)
        ser = self.get_serializer(qs, many=True, context={"request": request})
        return Response(ser.data)

    @action(detail=False, methods=["get"], url_path="trace/by-product")
    def trace_by_product(self, request: Request):
        product_id = request.query_params.get("product_id")
        if not product_id:
            return Response({"detail": "product_id es requerido"}, status=400)
        qs = self.get_queryset().filter(lines__product_id=product_id)
        ser = self.get_serializer(qs, many=True, context={"request": request})
        return Response(ser.data)

    @action(detail=False, methods=["get"], url_path="tech-report")
    def tech_report(self, request: Request):
        """
        Reporte de movimientos de técnicos (solo lectura).

        Cada fila corresponde a una línea de movimiento (MovementLine) que cumpla:
        - movement.type = OUT
        - warehouse_from.category = TECNICO

        Filtros por query params:
          - technician: ID de usuario técnico (movement.user_id)
          - technician_name: texto que matchea nombre/username del técnico
          - client: ID de cliente o texto en el nombre/razón social
          - machine: ID de máquina o texto en nombre/marca/modelo/serie
          - date_from, date_to: rango de fechas (sobre movement.date)
          - type: tipo de movimiento (por si en el futuro quieres incluir otros tipos)
        """
        user = request.user
        if not user or not user.is_authenticated:
            return Response(
                {"detail": "Autenticación requerida."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Solo Admin / Bodeguero / Staff / Superuser
        if not (user.is_superuser or user.is_staff or _in_groups(user, ("ADMIN", "BODEGUERO"))):
            return Response(
                {"detail": "No tienes permiso para ver el reporte de movimientos de técnicos."},
                status=status.HTTP_403_FORBIDDEN,
            )

        params = request.query_params

        tecnico_cat = getattr(Warehouse, "CATEGORY_TECNICO", "TECNICO")
        type_out = getattr(Movement, "TYPE_OUT", "OUT")

        # Base: líneas de movimientos OUT desde bodega técnica
        qs = (
            MovementLine.objects.select_related(
                "movement",
                "movement__user",
                "product",
                "client",
                "machine",
                "warehouse_from",
                "warehouse_to",
            )
            .filter(
                movement__type=type_out,
                warehouse_from__category=tecnico_cat,
            )
            .order_by("-movement__date", "-id")
        )

        # ---------------- Filtros ----------------

        # Rango de fechas (sobre movement.date)
        date_from = (params.get("date_from") or "").strip()
        date_to = (params.get("date_to") or "").strip()
        if date_from:
            qs = qs.filter(movement__date__date__gte=date_from)
        if date_to:
            qs = qs.filter(movement__date__date__lte=date_to)

        # Tipo de movimiento (por si quieres incluir ajustes, etc.)
        type_param = (params.get("type") or "").strip().upper()
        if type_param:
            qs = qs.filter(movement__type=type_param)

        # Técnico por ID
        tech_param = (params.get("technician") or "").strip()
        if tech_param and tech_param.isdigit():
            qs = qs.filter(movement__user_id=int(tech_param))

        # Técnico por nombre / username
        tech_name_param = (params.get("technician_name") or "").strip()
        if tech_name_param:
            qs = qs.filter(
                Q(movement__user__username__icontains=tech_name_param)
                | Q(movement__user__first_name__icontains=tech_name_param)
                | Q(movement__user__last_name__icontains=tech_name_param)
            )

        # Cliente: ID o texto
        client_param = (params.get("client") or "").strip()
        if client_param:
            if client_param.isdigit():
                qs = qs.filter(client_id=int(client_param))
            else:
                qs = qs.filter(
                    Q(client__name__icontains=client_param)
                    | Q(client__nombre__icontains=client_param)
                    | Q(client__razon_social__icontains=client_param)
                    | Q(client__razonSocial__icontains=client_param)
                )

        # Máquina: ID o texto
        machine_param = (params.get("machine") or "").strip()
        if machine_param:
            if machine_param.isdigit():
                qs = qs.filter(machine_id=int(machine_param))
            else:
                qs = qs.filter(
                    Q(machine__name__icontains=machine_param)
                    | Q(machine__brand__icontains=machine_param)
                    | Q(machine__model__icontains=machine_param)
                    | Q(machine__serial__icontains=machine_param)
                )

        # ---------------- Helpers para labels ----------------

        def _user_label(u):
            if not u:
                return ""
            try:
                full_name = (u.get_full_name() or "").strip()
            except Exception:
                full_name = ""
            if full_name:
                return full_name
            # Campos personalizados típicos
            for attr in ("nombres", "apellidos"):
                val = getattr(u, attr, "") or ""
                if val:
                    full_name = (full_name + " " + val).strip()
            if full_name:
                return full_name
            for attr in ("username", "email"):
                val = getattr(u, attr, "") or ""
                if val:
                    return str(val)
            return str(getattr(u, "pk", ""))

        def _client_label(c):
            if not c:
                return None
            for attr in ("name", "nombre", "razon_social", "razonSocial"):
                val = getattr(c, attr, None)
                if val:
                    return str(val)
            try:
                return str(c)
            except Exception:
                return None

        def _machine_label(m):
            if not m:
                return None
            # Si el modelo Machine tiene display_label (como en MachineSerializer), úsalo
            disp = getattr(m, "display_label", None)
            if callable(disp):
                try:
                    disp = disp()
                except Exception:
                    disp = None
            if disp:
                return str(disp)

            name = (getattr(m, "name", "") or "").strip()
            brand = (getattr(m, "brand", "") or "").strip()
            model = (getattr(m, "model", "") or "").strip()
            serial = (getattr(m, "serial", "") or "").strip()

            if name:
                base = name
            else:
                parts = [p for p in [brand, model] if p]
                base = " ".join(parts) if parts else f"Máquina #{getattr(m, 'pk', '')}"

            if serial:
                return f"{base} ({serial})"
            return base

        def _product_label(p):
            if not p:
                return None
            code = getattr(p, "codigo", None) or getattr(p, "code", None)
            model = getattr(p, "modelo", None) or getattr(p, "model", None)
            brand = (
                getattr(p, "nombre_equipo", None)
                or getattr(p, "marca", None)
                or getattr(p, "brand", None)
            )
            parts = [str(x) for x in [brand, model] if x]
            base = " ".join(parts) if parts else f"Producto #{getattr(p, 'pk', '')}"
            if code:
                return f"{base} ({code})"
            return base

        # ---------------- Construcción de filas ----------------

        page = self.paginate_queryset(qs)
        rows = page if page is not None else list(qs)

        data = []
        for line in rows:
            mv = line.movement
            data.append(
                {
                    "id": line.id,
                    "date": (
                        mv.date.date().isoformat()
                        if getattr(mv, "date", None)
                        else None
                    ),
                    "type": mv.type,
                    "technician_id": getattr(mv, "user_id", None),
                    "technician_name": _user_label(getattr(mv, "user", None)),
                    "product": line.product_id,
                    "product_label": _product_label(getattr(line, "product", None)),
                    "quantity": line.quantity,
                    "client": line.client_id,
                    "client_name": _client_label(getattr(line, "client", None)),
                    "machine": line.machine_id,
                    "machine_name": _machine_label(getattr(line, "machine", None)),
                    "purpose": getattr(mv, "purpose", None),
                    "work_order": getattr(mv, "work_order", None),
                }
            )

        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)


class SettingsViewSet(mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Ajustes del módulo (singleton).
    """
    serializer_class = InventorySettingsSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return InventorySettings.get()


class TechStockView(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    Vista de stock (solo lectura) para técnicos/bodeguero/admin.
    Igual que StockViewSet: modo seguro por defecto y "completo" con fallback por fila.
    """
    serializer_class = StockItemSerializer
    permission_classes = [IsAuthenticated, IsTechViewer]
    pagination_class = InventoryLargePagination
    filter_backends: list = []
    _default_order = ("warehouse__name", "id")

    # Reutilizamos helpers del StockViewSet
    def _safe_base_qs(self, params):
        return StockViewSet._safe_base_qs(self, params)

    def _safe_serialize_item(self, obj: StockItem) -> dict:
        return StockViewSet._safe_serialize_item(self, obj)

    def _serialize_page_with_fallback(self, rows: Iterable[StockItem], *, request: Request) -> List[dict]:
        return StockViewSet._serialize_page_with_fallback(self, rows, request=request)

    def _safe_paginated_response(self, qs: QuerySet[StockItem]) -> Response:
        return StockViewSet._safe_paginated_response(self, qs)

    def get_queryset(self) -> QuerySet[StockItem]:
        params = self.request.query_params
        qtxt = (params.get("q") or "").strip()
        use_full = (params.get("use_full") or "").strip().lower() in ("1", "true", "yes")
        if not qtxt and not use_full:
            return self._safe_base_qs(params)
        try:
            qs = stock_queryset(params).select_related("warehouse")
            if not params.get("ordering"):
                qs = qs.order_by(*self._default_order)
            return qs
        except Exception:
            return self._safe_base_qs(params)

    def list(self, request: Request, *args, **kwargs):
        params = request.query_params
        qtxt = (params.get("q") or "").strip()
        use_full = (params.get("use_full") or "").strip().lower() in ("1", "true", "yes")

        if not qtxt and not use_full:
            try:
                qs = self.get_queryset()
                return self._safe_paginated_response(qs)
            except Exception as e:
                return Response({"detail": f"Error listando stock técnico (safe): {e}"}, status=400)

        # Igual que StockViewSet: si use_full y no hay q, usar camino seguro + enriquecido
        if use_full and not qtxt:
            try:
                qs = self._safe_base_qs(params)
                page = self.paginate_queryset(qs)
                rows = page if page is not None else list(qs)

                base = [self._safe_serialize_item(o) for o in rows]
                try:
                    pid_list = [getattr(o, "product_id", None) for o in rows]
                except Exception:
                    pid_list = []
                embed_map = StockViewSet._embed_products_batch(self, pid_list)

                for item in base:
                    try:
                        pid = int(item.get("product"))
                        info = embed_map.get(pid)
                        if info:
                            item["product_info"] = info
                    except Exception:
                        continue

                if page is not None:
                    return self.paginator.get_paginated_response(base)  # type: ignore[attr-defined]
                return Response(base)
            except Exception:
                try:
                    return self._safe_paginated_response(self._safe_base_qs(params))
                except Exception as e2:
                    return Response(
                        {"detail": f"Error listando stock técnico (fallback): {e2}"},
                        status=400,
                    )

        try:
            qs = self.get_queryset()
            page = self.paginate_queryset(qs)
            if page is not None:
                data = self._serialize_page_with_fallback(page, request=request)
                return self.get_paginated_response(data)
            data = self._serialize_page_with_fallback(qs, request=request)
            return Response(data)
        except drf_serializers.ValidationError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            try:
                qs = self._safe_base_qs(params)
                return self._safe_paginated_response(qs)
            except Exception as e2:
                return Response(
                    {"detail": f"Error listando stock técnico (fallback): {e2}"},
                    status=400,
                )


class AlertsViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    Centro de alertas: listar y (opcional) marcar resueltas (PATCH resolved=true).
    """
    serializer_class = StockAlertSerializer
    permission_classes = [IsAuthenticated]
    filterset_class = StockAlertFilter
    pagination_class = InventoryPagination

    def get_queryset(self) -> QuerySet[StockAlert]:
        return alerts_queryset(self.request.query_params)


class NegativeStockView(mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    Reporte de saldos negativos (solo lectura).
    """
    serializer_class = StockItemSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = InventoryLargePagination

    def get_queryset(self) -> QuerySet[StockItem]:
        return negative_stock_queryset(self.request.query_params)


class ProductTraceView(viewsets.ReadOnlyModelViewSet):
    """
    /products/{id}/trace — devuelve detalle de producto:
      - info embebida del producto
      - stock por bodega
      - últimos movimientos
    """
    serializer_class = ProductEmbeddedSerializer
    permission_classes = [IsAuthenticated]
    queryset = StockItem.objects.none()  # dummy para DRF

    def retrieve(self, request: Request, pk=None):
        Product = _get_product_model()
        try:
            product = Product.objects.get(pk=pk)
        except Product.DoesNotExist:
            return Response({"detail": "Producto no encontrado"}, status=404)

        # Stock por bodega del producto
        stock = (
            StockItem.objects.select_related("warehouse")
            .filter(product_id=product.pk)
            .order_by("warehouse__name")
        )
        stock_ser = StockItemSerializer(
            stock,
            many=True,
            context={"request": request},
        ).data

        # Movimientos recientes del producto (máx 100)
        movs = (
            Movement.objects.prefetch_related(
                "lines",
                "lines__product",
                "lines__warehouse_from",
                "lines__warehouse_to",
            )
            .filter(lines__product_id=product.pk)
            .order_by("-date", "-id")[:100]
        )
        mov_ser = MovementSerializer(movs, many=True, context={"request": request}).data

        data = {
            "product_info": ProductEmbeddedSerializer(
                product,
                context={"request": request},
            ).data,
            "stock_by_warehouse": stock_ser,
            "movements": mov_ser,
        }
        return Response(data)

    @action(detail=True, methods=["get"], url_path="trace")
    def trace(self, request: Request, pk=None):
        # Reutiliza retrieve para /products/{id}/trace/
        return self.retrieve(request, pk=pk)


# =============================================================================
# Solicitudes de repuestos — FASE 5
# =============================================================================


class PartRequestViewSet(viewsets.ModelViewSet):
    """
    Solicitudes de repuestos de técnicos (FASE 5).

    - Técnicos (CanRequestParts / grupo técnico): pueden crear solicitudes y ver solo las suyas.
    - Bodeguero/Admin: ven todas las solicitudes y pueden aprobar/rechazar.

    @action approve:
      - Busca bodega PRINCIPAL.
      - Crea Movement(TYPE_TRANSFER) PRINCIPAL -> warehouse_destination (técnico).
      - Llama apply_movement para aplicar stock.
      - Marca la solicitud como FULFILLED y setea movement + reviewed_by/at.

    @action reject:
      - Cambia estado a REJECTED y marca reviewed_by/at.
    """
    serializer_class = PartRequestSerializer
    permission_classes = [IsAuthenticated, CanRequestParts]
    pagination_class = InventoryPagination

    def get_queryset(self) -> QuerySet[PartRequest]:
        user = self.request.user
        qs = (
            PartRequest.objects.select_related(
                "product",
                "warehouse_destination",
                "requested_by",
                "movement",
                "reviewed_by",
                "client",
                "machine",
            )
            .all()
            .order_by("-created_at", "-id")
        )

        if not user or not user.is_authenticated:
            return qs.none()

        # Rol: admin/bodeguero ven todas las solicitudes
        if not (user.is_superuser or user.is_staff or _in_groups(user, ("ADMIN", "BODEGUERO"))):
            # Técnicos (u otros con permiso) ven solo las suyas
            qs = qs.filter(requested_by=user)

        # Filtros adicionales: estado, técnico, rango de fechas
        params = self.request.query_params

        status_param = (params.get("status") or "").strip().upper()
        if status_param:
            qs = qs.filter(status=status_param)

        requested_by = (params.get("requested_by") or "").strip()
        if requested_by:
            try:
                qs = qs.filter(requested_by_id=int(requested_by))
            except (TypeError, ValueError):
                pass

        date_from = (params.get("date_from") or "").strip()
        date_to = (params.get("date_to") or "").strip()
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        return qs

    def perform_create(self, serializer: PartRequestSerializer):
        """
        La lógica de asignar requested_by se hace en el serializer,
        pero mantener esta firma nos permite extender en el futuro.
        """
        serializer.save()

    # ---------------------- Helpers de permisos internos ----------------------

    def _user_can_approve(self, user) -> bool:
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser or user.is_staff:
            return True
        return _in_groups(user, ("ADMIN", "BODEGUERO"))

    # ---------------------- Acciones approve / reject ----------------------

    @action(detail=True, methods=["post"], url_path="approve")
    @transaction.atomic
    def approve(self, request: Request, pk=None):
        """
        Aprueba y CUMPLE la solicitud en un solo paso:
        - Valida que esté PENDING y sin movimiento previo.
        - Busca bodega PRINCIPAL.
        - Crea Movement(TYPE_TRANSFER) PRINCIPAL -> warehouse_destination.
        - Aplica el movimiento a stock (apply_movement).
        - Marca PartRequest como FULFILLED + reviewed_by/at + movement.
        """
        user = request.user
        if not self._user_can_approve(user):
            return Response(
                {"detail": "No tienes permiso para aprobar solicitudes de repuestos."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            # Bloqueamos la fila para evitar condiciones de carrera
            req = (
                PartRequest.objects.select_for_update()
                .select_related("product", "warehouse_destination")
                .get(pk=pk)
            )
        except PartRequest.DoesNotExist:
            return Response({"detail": "Solicitud no encontrada."}, status=status.HTTP_404_NOT_FOUND)

        if req.status != PartRequest.STATUS_PENDING:
            return Response(
                {"detail": "Solo se pueden aprobar solicitudes en estado PENDING."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if req.movement_id:
            return Response(
                {"detail": "La solicitud ya tiene un movimiento asociado."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        dest = req.warehouse_destination
        if dest is None:
            return Response(
                {"detail": "La solicitud no tiene bodega destino."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Reforzar que la bodega destino sea técnica
        if str(getattr(dest, "category", "")).strip().upper() != Warehouse.CATEGORY_TECNICO:
            return Response(
                {"detail": "La bodega destino debe ser de categoría TECNICO."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Buscar bodega PRINCIPAL
        principal_cat = getattr(Warehouse, "CATEGORY_PRINCIPAL", "PRINCIPAL")
        principal_qs = Warehouse.objects.filter(category=principal_cat)
        if hasattr(Warehouse, "active"):
            principal_qs = principal_qs.filter(active=True)
        principal = principal_qs.order_by("id").first()

        if principal is None:
            return Response(
                {"detail": "No hay bodega PRINCIPAL configurada."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Crear movimiento TRANSFER
        mv_type = getattr(Movement, "TYPE_TRANSFER", "TRANSFER")
        movement = Movement.objects.create(
            date=timezone.now(),
            type=mv_type,
            user=user,
            note=f"Transferencia auto desde solicitud de repuesto #{req.pk}",
            authorization_reason=f"Aprobación de solicitud de repuesto #{req.pk}",
        )

        # Crear línea de movimiento (transferencia PRINCIPAL -> destino técnico)
        MovementLine.objects.create(
            movement=movement,
            product_id=req.product_id,
            warehouse_from=principal,
            warehouse_to=dest,
            quantity=req.quantity,
            client_id=req.client_id or None,
            machine_id=req.machine_id or None,
        )

        # Aplicar movimiento al stock
        try:
            apply_movement(
                movement,
                authorizer=user,
                authorization_reason=f"Aprobación de solicitud de repuesto #{req.pk}",
            )
        except DRFValidationError as e:
            return Response({"detail": str(e.detail or e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Actualizar solicitud: cumplida
        req.status = PartRequest.STATUS_FULFILLED
        req.movement = movement
        req.reviewed_by = user
        req.reviewed_at = timezone.now()
        req.save(update_fields=["status", "movement", "reviewed_by", "reviewed_at"])

        return Response(
            PartRequestSerializer(req, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="reject")
    @transaction.atomic
    def reject(self, request: Request, pk=None):
        """
        Rechaza la solicitud sin movimiento:
        - Solo desde estado PENDING.
        - Marca status=REJECTED + reviewed_by/at.
        """
        user = request.user
        if not self._user_can_approve(user):
            return Response(
                {"detail": "No tienes permiso para rechazar solicitudes de repuestos."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            req = PartRequest.objects.select_for_update().get(pk=pk)
        except PartRequest.DoesNotExist:
            return Response({"detail": "Solicitud no encontrada."}, status=status.HTTP_404_NOT_FOUND)

        if req.status != PartRequest.STATUS_PENDING:
            return Response(
                {"detail": "Solo se pueden rechazar solicitudes en estado PENDING."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        req.status = PartRequest.STATUS_REJECTED
        req.reviewed_by = user
        req.reviewed_at = timezone.now()
        req.save(update_fields=["status", "reviewed_by", "reviewed_at"])

        return Response(
            PartRequestSerializer(req, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


# =============================================================================
# KPI / Pulse
# =============================================================================


class InventoryPulse(APIView):
    """
    Endpoint ligero para healthcheck/monitoring del módulo de inventario.
    Público por diseño (AllowAny) para ser consumido por probes externos.
    """
    permission_classes = [AllowAny]

    def get(self, request: Request):
        try:
            negatives = StockItem.objects.filter(quantity__lt=0).count()
            open_alerts = StockAlert.objects.filter(resolved=False).count()
            pending_requests = PartRequest.objects.filter(
                status=PartRequest.STATUS_PENDING,
            ).count()

            return Response(
                {
                    "ok": True,
                    "module": "inventory",
                    "timestamp": timezone.now().isoformat(),
                    "negatives": negatives,
                    "open_alerts": open_alerts,
                    "pending_requests": pending_requests,
                },
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            logger.exception("InventoryPulse error: %s", e)
            return Response(
                {"ok": False, "module": "inventory", "error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# =============================================================================
# Compras de técnicos — FASE 7
# =============================================================================

class TechPurchaseViewSet(viewsets.ModelViewSet):
    """
    Compras realizadas por técnicos con su propio dinero (TechPurchase).

    Reglas de acceso:
    - Técnicos (cualquier usuario autenticado NO admin/bodeguero):
        · Pueden crear compras (status SUBMITTED).
        · Pueden ver solo sus propias compras.
    - Admin / Bodeguero / Staff / Superuser:
        · Ven todas las compras.
        · Pueden aprobar (approve), rechazar (reject) y marcar como pagadas (mark-paid).

    Flujo de estados:
    - SUBMITTED -> APPROVED -> PAID
    - SUBMITTED -> REJECTED
    """

    serializer_class = TechPurchaseSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = InventoryPagination

    def get_queryset(self) -> QuerySet[TechPurchase]:
        user = self.request.user
        qs = (
            TechPurchase.objects.select_related(
                "technician",
                "client",
                "machine",
                "reviewed_by",
            )
            .all()
            .order_by("-purchase_date", "-id")
        )

        if not user or not user.is_authenticated:
            return qs.none()

        # Admin/Bodeguero/Staff/Superuser ven todo
        if not (user.is_superuser or user.is_staff or _in_groups(user, ("ADMIN", "BODEGUERO"))):
            # Técnicos ven solo sus propias compras
            qs = qs.filter(technician=user)

        params = self.request.query_params

        # --- Filtros básicos por query params ---

        status_param = (params.get("status") or "").strip().upper()
        if status_param:
            qs = qs.filter(status=status_param)

        technician_param = (params.get("technician") or "").strip()
        if technician_param:
            try:
                qs = qs.filter(technician_id=int(technician_param))
            except (TypeError, ValueError):
                # si no es número, se ignora silenciosamente
                pass

        date_from = (params.get("date_from") or "").strip()
        date_to = (params.get("date_to") or "").strip()
        if date_from:
            qs = qs.filter(purchase_date__gte=date_from)
        if date_to:
            qs = qs.filter(purchase_date__lte=date_to)

        # --- Filtros directos: client y machine (compatibles con el frontend) ---

        # client puede ser ID (numérico) o texto a buscar en el nombre del cliente
        client_param = (params.get("client") or "").strip()
        if client_param:
            if client_param.isdigit():
                # Filtrado directo por ID
                try:
                    qs = qs.filter(client_id=int(client_param))
                except (TypeError, ValueError):
                    # Si por alguna razón no es convertible, lo ignoramos
                    pass
            else:
                # Texto: intentamos varios campos típicos de nombre de cliente
                client_text = client_param
                candidate_fields = ["name", "nombre", "razon_social", "razonSocial"]
                applied = False

                for field in candidate_fields:
                    lookup = {f"client__{field}__icontains": client_text}
                    try:
                        qs = qs.filter(**lookup)
                        applied = True
                        break
                    except Exception:
                        # Si el campo no existe o da error, probamos el siguiente
                        continue
                # Si ninguno se pudo aplicar, simplemente no filtramos por cliente
                # (pero lo importante es que NO rompa con 500).

        # machine puede ser ID (numérico) o texto que matchea varios campos de la máquina
        machine_param = (params.get("machine") or "").strip()
        if machine_param:
            if machine_param.isdigit():
                try:
                    qs = qs.filter(machine_id=int(machine_param))
                except (TypeError, ValueError):
                    pass
            else:
                # Texto: filtramos de forma tolerante
                try:
                    qs = qs.filter(
                        Q(machine__name__icontains=machine_param)
                        | Q(machine__brand__icontains=machine_param)
                        | Q(machine__model__icontains=machine_param)
                        | Q(machine__serial__icontains=machine_param)
                    )
                except Exception:
                    # Si algún campo no existe, simplemente no aplicamos este filtro
                    pass

        # 🔍 Búsqueda textual libre (q=...) — segura para evitar 500
        qtxt = (params.get("q") or "").strip()
        if qtxt:
            try:
                q_filters = Q(product_description__icontains=qtxt) | Q(notes__icontains=qtxt)

                # Cliente: probamos varios campos de nombre de cliente, pero sin reventar
                client_name_fields = ["name", "nombre", "razon_social", "razonSocial"]
                client_q_applied = False
                for field in client_name_fields:
                    try:
                        lookup = {f"client__{field}__icontains": qtxt}
                        q_filters |= Q(**lookup)
                        client_q_applied = True
                        break
                    except Exception:
                        continue

                # Máquina: tolerante a modelos sin alguna columna
                try:
                    machine_text_q = Q(machine__isnull=False) & (
                        Q(machine__name__icontains=qtxt)
                        | Q(machine__brand__icontains=qtxt)
                        | Q(machine__model__icontains=qtxt)
                        | Q(machine__serial__icontains=qtxt)
                    )
                    q_filters |= machine_text_q
                except Exception:
                    pass

                qs = qs.filter(q_filters)
            except Exception:
                # si por algún motivo el armado del filtro falla, no aplicamos q
                pass

        return qs

    def perform_create(self, serializer: TechPurchaseSerializer):
        """
        El serializer se encarga de tomar technician = request.user.
        """
        serializer.save()

    # ---------------------- Helpers de permisos internos ----------------------

    def _user_can_review(self, user) -> bool:
        """
        Determina quién puede aprobar / rechazar / marcar como pagado:
        - Superuser / staff
        - Grupos ADMIN / BODEGUERO
        """
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser or user.is_staff:
            return True
        return _in_groups(user, ("ADMIN", "BODEGUERO"))

    # ---------------------- Acciones approve / mark-paid / reject ----------------------

    @action(detail=True, methods=["post"], url_path="approve")
    @transaction.atomic
    def approve(self, request: Request, pk=None):
        """
        Aprueba una compra de técnico:

        - Solo para usuarios con permiso de revisión (_user_can_review).
        - Solo si el estado actual es SUBMITTED.
        - Cambia a status=APPROVED, setea reviewed_by / reviewed_at.
        """
        user = request.user
        if not self._user_can_review(user):
            return Response(
                {"detail": "No tienes permiso para aprobar compras de técnicos."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            purchase = TechPurchase.objects.select_for_update().get(pk=pk)
        except TechPurchase.DoesNotExist:
            return Response({"detail": "Compra no encontrada."}, status=status.HTTP_404_NOT_FOUND)

        if purchase.status != getattr(TechPurchase, "STATUS_SUBMITTED", "SUBMITTED"):
            return Response(
                {"detail": "Solo se pueden aprobar compras en estado SUBMITTED."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        purchase.status = getattr(TechPurchase, "STATUS_APPROVED", "APPROVED")
        purchase.reviewed_by = user
        purchase.reviewed_at = timezone.now()
        purchase.save(update_fields=["status", "reviewed_by", "reviewed_at"])

        return Response(
            TechPurchaseSerializer(purchase, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="mark-paid")
    @transaction.atomic
    def mark_paid(self, request: Request, pk=None):
        """
        Marca una compra de técnico como pagada:

        - Solo para usuarios con permiso de revisión (_user_can_review).
        - Solo si el estado actual es APPROVED.
        - Cambia a status=PAID y setea paid_date (hoy).
        """
        user = request.user
        if not self._user_can_review(user):
            return Response(
                {"detail": "No tienes permiso para marcar compras como pagadas."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            purchase = TechPurchase.objects.select_for_update().get(pk=pk)
        except TechPurchase.DoesNotExist:
            return Response({"detail": "Compra no encontrada."}, status=status.HTTP_404_NOT_FOUND)

        approved_status = getattr(TechPurchase, "STATUS_APPROVED", "APPROVED")
        paid_status = getattr(TechPurchase, "STATUS_PAID", "PAID")

        if purchase.status != approved_status:
            return Response(
                {"detail": f"Solo se pueden marcar como pagadas compras en estado {approved_status}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        purchase.status = paid_status
        purchase.paid_date = timezone.localdate()
        purchase.save(update_fields=["status", "paid_date"])

        return Response(
            TechPurchaseSerializer(purchase, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="reject")
    @transaction.atomic
    def reject(self, request: Request, pk=None):
        """
        Rechaza una compra de técnico:

        - Solo para usuarios con permiso de revisión (_user_can_review).
        - Solo si el estado actual es SUBMITTED.
        - Cambia a status=REJECTED y setea reviewed_by / reviewed_at.
        """
        user = request.user
        if not self._user_can_review(user):
            return Response(
                {"detail": "No tienes permiso para rechazar compras de técnicos."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            purchase = TechPurchase.objects.select_for_update().get(pk=pk)
        except TechPurchase.DoesNotExist:
            return Response({"detail": "Compra no encontrada."}, status=status.HTTP_404_NOT_FOUND)

        submitted_status = getattr(TechPurchase, "STATUS_SUBMITTED", "SUBMITTED")
        rejected_status = getattr(TechPurchase, "STATUS_REJECTED", "REJECTED")

        if purchase.status != submitted_status:
            return Response(
                {"detail": f"Solo se pueden rechazar compras en estado {submitted_status}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        purchase.status = rejected_status
        purchase.reviewed_by = user
        purchase.reviewed_at = timezone.now()
        purchase.paid_date = None
        purchase.save(update_fields=["status", "reviewed_by", "reviewed_at", "paid_date"])

        return Response(
            TechPurchaseSerializer(purchase, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )
