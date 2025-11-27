// /src/modules/billing/pages/SecuencialConfig.tsx
// -*- coding: utf-8 -*-
import * as React from "react";

export default function SecuencialConfig(): React.ReactElement {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* Título + contexto corto */}
      <header className="mb-4">
        <h1 className="text-xl md:text-2xl font-semibold text-slate-800">
          Secuenciales de comprobantes
        </h1>
        <p className="mt-1 text-xs md:text-sm text-slate-600">
          Aquí se administrarán los rangos y secuenciales de facturas y otros
          comprobantes electrónicos (facturas, notas de crédito, etc.).
        </p>
      </header>

      <div className="space-y-4">
        {/* Card principal de estado */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <h2 className="text-sm md:text-base font-semibold text-slate-800">
            Vista en construcción
          </h2>
          <p className="mt-1 text-xs md:text-sm text-slate-600">
            Este módulo todavía no está disponible en la interfaz. Se conectará
            con la configuración de facturación (empresas y puntos de emisión)
            para controlar los números de comprobantes que se envían al SRI.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs md:text-sm">
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Próximamente
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-700">
                <li>Definir rangos por empresa y punto de emisión.</li>
                <li>Configurar número inicial y máximo por tipo de documento.</li>
                <li>Visualizar estado actual del secuencial en uso.</li>
              </ul>
            </div>

            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Seguridad
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-700">
                <li>Edición sólo para usuarios administradores.</li>
                <li>Historial de cambios (quién cambió qué y cuándo).</li>
                <li>Validaciones para evitar duplicados o saltos de rango.</li>
              </ul>
            </div>

            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Integración
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-700">
                <li>Sincronización con facturación electrónica SRI.</li>
                <li>Uso automático desde el asistente de facturas.</li>
                <li>Alertas cuando se acerque el fin del rango.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Card de layout de ejemplo (para futuro formulario) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-xs md:text-sm text-slate-700">
          <h3 className="text-sm md:text-base font-semibold text-slate-800">
            Adelanto del diseño del formulario
          </h3>
          <p className="mt-1">
            Cuando el backend esté listo, aquí verás una grilla tipo ficha por
            cada combinación de <b>Empresa</b> + <b>Establecimiento</b> +{" "}
            <b>Punto de emisión</b> + <b>Tipo de documento</b>, con campos como:
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ul className="list-disc space-y-1 pl-4">
              <li>Tipo de comprobante (Factura, N/C, etc.)</li>
              <li>Número actual / siguiente</li>
              <li>Número inicial y máximo del rango autorizado</li>
            </ul>
            <ul className="list-disc space-y-1 pl-4">
              <li>Estado del rango (activo / agotado / pendiente)</li>
              <li>Fecha de inicio y fin de autorización</li>
              <li>Observaciones internas / notas de auditoría</li>
            </ul>
          </div>

          <p className="mt-3 text-[11px] md:text-xs text-slate-500">
            Por ahora no hay acciones disponibles en esta pantalla. Emitir
            facturas desde el asistente usará la configuración por defecto
            definida en backend.
          </p>
        </section>
      </div>
    </div>
  );
}
