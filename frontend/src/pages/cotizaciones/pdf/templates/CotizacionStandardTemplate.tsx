//  cotizacion-standard-template.tsx
import type React from "react";
import type { ShellRenderCtx } from "../CotizacionViewerShell";
import type { Item } from "../types";

/** Cache-buster seguro para imágenes (evita miniaturas “pegadas” por cache) */
function withCacheBuster(url: string, cb: string) {
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("_cb", cb);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_cb=${encodeURIComponent(cb)}`;
  }
}

const IMG_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
      <rect width="100%" height="100%" fill="#f1f5f9"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="Arial" font-size="14">
        Sin imagen
      </text>
    </svg>`
  );

export type CotizacionCompanyBranding = {
  NAME: string;
  L1: string;
  L2: string;
  L3: string;
  L4: string;
  LOGO_WEB_PRIMARY: string;
  LOGO_WEB_FALLBACK: string;
};

export type CotizacionBankInfo = {
  NAME: string;
  COMPANY_NAME: string;
  ACCOUNT_TYPE: string;
  ACCOUNT_NUMBER: string;
  RUC: string;
  EMAIL: string;
};

export type CotizacionStandardTemplateProps = {
  ctx: ShellRenderCtx;

  /** Por defecto true. Miniaturas solo en Web. */
  showThumbnails?: boolean;

  /** Permite override (útil para Equipos u otras marcas/submarcas si aplica). */
  company?: Partial<CotizacionCompanyBranding>;
  bank?: Partial<CotizacionBankInfo>;

  /** Permite inyectar bloques antes o después del body estándar (caso Equipos). */
  topBodySlot?: React.ReactNode;
  bottomBodySlot?: React.ReactNode;
};

/**
 * Template estándar (vista WEB).
 * - Mantiene header/footer del diseño aprobado.
 * - Miniaturas en tabla SOLO Web (no afecta PDF backend).
 * - Reutilizable por Cotización estándar y Cotización de Equipos.
 */
export default function CotizacionStandardTemplate(props: CotizacionStandardTemplateProps) {
  const { ctx, showThumbnails = true, topBodySlot, bottomBodySlot } = props;
  const { data, cliente, clienteDisplay, brandBlue, brandOrange, money } = ctx;

  // Padding editorial del cuerpo (mantiene respiración sin afectar full-bleed del header/footer)
  const BODY_PAD_X_PX = 28; // ~ 10mm visual
  const BODY_PAD_Y_PX = 22;

  // Cache-buster estable por “versión” del documento (evita que el navegador recicle imágenes viejas)
  const itemImgCb = `${data?.id || ""}|${(data as any)?.updated_at || ""}`;

  // Branding (solo visor HTML) - valores por defecto (pueden override)
  const COMPANY: CotizacionCompanyBranding = {
    NAME: "JL ELECTRONIC S.A.S.",
    L1: "Vía el Arenal sector Nulti",
    L2: "Teléf.: 0983380230 / 0999242456",
    L3: "Email: info@jlelectronic.com",
    L4: "Cuenca - Ecuador",
    // Nota: mantenemos las URLs actuales del wrapper para consistencia.
    LOGO_WEB_PRIMARY: "https://jlelectronic-app.nexosdelecuador.com/static/images/logolargo.png?v=pdf",
    LOGO_WEB_FALLBACK: "https://jlelectronic.nexosdelecuador.com/static/images/logolargo.png?v=pdf2",
    ...(props.company || {}),
  };

  // Datos bancarios (visor HTML) - valores por defecto (pueden override)
  const BANK: CotizacionBankInfo = {
    NAME: "Banco de Guayaquil",
    COMPANY_NAME: "JL ELECTRONIC S.A.S.",
    ACCOUNT_TYPE: "Cuenta corriente",
    ACCOUNT_NUMBER: "0022484249",
    RUC: "0195099898001",
    EMAIL: "contabilidad@jlelectronic.com",
    ...(props.bank || {}),
  };

  const items: Item[] = Array.isArray((data as any)?.items) ? ((data as any).items as Item[]) : [];

  return (
    <>
      {/* Print CSS (si se requiere imprimir la vista web) */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable, #printable * { visibility: visible; }
          #printable { position: absolute; left: 0; top: 0; width: 100%; margin: 0 !important; padding: 0 !important; }
        }
      `}</style>

      <div className="w-full bg-white text-black" style={{ margin: 0, padding: 0 }}>
        {/* ===================== HEADER FULL-BLEED ===================== */}
        <div
          className="w-full"
          style={{
            background: "linear-gradient(135deg, rgba(10,61,145,0.98) 0%, rgba(27,109,216,0.98) 100%)",
            color: "white",
          }}
        >
          <div
            className="flex flex-row items-center justify-between"
            style={{
              paddingLeft: BODY_PAD_X_PX,
              paddingRight: BODY_PAD_X_PX,
              paddingTop: 16,
              paddingBottom: 16,
            }}
          >
            <div className="flex items-center gap-3">
              <img
                src={COMPANY.LOGO_WEB_PRIMARY}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  img.src = COMPANY.LOGO_WEB_FALLBACK;
                }}
                alt="Logo"
                className="w-auto object-contain"
                style={{ height: 72, imageRendering: "crisp-edges" as any }}
              />
              <div className="leading-tight">
                <div className="font-extrabold text-xl tracking-wide">{COMPANY.NAME}</div>
                <div className="text-sm opacity-95">{COMPANY.L1}</div>
                <div className="text-sm opacity-95">{COMPANY.L2}</div>
                <div className="text-sm opacity-95">{COMPANY.L3}</div>
                <div className="text-sm opacity-95">{COMPANY.L4}</div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[11px] uppercase opacity-90">Número de cotización</div>
              <div className="text-3xl font-extrabold tracking-wide">{(data as any)?.folio || `#${(data as any)?.id}`}</div>
              <div className="text-[12px] mt-1 opacity-90">Fecha: {new Date().toLocaleDateString()}</div>
            </div>
          </div>
        </div>

        <div className="w-full" style={{ height: 4, background: brandOrange }} />

        {/* ===================== BODY ===================== */}
        <div
          style={{
            paddingLeft: BODY_PAD_X_PX,
            paddingRight: BODY_PAD_X_PX,
            paddingTop: BODY_PAD_Y_PX,
            paddingBottom: 14,
          }}
        >
          {topBodySlot ? <div className="mb-4">{topBodySlot}</div> : null}

          {/* Datos del cliente y asesor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border p-3" style={{ borderColor: `${brandBlue}22` }}>
              <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                Datos del cliente
              </div>
              <div className="mt-1 text-sm">
                <div className="font-semibold">
                  {(cliente as any)?.nombre || (cliente as any)?.razon_social || clienteDisplay || "—"}
                </div>
                {(cliente as any)?.identificador ? (
                  <div className="mt-0.5">Identificador: {(cliente as any).identificador}</div>
                ) : null}
                {((cliente as any)?.email || (cliente as any)?.telefono || (cliente as any)?.celular) && (
                  <div className="mt-0.5">
                    {[(cliente as any)?.email, (cliente as any)?.telefono || (cliente as any)?.celular]
                      .filter(Boolean)
                      .join(" • ")}
                  </div>
                )}
                {((cliente as any)?.ciudad || (cliente as any)?.direccion) && (
                  <div className="mt-0.5">
                    {[(cliente as any)?.ciudad, (cliente as any)?.direccion].filter(Boolean).join(" • ")}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border p-3" style={{ borderColor: `${brandBlue}22` }}>
              <div className="text-xs uppercase tracking-wide" style={{ color: brandBlue }}>
                Asesor comercial
              </div>
              <div className="mt-1 text-sm">
                <div className="font-semibold">{(data as any)?.owner_display || "—"}</div>
                <div className="mt-0.5">Descuento aplicado: {Number((data as any)?.descuento_cliente_percent || 0)}%</div>
                <div className="mt-0.5">IVA: {Number((data as any)?.iva_percent || 0)}%</div>
              </div>
            </div>
          </div>

          {/* Detalle de ítems */}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left px-2 py-2 text-white" style={{ background: brandBlue }}>
                    Ítem
                  </th>
                  <th className="text-left px-2 py-2 text-white" style={{ background: brandBlue }}>
                    Descripción
                  </th>
                  <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                    Cant.
                  </th>
                  <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                    P. Unit.
                  </th>
                  <th className="text-right px-2 py-2 text-white" style={{ background: brandBlue }}>
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {items.map((it, i) => {
                  const raw = String((it as any)?.producto_imagen_url || "").trim();
                  const imgSrc = raw ? withCacheBuster(raw, itemImgCb) : "";
                  const qty = Number((it as any)?.cantidad || 0);
                  const unit = Number((it as any)?.precio_unitario || 0);

                  return (
                    <tr key={i} className="border-b" style={{ borderColor: `${brandBlue}22` }}>
                      <td className="px-2 py-3 align-top">
                        {/* Miniaturas (solo Web, controladas) */}
                        {showThumbnails ? (
                          imgSrc ? (
                            <img
                              src={imgSrc}
                              crossOrigin="anonymous"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                img.onerror = null;
                                img.src = IMG_PLACEHOLDER;
                              }}
                              className="w-24 h-16 object-cover rounded border"
                              style={{ borderColor: `${brandBlue}33` }}
                              alt=""
                            />
                          ) : (
                            <img
                              src={IMG_PLACEHOLDER}
                              className="w-24 h-16 object-cover rounded border"
                              style={{ borderColor: `${brandBlue}33` }}
                              alt=""
                            />
                          )
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>

                      <td className="px-2 py-3 align-top" style={{ wordBreak: "break-word" }}>
                        <div className="font-medium" style={{ color: brandBlue }}>
                          {(it as any)?.producto_nombre || "—"}
                        </div>
                        <div className="text-xs text-slate-600">
                          {(it as any)?.producto_categoria ? (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded-md mr-1"
                              style={{ background: `${brandOrange}14`, color: brandOrange }}
                            >
                              {(it as any).producto_categoria}
                            </span>
                          ) : null}
                          {(it as any)?.producto_caracteristicas || ""}
                        </div>
                      </td>

                      <td className="px-2 py-3 text-right align-top">{qty}</td>
                      <td className="px-2 py-3 text-right align-top">${money(unit)}</td>
                      <td className="px-2 py-3 text-right align-top">${money(qty * unit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totales */}
          <div className="mt-5 flex justify-end">
            <div
              className="w-full sm:w-96 overflow-hidden shadow-sm border rounded-2xl"
              style={{ borderColor: `${brandBlue}22` }}
            >
              <div className="px-4 py-2 text-white font-semibold" style={{ background: brandBlue }}>
                Resumen
              </div>
              <div className="px-4 py-3 space-y-2 text-sm bg-white">
                <div className="flex justify-between">
                  <div className="text-slate-600">Subtotal</div>
                  <div className="font-medium">${money((data as any)?.subtotal || 0)}</div>
                </div>

                <div className="flex justify-between">
                  <div className="text-slate-600">Descuento ({Number((data as any)?.descuento_cliente_percent || 0)}%)</div>
                  <div className="font-medium" style={{ color: brandOrange }}>
                    -${money((data as any)?.descuento_total || 0)}
                  </div>
                </div>

                <div className="flex justify-between">
                  <div className="text-slate-600">IVA ({Number((data as any)?.iva_percent || 0)}%)</div>
                  <div className="font-medium">${money((data as any)?.iva_total || 0)}</div>
                </div>

                <div className="pt-2 mt-1 border-t flex items-center justify-between text-base">
                  <div className="font-semibold" style={{ color: brandBlue }}>
                    TOTAL
                  </div>
                  <div className="px-3 py-1.5 rounded-lg text-white font-semibold" style={{ background: brandOrange }}>
                    ${money((data as any)?.total || 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-[11px] text-slate-500">Datos bancarios disponibles en el pie de página.</div>

          {bottomBodySlot ? <div className="mt-6">{bottomBodySlot}</div> : null}
        </div>

        {/* ===================== FOOTER FULL-BLEED ===================== */}
        <div className="w-full" style={{ background: brandBlue }}>
          <div
            className="flex items-center justify-between"
            style={{
              paddingLeft: BODY_PAD_X_PX,
              paddingRight: BODY_PAD_X_PX,
              paddingTop: 10,
              paddingBottom: 10,
              color: "white",
            }}
          >
            <div style={{ maxWidth: "68%" }}>
              <div className="text-[11px] opacity-95">
                <span className="font-semibold" style={{ letterSpacing: 0.3 }}>
                  Datos bancarios
                </span>
                <span className="opacity-80"> • {BANK.NAME}</span>
              </div>

              <div className="text-[11px] opacity-95" style={{ marginTop: 2 }}>
                <span className="opacity-85">Titular:</span> <span className="font-semibold">{BANK.COMPANY_NAME}</span>
                <span className="opacity-70"> • </span>
                <span className="opacity-85">RUC:</span> <span className="font-semibold">{BANK.RUC}</span>
              </div>

              <div className="text-[11px] opacity-95" style={{ marginTop: 2 }}>
                <span className="opacity-85">{BANK.ACCOUNT_TYPE}:</span>{" "}
                <span className="font-semibold" style={{ letterSpacing: 0.6 }}>
                  {BANK.ACCOUNT_NUMBER}
                </span>
                <span className="opacity-70"> • </span>
                <span className="opacity-85">Contabilidad:</span> <span className="font-semibold">{BANK.EMAIL}</span>
              </div>
            </div>

            <div className="text-[11px] opacity-90 text-right" style={{ whiteSpace: "nowrap" }}>
               {new Date().getFullYear()} {COMPANY.NAME}
            </div>
          </div>
        </div>

        <div className="w-full" style={{ height: 3, background: brandOrange }} />
      </div>
    </>
  );
}
