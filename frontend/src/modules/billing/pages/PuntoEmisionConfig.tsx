// /src/modules/billing/pages/PuntoEmisionConfig.tsx
// -*- coding: utf-8 -*-
import * as React from "react";
import { toast } from "react-toastify";

type RawEmpresa = {
  id: number;
  razon_social?: string;
  nombre_comercial?: string;
  ruc?: string;
  [key: string]: any;
};

type RawEstablecimiento = {
  id: number;
  codigo?: string;
  nombre?: string;
  direccion?: string;
  activo?: boolean;
  empresa?: number | RawEmpresa;
  [key: string]: any;
};

type RawPuntoEmision = {
  id: number;
  codigo?: string;
  descripcion?: string;
  is_active?: boolean;
  es_por_defecto?: boolean;
  establecimiento?: number | RawEstablecimiento;
  [key: string]: any;
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

const PuntoEmisionConfig: React.FC = () => {
  // Empresas / establecimientos / puntos
  const [empresas, setEmpresas] = React.useState<RawEmpresa[]>([]);
  const [establecimientos, setEstablecimientos] = React.useState<RawEstablecimiento[]>([]);
  const [puntos, setPuntos] = React.useState<RawPuntoEmision[]>([]);

  const [empresaId, setEmpresaId] = React.useState<number | null>(null);
  const [establecimientoId, setEstablecimientoId] = React.useState<number | null>(null);

  const [loadingEmpresas, setLoadingEmpresas] = React.useState(false);
  const [loadingEstabs, setLoadingEstabs] = React.useState(false);
  const [loadingPuntos, setLoadingPuntos] = React.useState(false);
  const [savingPuntoId, setSavingPuntoId] = React.useState<number | "new" | null>(null);
  const [deletingPuntoId, setDeletingPuntoId] = React.useState<number | null>(null);

  // Draft de creación de nuevo punto (campo activo es sólo para el UI)
  const [newPunto, setNewPunto] = React.useState<{
    codigo: string;
    descripcion: string;
    activo: boolean;
  }>({
    codigo: "",
    descripcion: "",
    activo: true,
  });

  // Drafts por punto (edición inline simple)
  const [drafts, setDrafts] = React.useState<
    Record<number, { descripcion: string; activo: boolean }>
  >({});

  /* ===================== Carga inicial: empresas ===================== */
  const loadEmpresas = async () => {
    setLoadingEmpresas(true);
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
      const list: RawEmpresa[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.results)
        ? raw.results
        : [];

      setEmpresas(list);

      if (list.length > 0) {
        setEmpresaId(list[0].id);
      } else {
        setEmpresaId(null);
      }
    } catch (err: any) {
      console.error("Error cargando empresas:", err);
      toast.error("No se pudo cargar la lista de empresas.");
      setEmpresas([]);
      setEmpresaId(null);
    } finally {
      setLoadingEmpresas(false);
    }
  };

  React.useEffect(() => {
    loadEmpresas();
  }, []);

  /* ===================== Establecimientos según empresa ===================== */
  const loadEstablecimientos = async (empresaPk: number) => {
    setLoadingEstabs(true);
    setEstablecimientos([]);
    setEstablecimientoId(null);
    setPuntos([]);
    try {
      const url = `/api/billing/establecimientos/?empresa=${empresaPk}`;
      const resp = await fetch(url, {
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
      const data = await resp.json();
      const list: RawEstablecimiento[] = Array.isArray(data)
        ? data
        : Array.isArray(data.results)
        ? data.results
        : [];
      setEstablecimientos(list);
      if (list.length > 0) {
        setEstablecimientoId(list[0].id);
      } else {
        setEstablecimientoId(null);
      }
    } catch (err: any) {
      console.error("Error cargando establecimientos:", err);
      toast.error("No se pudo cargar los establecimientos.");
      setEstablecimientos([]);
      setEstablecimientoId(null);
      setPuntos([]);
    } finally {
      setLoadingEstabs(false);
    }
  };

  React.useEffect(() => {
    if (empresaId) {
      loadEstablecimientos(empresaId);
    } else {
      setEstablecimientos([]);
      setEstablecimientoId(null);
      setPuntos([]);
    }
  }, [empresaId]);

  /* ===================== Puntos de emisión según establecimiento ===================== */
  const loadPuntos = async (estPk: number) => {
    setLoadingPuntos(true);
    setPuntos([]);
    setDrafts({});
    try {
      const url = `/api/billing/puntos-emision/?establecimiento=${estPk}`;
      const resp = await fetch(url, {
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
      const data = await resp.json();
      const list: RawPuntoEmision[] = Array.isArray(data)
        ? data
        : Array.isArray(data.results)
        ? data.results
        : [];
      setPuntos(list);

      // Draft inicial por punto
      const initialDrafts: Record<number, { descripcion: string; activo: boolean }> = {};
      list.forEach((p) => {
        initialDrafts[p.id] = {
          descripcion: p.descripcion || "",
          // si is_active viene undefined, asumimos true (punto activo)
          activo: p.is_active !== false,
        };
      });
      setDrafts(initialDrafts);
    } catch (err: any) {
      console.error("Error cargando puntos de emisión:", err);
      toast.error("No se pudo cargar los puntos de emisión.");
      setPuntos([]);
      setDrafts({});
    } finally {
      setLoadingPuntos(false);
    }
  };

  React.useEffect(() => {
    if (establecimientoId) {
      loadPuntos(establecimientoId);
    } else {
      setPuntos([]);
      setDrafts({});
    }
  }, [establecimientoId]);

  /* ===================== Handlers selección ===================== */
  const handleChangeEmpresa = (value: string) => {
    const id = value ? Number(value) : null;
    setEmpresaId(id);
  };

  const handleChangeEstablecimiento = (value: string) => {
    const id = value ? Number(value) : null;
    setEstablecimientoId(id);
  };

  /* ===================== Crear nuevo punto ===================== */
  const handleNewPuntoChange = (field: keyof typeof newPunto, value: any) => {
    setNewPunto((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreatePunto = async () => {
    if (!establecimientoId) {
      toast.info("Selecciona primero un establecimiento.");
      return;
    }
    if (!newPunto.codigo.trim()) {
      toast.info("Ingresa el código del punto de emisión.");
      return;
    }

    setSavingPuntoId("new");
    try {
      const csrf = getCookie("csrftoken") || "";
      const payload = {
        establecimiento: establecimientoId,
        codigo: newPunto.codigo.trim(),
        descripcion: newPunto.descripcion.trim(),
        // El backend espera is_active, no "activo"
        is_active: newPunto.activo,
      };

      const resp = await fetch("/api/billing/puntos-emision/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": csrf,
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

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

      const created: RawPuntoEmision = await resp.json();
      toast.success("Punto de emisión creado correctamente.");

      setPuntos((prev) => [...prev, created]);
      setDrafts((prev) => ({
        ...prev,
        [created.id]: {
          descripcion: created.descripcion || "",
          activo: created.is_active !== false,
        },
      }));

      // limpiar formulario
      setNewPunto({
        codigo: "",
        descripcion: "",
        activo: true,
      });
    } catch (err: any) {
      console.error("Error creando punto de emisión:", err);
      toast.error("No se pudo crear el punto de emisión.");
    } finally {
      setSavingPuntoId(null);
    }
  };

  /* ===================== Actualizar punto existente ===================== */
  const handleDraftChange = (
    id: number,
    field: keyof (typeof drafts)[number],
    value: any,
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const handleSavePunto = async (p: RawPuntoEmision) => {
    const draft = drafts[p.id];
    if (!draft) return;
    setSavingPuntoId(p.id);
    try {
      const csrf = getCookie("csrftoken") || "";
      const payload: Partial<RawPuntoEmision> = {
        descripcion: draft.descripcion,
        // el backend espera is_active
        is_active: draft.activo,
      };

      const resp = await fetch(`/api/billing/puntos-emision/${p.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": csrf,
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

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

      const updated: RawPuntoEmision = await resp.json();
      toast.success("Punto de emisión actualizado.");

      setPuntos((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setDrafts((prev) => ({
        ...prev,
        [updated.id]: {
          descripcion: updated.descripcion || "",
          activo: updated.is_active !== false,
        },
      }));
    } catch (err: any) {
      console.error("Error actualizando punto de emisión:", err);
      toast.error("No se pudo guardar el punto de emisión.");
    } finally {
      setSavingPuntoId(null);
    }
  };

  const handleRevertPunto = (p: RawPuntoEmision) => {
    setDrafts((prev) => ({
      ...prev,
      [p.id]: {
        descripcion: p.descripcion || "",
        activo: p.is_active !== false,
      },
    }));
  };

  /* ===================== Eliminar punto ===================== */
  const handleDeletePunto = async (p: RawPuntoEmision) => {
    if (
      !window.confirm(
        `¿Eliminar el punto de emisión ${p.codigo || ""}? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    setDeletingPuntoId(p.id);
    try {
      const csrf = getCookie("csrftoken") || "";
      const resp = await fetch(`/api/billing/puntos-emision/${p.id}/`, {
        method: "DELETE",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": csrf,
        },
        credentials: "include",
      });

      if (!resp.ok && resp.status !== 204) {
        let msg = `Error HTTP ${resp.status}`;
        try {
          const errData = await resp.json();
          msg = errData.detail || JSON.stringify(errData);
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      toast.success("Punto de emisión eliminado.");
      setPuntos((prev) => prev.filter((x) => x.id !== p.id));
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[p.id];
        return copy;
      });
    } catch (err: any) {
      console.error("Error eliminando punto de emisión:", err);
      toast.error("No se pudo eliminar el punto de emisión.");
    } finally {
      setDeletingPuntoId(null);
    }
  };

  const selectedEmpresa = empresas.find((e) => e.id === empresaId) || null;
  const selectedEstablecimiento =
    establecimientos.find((e) => e.id === establecimientoId) || null;

  return (
    <div className="px-4 py-5 md:py-6">
      {/* Título */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-slate-800">
            Puntos de emisión
          </h1>
          <p className="mt-1 text-xs md:text-sm text-slate-600">
            Configura los establecimientos y puntos de emisión usados en las
            facturas electrónicas.
          </p>
        </div>
      </div>

      {/* Selectores: empresa + establecimiento */}
      <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Empresa
            </label>
            <select
              value={empresaId ?? ""}
              onChange={(e) => handleChangeEmpresa(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
            >
              {loadingEmpresas && <option value="">Cargando empresas…</option>}
              {!loadingEmpresas && empresas.length === 0 && (
                <option value="">Sin empresas configuradas</option>
              )}
              {!loadingEmpresas && empresas.length > 0 && (
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

          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Establecimiento
            </label>
            <select
              value={establecimientoId ?? ""}
              onChange={(e) => handleChangeEstablecimiento(e.target.value)}
              disabled={!empresaId || loadingEstabs}
              className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 shadow-sm disabled:bg-slate-50 disabled:text-slate-400 focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
            >
              {!empresaId && <option value="">Selecciona una empresa</option>}
              {empresaId && loadingEstabs && (
                <option value="">Cargando establecimientos…</option>
              )}
              {empresaId && !loadingEstabs && establecimientos.length === 0 && (
                <option value="">Sin establecimientos para esta empresa</option>
              )}
              {empresaId &&
                !loadingEstabs &&
                establecimientos.length > 0 && (
                  <>
                    <option value="">Seleccionar establecimiento…</option>
                    {establecimientos.map((est) => (
                      <option key={est.id} value={est.id}>
                        {est.codigo || ""}{" "}
                        {est.nombre ? `· ${est.nombre}` : ""}
                      </option>
                    ))}
                  </>
                )}
            </select>
          </div>
        </div>

        {/* Contexto seleccionado */}
        <div className="mt-1 text-[11px] text-slate-500">
          {selectedEmpresa && (
            <span>
              Empresa seleccionada:{" "}
              <span className="font-medium text-slate-700">
                {selectedEmpresa.razon_social ||
                  selectedEmpresa.nombre_comercial}
              </span>
            </span>
          )}
          {selectedEstablecimiento && (
            <>
              {" · "}
              <span>
                Establecimiento:{" "}
                <span className="font-medium text-slate-700">
                  {selectedEstablecimiento.codigo || ""}{" "}
                  {selectedEstablecimiento.nombre
                    ? `· ${selectedEstablecimiento.nombre}`
                    : ""}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Si no hay establecimiento válido */}
      {!loadingEstabs && empresaId && !establecimientoId && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 shadow-sm">
          Selecciona un establecimiento para gestionar sus puntos de emisión.
        </div>
      )}

      {/* Zona de puntos de emisión */}
      <div className="mt-4 space-y-4">
        {/* Formulario nuevo punto */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">
            Nuevo punto de emisión
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Crea un código de punto de emisión asociado al establecimiento
            actual. El formato habitual en Ecuador es de 3 dígitos (001, 002,
            etc.).
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Código
              </label>
              <input
                type="text"
                value={newPunto.codigo}
                onChange={(e) =>
                  handleNewPuntoChange("codigo", e.target.value)
                }
                maxLength={3}
                className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm font-mono tracking-wide shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                placeholder="001"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600">
                Descripción
              </label>
              <input
                type="text"
                value={newPunto.descripcion}
                onChange={(e) =>
                  handleNewPuntoChange("descripcion", e.target.value)
                }
                className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-2 text-sm shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                placeholder="Caja matriz, punto de venta principal…"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={newPunto.activo}
                onChange={(e) =>
                  handleNewPuntoChange("activo", e.target.checked)
                }
                className="h-4 w-4 rounded border-slate-300 text-[#0A3D91] focus:ring-[#0A3D91]"
              />
              Punto activo (se podrá seleccionar al emitir facturas)
            </label>

            <button
              type="button"
              onClick={handleCreatePunto}
              disabled={!establecimientoId || savingPuntoId === "new"}
              className="inline-flex items-center rounded-xl bg-[#0A3D91] px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#083777] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingPuntoId === "new" ? "Creando…" : "Crear punto"}
            </button>
          </div>
        </section>

        {/* Listado de puntos */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                Puntos configurados
              </h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Edita la descripción o el estado activo. Los cambios afectan a
                las próximas facturas emitidas.
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              {loadingPuntos
                ? "Cargando puntos de emisión…"
                : puntos.length
                ? `${puntos.length} punto(s) configurado(s)`
                : "Sin puntos configurados para este establecimiento."}
            </div>
          </div>

          {loadingPuntos && (
            <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-center text-xs text-slate-500">
              Cargando…
            </div>
          )}

          {!loadingPuntos && puntos.length === 0 && (
            <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              No hay puntos de emisión configurados para este establecimiento.
              Crea uno nuevo usando el formulario superior.
            </div>
          )}

          {!loadingPuntos && puntos.length > 0 && (
            <div className="mt-3 space-y-3">
              {puntos.map((p) => {
                const draft = drafts[p.id] || {
                  descripcion: p.descripcion || "",
                  activo: p.is_active !== false,
                };
                const isSaving = savingPuntoId === p.id;
                const isDeleting = deletingPuntoId === p.id;

                const hasChanges =
                  draft.descripcion !== (p.descripcion || "") ||
                  draft.activo !== (p.is_active !== false);

                return (
                  <div
                    key={p.id}
                    className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:flex-row md:items-center md:justify-between"
                  >
                    {/* Izquierda: datos + edición */}
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-mono font-semibold text-slate-800 ring-1 ring-slate-200">
                          {p.codigo || "—"}
                        </span>
                        {p.es_por_defecto && (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Por defecto
                          </span>
                        )}
                        <span
                          className={[
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            draft.activo
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-200 text-slate-700",
                          ].join(" ")}
                        >
                          {draft.activo ? "Activo" : "Inactivo"}
                        </span>
                      </div>

                      <div className="mt-1">
                        <label className="block text-[11px] font-medium text-slate-600">
                          Descripción visible
                        </label>
                        <input
                          type="text"
                          value={draft.descripcion}
                          onChange={(e) =>
                            handleDraftChange(
                              p.id,
                              "descripcion",
                              e.target.value,
                            )
                          }
                          className="mt-1 block w-full rounded-xl border border-slate-300 px-2 py-1.5 text-xs shadow-sm focus:border-[#0A3D91] focus:outline-none focus:ring-1 focus:ring-[#0A3D91]"
                          placeholder="Caja matriz, punto sucursal, etc."
                        />
                      </div>

                      <div className="mt-1">
                        <label className="inline-flex items-center gap-2 text-[11px] text-slate-700">
                          <input
                            type="checkbox"
                            checked={draft.activo}
                            onChange={(e) =>
                              handleDraftChange(p.id, "activo", e.target.checked)
                            }
                            className="h-4 w-4 rounded border-slate-300 text-[#0A3D91] focus:ring-[#0A3D91]"
                          />
                          Punto activo (se mostrará en el wizard de facturas)
                        </label>
                      </div>
                    </div>

                    {/* Derecha: acciones */}
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1 md:pt-0 md:pl-3">
                      <button
                        type="button"
                        onClick={() => handleRevertPunto(p)}
                        disabled={isSaving || isDeleting || !hasChanges}
                        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Deshacer
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSavePunto(p)}
                        disabled={isSaving || isDeleting || !hasChanges}
                        className="inline-flex items-center rounded-xl bg-[#0A3D91] px-3 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-[#083777] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSaving ? "Guardando…" : "Guardar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePunto(p)}
                        disabled={isSaving || isDeleting}
                        className="inline-flex items-center rounded-xl border border-red-300 bg-red-50 px-3 py-1 text-[11px] font-medium text-red-700 shadow-sm hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isDeleting ? "Eliminando…" : "Eliminar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default PuntoEmisionConfig;
