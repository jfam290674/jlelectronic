// /src/modules/billing/pages/EmpresaConfig.tsx
// -*- coding: utf-8 -*-
import * as React from "react";
import { toast } from "react-toastify";

type Empresa = {
  id: number;
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
  direccion_matriz: string;
  ambiente: string; // '1' pruebas, '2' producción
  ambiente_forzado: string | null;
  email_from: string;
  logo: string | null; // URL relativa o absoluta
  webhook_url_autorizado: string | null;
  webhook_hmac_secret: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const getCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()!.split(";").shift() || null;
  }
  return null;
};

const EmpresaConfig: React.FC = () => {
  const [empresas, setEmpresas] = React.useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = React.useState<number | null>(null);
  const [empresaForm, setEmpresaForm] = React.useState<Empresa | null>(null);

  const [loading, setLoading] = React.useState<boolean>(false);
  const [saving, setSaving] = React.useState<boolean>(false);
  const [lastSaved, setLastSaved] = React.useState<string | null>(null);

  // Logo nuevo seleccionado
  const [logoFile, setLogoFile] = React.useState<File | null>(null);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);

  // --------- carga inicial ---------
  const loadEmpresas = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/billing/empresas/", {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "include",
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const raw: any = await resp.json();
      // Soportar tanto array plano como respuesta paginada (results)
      const list: Empresa[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.results)
        ? raw.results
        : [];

      setEmpresas(list);

      if (list.length > 0) {
        const first = list[0];
        setEmpresaId(first.id);
        setEmpresaForm(first);
        setLogoPreview(first.logo || null);
      } else {
        setEmpresaId(null);
        setEmpresaForm(null);
        setLogoPreview(null);
      }
    } catch (err: any) {
      console.error("Error cargando empresas:", err);
      toast.error("No se pudo cargar la configuración de empresa.");
      setEmpresas([]);
      setEmpresaId(null);
      setEmpresaForm(null);
      setLogoPreview(null);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadEmpresas();
  }, []);

  // --------- cambio selección de empresa ---------
  const handleChangeEmpresa = (idStr: string) => {
    const id = idStr ? Number(idStr) : null;
    setEmpresaId(id);
    if (!id) {
      setEmpresaForm(null);
      setLogoPreview(null);
      setLogoFile(null);
      return;
    }
    const found = empresas.find((e) => e.id === id) || null;
    setEmpresaForm(found ? { ...found } : null);
    setLogoPreview(found?.logo || null);
    setLogoFile(null);
  };

  // --------- helpers de campos ---------
  const handleFieldChange = <K extends keyof Empresa>(
    field: K,
    value: Empresa[K],
  ) => {
    setEmpresaForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleToggleBoolField = (field: keyof Empresa) => {
    setEmpresaForm((prev) =>
      prev ? { ...prev, [field]: !prev[field] } : prev,
    );
  };

  const handleLogoChange: React.ChangeEventHandler<HTMLInputElement> = (
    e,
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      setLogoFile(null);
      // volvemos a mostrar el logo original
      setLogoPreview(empresaForm?.logo || null);
      return;
    }
    setLogoFile(file);
    const url = URL.createObjectURL(file);
    setLogoPreview(url);
  };

  // --------- guardar ---------
  const handleGuardar = async () => {
    if (!empresaForm || !empresaForm.id) {
      toast.error("No hay empresa seleccionada para guardar.");
      return;
    }
    setSaving(true);
    try {
      const csrf = getCookie("csrftoken") || "";
      const formData = new FormData();

      // Solo campos que el serializer acepta (evitamos id/created_at/updated_at)
      formData.append("ruc", empresaForm.ruc || "");
      formData.append("razon_social", empresaForm.razon_social || "");
      formData.append(
        "nombre_comercial",
        empresaForm.nombre_comercial || "",
      );
      formData.append(
        "direccion_matriz",
        empresaForm.direccion_matriz || "",
      );
      formData.append("ambiente", empresaForm.ambiente || "1");
      if (empresaForm.ambiente_forzado) {
        formData.append("ambiente_forzado", empresaForm.ambiente_forzado);
      } else {
        formData.append("ambiente_forzado", "");
      }
      formData.append("email_from", empresaForm.email_from || "");
      if (empresaForm.webhook_url_autorizado) {
        formData.append(
          "webhook_url_autorizado",
          empresaForm.webhook_url_autorizado,
        );
      } else {
        formData.append("webhook_url_autorizado", "");
      }
      if (empresaForm.webhook_hmac_secret) {
        formData.append(
          "webhook_hmac_secret",
          empresaForm.webhook_hmac_secret,
        );
      } else {
        formData.append("webhook_hmac_secret", "");
      }
      formData.append("is_active", String(empresaForm.is_active));

      if (logoFile) {
        formData.append("logo", logoFile);
      }

      const resp = await fetch(
        `/api/billing/empresas/${empresaForm.id}/`,
        {
          method: "PATCH",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRFToken": csrf,
            // NO poner Content-Type manualmente, el navegador lo define con boundary
          },
          credentials: "include",
          body: formData,
        },
      );

      if (!resp.ok) {
        let msg = `Error HTTP ${resp.status}`;
        try {
          const errData = await resp.json();
          msg = errData.detail || JSON.stringify(errData);
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const updated: Empresa = await resp.json();
      toast.success("Datos de empresa actualizados correctamente.");

      // actualizamos listado local
      setEmpresas((prev) =>
        prev.map((e) => (e.id === updated.id ? updated : e)),
      );
      setEmpresaForm(updated);
      setLogoFile(null);
      setLogoPreview(updated.logo || null);
      setLastSaved(new Date().toLocaleString("es-EC"));
    } catch (err: any) {
      console.error("Error guardando empresa:", err);
      toast.error("No se pudo guardar la configuración de la empresa.");
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => {
    if (!empresaId) return;
    const original = empresas.find((e) => e.id === empresaId);
    if (!original) return;
    if (
      window.confirm(
        "¿Descartar cambios no guardados y volver a los datos originales?",
      )
    ) {
      setEmpresaForm({ ...original });
      setLogoFile(null);
      setLogoPreview(original.logo || null);
    }
  };

  // --------- campos derivados para UX ---------
  const razonSocial = empresaForm?.razon_social ?? "";
  const nombreComercial = empresaForm?.nombre_comercial ?? "";
  const ruc = empresaForm?.ruc ?? "";
  const direccionMatriz = empresaForm?.direccion_matriz ?? "";
  const emailFrom = empresaForm?.email_from ?? "";
  const ambiente = empresaForm?.ambiente ?? "1";
  const ambienteForzado = empresaForm?.ambiente_forzado ?? "";
  const isActive = !!empresaForm?.is_active;
  const webhookUrl = empresaForm?.webhook_url_autorizado ?? "";
  const webhookSecret = empresaForm?.webhook_hmac_secret ?? "";

  return (
    <div className="px-4 py-5 md:py-6">
      {/* Título + acciones principales */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-slate-800">
            Configuración de empresa
          </h1>
          <p className="mt-1 text-xs md:text-sm text-slate-600">
            Datos fiscales usados en las facturas electrónicas (RUC, razón
            social, dirección matriz, ambiente SRI, logo, etc.).
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mt-2 md:mt-0">
          <button
            type="button"
            onClick={handleRevert}
            disabled={!empresaForm || loading || saving}
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Descartar cambios
          </button>
          <button
            type="button"
            onClick={handleGuardar}
            disabled={!empresaForm || loading || saving}
            className="inline-flex items-center rounded-xl bg-[#0A3D91] px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#083777] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>

      {/* selector de empresa + estado carga */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Empresa emisora
            </label>
            <select
              value={empresaId ?? ""}
              onChange={(e) => handleChangeEmpresa(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
            >
              {empresas.length === 0 && (
                <option value="">Sin empresas configuradas</option>
              )}
              {empresas.length > 0 && (
                <option value="">Seleccionar empresa…</option>
              )}
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razon_social || emp.nombre_comercial || "Empresa"}{" "}
                  {emp.ruc ? `· ${emp.ruc}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="text-right text-[11px] text-slate-500">
            {loading ? (
              <span>Cargando datos…</span>
            ) : lastSaved ? (
              <span>
                Último guardado:{" "}
                <span className="font-medium text-slate-700">
                  {lastSaved}
                </span>
              </span>
            ) : (
              <span>Recuerda guardar los cambios realizados.</span>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 shadow-sm">
          Cargando configuración de la empresa…
        </div>
      )}

      {!loading && !empresaForm && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
          No se encontró ninguna empresa seleccionada. Verifica que exista al
          menos una empresa emisora en el backend.
        </div>
      )}

      {!loading && empresaForm && (
        <div className="mt-4 space-y-4">
          {/* Card: Datos fiscales + ambiente / estado */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <h2 className="text-sm font-semibold text-slate-800">
                  Datos fiscales principales
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  Esta información aparece en el encabezado de las facturas
                  electrónicas y en la firma tributaria frente al SRI.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Razón social
                    </label>
                    <input
                      type="text"
                      value={razonSocial}
                      onChange={(e) =>
                        handleFieldChange("razon_social", e.target.value)
                      }
                      className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                      placeholder="Empresa Ejemplo S.A."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Nombre comercial
                    </label>
                    <input
                      type="text"
                      value={nombreComercial}
                      onChange={(e) =>
                        handleFieldChange(
                          "nombre_comercial",
                          e.target.value || null,
                        )
                      }
                      className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                      placeholder="Nombre visible al cliente (opcional)"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      RUC
                    </label>
                    <input
                      type="text"
                      value={ruc}
                      onChange={(e) =>
                        handleFieldChange("ruc", e.target.value.trim())
                      }
                      maxLength={13}
                      className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm font-mono tracking-wide shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                      placeholder="1790012345001"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Dirección matriz
                    </label>
                    <textarea
                      value={direccionMatriz}
                      onChange={(e) =>
                        handleFieldChange(
                          "direccion_matriz",
                          e.target.value,
                        )
                      }
                      rows={2}
                      className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                      placeholder='Calle principal y número, ciudad, país (ej. "Vía el Arenal sector Nulti")'
                    />
                  </div>
                </div>
              </div>

              {/* Columna: Ambiente + Estado */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    Ambiente SRI
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Define si las facturas se envían al ambiente de{" "}
                    <b>pruebas</b> o <b>producción</b> del SRI.
                  </p>

                  <label className="mt-2 block text-xs font-medium text-slate-600">
                    Ambiente principal
                  </label>
                  <select
                    value={ambiente}
                    onChange={(e) =>
                      handleFieldChange("ambiente", e.target.value)
                    }
                    className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                  >
                    <option value="1">1 · Pruebas SRI</option>
                    <option value="2">2 · Producción SRI</option>
                  </select>

                  <label className="mt-3 block text-xs font-medium text-slate-600">
                    Ambiente forzado (opcional)
                  </label>
                  <select
                    value={ambienteForzado}
                    onChange={(e) =>
                      handleFieldChange(
                        "ambiente_forzado",
                        e.target.value || null,
                      )
                    }
                    className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                  >
                    <option value="">
                      (Sin forzar · usa ambiente principal)
                    </option>
                    <option value="1">Forzar a pruebas (1)</option>
                    <option value="2">Forzar a producción (2)</option>
                  </select>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    Estado
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Controla si esta empresa puede emitir facturas o queda
                    deshabilitada.
                  </p>
                  <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => handleToggleBoolField("is_active")}
                      className="h-4 w-4 rounded border-slate-300 text-[#0A3D91] focus:ring-[#0A3D91]"
                    />
                    <span>Empresa activa para facturar</span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Card: Notificaciones / Webhook */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">
              Notificaciones y Webhook
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Configura el correo desde el que se envían las facturas y el
              webhook opcional cuando una factura queda AUTORIZADA.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Email remitente (email_from)
                </label>
                <input
                  type="email"
                  value={emailFrom}
                  onChange={(e) =>
                    handleFieldChange("email_from", e.target.value)
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                  placeholder="facturacion@empresa.com"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Correo que aparece como remitente en los emails de envío de
                  factura.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  URL Webhook autorizado (opcional)
                </label>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) =>
                    handleFieldChange(
                      "webhook_url_autorizado",
                      e.target.value || null,
                    )
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                  placeholder="https://mi-api.com/webhook/facturas"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Si se configura, se enviará un POST cuando una factura sea
                  AUTORIZADA por el SRI.
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600">
                  Secreto HMAC para Webhook (opcional)
                </label>
                <input
                  type="text"
                  value={webhookSecret}
                  onChange={(e) =>
                    handleFieldChange(
                      "webhook_hmac_secret",
                      e.target.value || null,
                    )
                  }
                  className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                  placeholder="Cadena secreta para firmar el payload"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Si se define, el webhook se firma con HMAC para verificar la
                  autenticidad en tu sistema externo.
                </p>
              </div>
            </div>
          </section>

          {/* Card: Logo / Branding */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">
              Logo y branding
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Logo que se usará en el RIDE (PDF/HTML) de la factura electrónica
              y, si corresponde, en comunicaciones por email.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[auto,1fr] md:items-start">
              <div className="flex flex-col items-center gap-2">
                <div className="h-24 w-24 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                  {logoPreview ? (
                    // Si el backend devuelve ruta relativa, el navegador la resolverá
                    <img
                      src={logoPreview}
                      alt="Logo empresa"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-[11px] text-slate-400 text-center px-2">
                      Sin logo
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500">
                  Vista previa
                </span>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600">
                  Subir nuevo logo
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="block w-full text-xs text-slate-700 file:mr-2 file:rounded-lg file:border-0 file:bg-[#0A3D91] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-[#083777]"
                />
                <p className="text-[11px] text-slate-500">
                  Formatos recomendados: PNG o JPG. Tamaño sugerido: cuadrado o
                  horizontal (ej. 300×100).
                  <br />
                  El logo se guardará al hacer clic en{" "}
                  <b>“Guardar cambios”</b>.
                </p>
              </div>
            </div>
          </section>

          {/* Nota final */}
          <p className="pb-2 text-[11px] text-slate-500">
            Todos los cambios aplican a las nuevas facturas emitidas. Las
            facturas ya autorizadas se mantienen con los datos que tenían en su
            momento.
          </p>
        </div>
      )}
    </div>
  );
};

export default EmpresaConfig;
