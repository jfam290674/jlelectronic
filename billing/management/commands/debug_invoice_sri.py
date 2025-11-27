# billing/management/commands/debug_invoice_sri.py
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any, Dict, Callable, Optional, Tuple
import importlib
import pkgutil

from django.core.management.base import BaseCommand, CommandError

from billing.models import Invoice


EmitirFn = Callable[[Invoice], Dict[str, Any]]
AutorizarFn = Callable[[Invoice], Dict[str, Any]]
ReenviarFn = Callable[[Invoice], Dict[str, Any]]


def _find_sri_functions() -> Tuple[Optional[EmitirFn], Optional[AutorizarFn], Optional[ReenviarFn]]:
  """
  Busca emitir_factura_sync / autorizar_factura_sync / reenviar_factura_sri_sync
  en cualquier submódulo de billing.services.* para no depender de una ruta fija.
  """
  try:
    from billing import services as services_pkg
  except Exception:
    return None, None, None

  emitir: Optional[EmitirFn] = None
  autorizar: Optional[AutorizarFn] = None
  reenviar: Optional[ReenviarFn] = None

  for _, modname, _ in pkgutil.walk_packages(
    services_pkg.__path__, services_pkg.__name__ + "."
  ):
    try:
      module = importlib.import_module(modname)
    except Exception:
      continue

    if emitir is None and hasattr(module, "emitir_factura_sync"):
      emitir = getattr(module, "emitir_factura_sync")  # type: ignore[assignment]

    if autorizar is None and hasattr(module, "autorizar_factura_sync"):
      autorizar = getattr(module, "autorizar_factura_sync")  # type: ignore[assignment]

    if reenviar is None and hasattr(module, "reenviar_factura_sri_sync"):
      reenviar = getattr(module, "reenviar_factura_sri_sync")  # type: ignore[assignment]

    # Si ya tenemos las principales, podemos cortar
    if emitir is not None and autorizar is not None and reenviar is not None:
      break

  return emitir, autorizar, reenviar


class Command(BaseCommand):
  help = (
    "Debug del flujo SRI para una factura específica.\n"
    "Muestra detalle de emisión y autorización tal como se ejecuta en los endpoints."
  )

  def add_arguments(self, parser) -> None:
    parser.add_argument(
      "invoice_id",
      type=int,
      help="ID de la factura a probar (billing.Invoice.id)",
    )
    parser.add_argument(
      "--mode",
      choices=["emision", "autorizacion", "reenviar", "full"],
      default="full",
      help="Qué parte del flujo ejecutar (por defecto: full).",
    )

  def handle(self, *args: Any, **options: Any) -> None:
    invoice_id: int = options["invoice_id"]
    mode: str = options["mode"]

    # Buscamos dinámicamente las funciones SRI
    emitir_factura_sync, autorizar_factura_sync, reenviar_factura_sri_sync = _find_sri_functions()

    if emitir_factura_sync is None or autorizar_factura_sync is None:
      self.stderr.write(self.style.ERROR(
        "No se encontraron las funciones emitir_factura_sync / autorizar_factura_sync\n"
        "en ningún submódulo de billing.services.*\n\n"
        "Verifica en qué archivo están definidas y revisa sus nombres.\n"
        "Una vez que las ubiques, puedes:\n"
        "  - Mantener este autodiscovery, o\n"
        "  - Cambiar este comando para importarlas directamente.\n"
      ))
      raise SystemExit(1)

    try:
      invoice = Invoice.objects.get(pk=invoice_id)
    except Invoice.DoesNotExist:
      raise CommandError(f"No existe Invoice con id={invoice_id}")

    self.stdout.write(
      self.style.MIGRATE_HEADING(
        f"▶ Debug SRI para factura {invoice.id} – "
        f"{getattr(invoice, 'secuencial_display', '')} "
        f"(estado={invoice.estado})"
      )
    )

    # ---------- Emisión ----------
    if mode in ("emision", "full", "reenviar"):
      self.stdout.write(self.style.HTTP_INFO("\n[1] Emisión (Recepción SRI)\n"))

      try:
        emision_result = emitir_factura_sync(invoice)  # type: ignore[call-arg]
        self._print_result("Emisión", emision_result)
      except Exception as e:  # pragma: no cover
        self.stderr.write(self.style.ERROR("ERROR en emitir_factura_sync:"))
        self.stderr.write(f"  Tipo: {type(e).__name__}")
        self.stderr.write(f"  Mensaje: {str(e)}")
        raise

    # ---------- Autorización ----------
    if mode in ("autorizacion", "full"):
      self.stdout.write(
        self.style.HTTP_INFO("\n[2] Autorización (Autorización SRI)\n")
      )
      try:
        autorizacion_result = autorizar_factura_sync(invoice)  # type: ignore[call-arg]
        self._print_result("Autorización", autorizacion_result)
      except Exception as e:  # pragma: no cover
        self.stderr.write(self.style.ERROR("ERROR en autorizar_factura_sync:"))
        self.stderr.write(f"  Tipo: {type(e).__name__}")
        self.stderr.write(f"  Mensaje: {str(e)}")
        raise

    # ---------- Reenviar (emisión + autorización) ----------
    if mode == "reenviar":
      if reenviar_factura_sri_sync is None:
        self.stderr.write(self.style.WARNING(
          "No se encontró reenviar_factura_sri_sync en los módulos SRI. "
          "Se ejecutaron sólo las partes de emisión/autorización individuales."
        ))
      else:
        self.stdout.write(
          self.style.HTTP_INFO(
            "\n[3] Reenviar (emisión + autorización en un solo flujo)\n"
          )
        )
        try:
          wf_result = reenviar_factura_sri_sync(invoice)  # type: ignore[call-arg]
          self._print_result("Reenviar (workflow completo)", wf_result)
        except Exception as e:  # pragma: no cover
          self.stderr.write(
            self.style.ERROR("ERROR en reenviar_factura_sri_sync:")
          )
          self.stderr.write(f"  Tipo: {type(e).__name__}")
          self.stderr.write(f"  Mensaje: {str(e)}")
          raise

    self.stdout.write(
      self.style.SUCCESS(
        f"\n✔ Debug SRI finalizado. Estado actual de la factura: {invoice.estado}"
      )
    )

  # ------------------------------------------------------------------
  # Helpers
  # ------------------------------------------------------------------
  def _print_result(self, title: str, result: Dict[str, Any] | Any) -> None:
    """
    Normaliza la impresión del resultado, asumiendo que el servicio
    devuelve un dict con claves como: ok, detail, mensajes, _workflow, etc.
    """
    self.stdout.write(self.style.NOTICE(f"[{title}] Resultado bruto:\n"))

    if not isinstance(result, dict):
      self.stdout.write(f"  (no-dict) {repr(result)}\n")
      return

    ok = result.get("ok")
    detail = result.get("detail") or result.get("mensaje") or ""
    mensajes = result.get("mensajes") or result.get("mensajes_sri")

    self.stdout.write(f"  ok: {ok!r}\n")
    if detail:
      self.stdout.write(f"  detail: {detail}\n")

    if mensajes:
      self.stdout.write("  mensajes / mensajes_sri:\n")
      self.stdout.write(f"    {repr(mensajes)}\n")

    wf = result.get("_workflow")
    if wf:
      self.stdout.write("  _workflow:\n")
      self.stdout.write(f"    {repr(wf)}\n")
