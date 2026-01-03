// src/modules/tecnicos/pages/MachineForm.tsx
/**
 * Formulario para crear/editar máquinas.
 * - Modo crear: /tecnicos/machines/new
 * - Modo editar: /tecnicos/machines/:id/edit
 * 
 * Campos:
 * - Cliente (obligatorio)
 * - Nombre (opcional si hay brand/model)
 * - Marca (opcional si hay name/model)
 * - Modelo (opcional si hay name/brand)
 * - Serie (opcional, único por cliente)
 * - Finalidad (opcional: REPARACION/FABRICACION)
 * - Notas (opcional)
 */

import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import {
  createMachine,
  updateMachine,
  getMachine,
} from "../api/machines";
import { toast } from "react-toastify";

// Importar API de clientes (asumiendo estructura similar)
interface Cliente {
  id: number;
  nombre: string;
  identificador?: string;
}

async function listClientes(): Promise<Cliente[]> {
  const response = await fetch("/api/clientes/?page_size=1000", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Error al cargar clientes");
  }

  const data = await response.json();
  return data.results || [];
}

interface FormData {
  client: number | null;
  name: string;
  brand: string;
  model: string;
  serial: string;
  purpose: string;
  notes: string;
}

export default function MachineForm(): React.ReactElement {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [loading, setLoading] = React.useState(isEdit);
  const [saving, setSaving] = React.useState(false);
  const [clientes, setClientes] = React.useState<Cliente[]>([]);
  const [loadingClientes, setLoadingClientes] = React.useState(true);

  const [formData, setFormData] = React.useState<FormData>({
    client: null,
    name: "",
    brand: "",
    model: "",
    serial: "",
    purpose: "",
    notes: "",
  });

  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Cargar clientes
  React.useEffect(() => {
    let mounted = true;

    const loadClientes = async () => {
      try {
        const data = await listClientes();
        if (mounted) {
          setClientes(data);
        }
      } catch (err: any) {
        if (mounted) {
          toast.error(err.message || "Error al cargar clientes");
        }
      } finally {
        if (mounted) {
          setLoadingClientes(false);
        }
      }
    };

    loadClientes();

    return () => {
      mounted = false;
    };
  }, []);

  // Cargar máquina si es edición
  React.useEffect(() => {
    if (!isEdit || !id) return;

    let mounted = true;

    const loadMachine = async () => {
      setLoading(true);

      try {
        const machine = await getMachine(parseInt(id, 10));

        if (mounted) {
          setFormData({
            client: machine.client,
            name: machine.name || "",
            brand: machine.brand || "",
            model: machine.model || "",
            serial: machine.serial || "",
            // ✅ FIX: Usar optional chaining por si purpose no existe
            purpose: (machine as any).purpose || "",
            notes: machine.notes || "",
          });
        }
      } catch (err: any) {
        if (mounted) {
          toast.error(err.message || "Error al cargar la máquina");
          navigate("/tecnicos/machines");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadMachine();

    return () => {
      mounted = false;
    };
  }, [isEdit, id, navigate]);

  // Manejar cambios en inputs
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: name === "client" ? (value ? parseInt(value, 10) : null) : value,
    }));

    // Limpiar error del campo
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  // Validar formulario
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Cliente obligatorio
    if (!formData.client) {
      newErrors.client = "Selecciona un cliente";
    }

    // Al menos uno de name/brand/model
    const hasIdentifier =
      formData.name.trim() || formData.brand.trim() || formData.model.trim();

    if (!hasIdentifier) {
      const msg = "Debes indicar al menos nombre, marca o modelo";
      newErrors.name = msg;
      newErrors.brand = msg;
      newErrors.model = msg;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Enviar formulario
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      toast.error("Corrige los errores del formulario");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        client: formData.client!,
        name: formData.name.trim(),
        brand: formData.brand.trim(),
        model: formData.model.trim(),
        serial: formData.serial.trim(),
        purpose: formData.purpose.trim() || "",
        notes: formData.notes.trim(),
      };

      if (isEdit && id) {
        await updateMachine(parseInt(id, 10), payload);
        toast.success("Máquina actualizada");
      } else {
        await createMachine(payload);
        toast.success("Máquina creada");
      }

      navigate("/tecnicos/machines");
    } catch (err: any) {
      toast.error(err.message || "Error al guardar la máquina");
    } finally {
      setSaving(false);
    }
  };

  // Cancelar
  const handleCancel = () => {
    navigate("/tecnicos/machines");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#0A3D91] border-r-transparent" />
          <p className="mt-2 text-slate-600">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleCancel}
            className="p-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>

          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-800">
              {isEdit ? "Editar Máquina" : "Nueva Máquina"}
            </h1>
            <p className="text-slate-600 mt-1">
              {isEdit
                ? "Actualiza los datos de la máquina"
                : "Registra una nueva máquina para un cliente"}
            </p>
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 space-y-5">
            {/* Cliente */}
            <div>
              <label htmlFor="client" className="block text-sm font-medium text-slate-700 mb-1">
                Cliente <span className="text-red-500">*</span>
              </label>

              {loadingClientes ? (
                <div className="h-10 bg-slate-200 rounded-lg animate-pulse" />
              ) : (
                <select
                  id="client"
                  name="client"
                  value={formData.client || ""}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 rounded-lg border ${
                    errors.client ? "border-red-300" : "border-slate-300"
                  } focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent`}
                  required
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.identificador ? `(${c.identificador})` : ""}
                    </option>
                  ))}
                </select>
              )}

              {errors.client && (
                <p className="mt-1 text-xs text-red-600">{errors.client}</p>
              )}
            </div>

            {/* Nombre */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                Nombre descriptivo
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Ej: Compresor #1, Línea de producción A"
                className={`w-full px-3 py-2 rounded-lg border ${
                  errors.name ? "border-red-300" : "border-slate-300"
                } focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent`}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-600">{errors.name}</p>
              )}
            </div>

            {/* Marca */}
            <div>
              <label htmlFor="brand" className="block text-sm font-medium text-slate-700 mb-1">
                Marca
              </label>
              <input
                type="text"
                id="brand"
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                placeholder="Ej: Kaeser, Atlas Copco"
                className={`w-full px-3 py-2 rounded-lg border ${
                  errors.brand ? "border-red-300" : "border-slate-300"
                } focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent`}
              />
              {errors.brand && (
                <p className="mt-1 text-xs text-red-600">{errors.brand}</p>
              )}
            </div>

            {/* Modelo */}
            <div>
              <label htmlFor="model" className="block text-sm font-medium text-slate-700 mb-1">
                Modelo
              </label>
              <input
                type="text"
                id="model"
                name="model"
                value={formData.model}
                onChange={handleChange}
                placeholder="Ej: CSD 125"
                className={`w-full px-3 py-2 rounded-lg border ${
                  errors.model ? "border-red-300" : "border-slate-300"
                } focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent`}
              />
              {errors.model && (
                <p className="mt-1 text-xs text-red-600">{errors.model}</p>
              )}
            </div>

            {/* Serie */}
            <div>
              <label htmlFor="serial" className="block text-sm font-medium text-slate-700 mb-1">
                Número de serie
              </label>
              <input
                type="text"
                id="serial"
                name="serial"
                value={formData.serial}
                onChange={handleChange}
                placeholder="Ej: 123456789"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent"
              />
              <p className="mt-1 text-xs text-slate-500">
                Opcional. Si se especifica, debe ser único para este cliente
              </p>
            </div>

            {/* Finalidad */}
            <div>
              <label htmlFor="purpose" className="block text-sm font-medium text-slate-700 mb-1">
                Finalidad
              </label>
              <select
                id="purpose"
                name="purpose"
                value={formData.purpose}
                onChange={handleChange}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent"
              >
                <option value="">Sin especificar</option>
                <option value="REPARACION">Reparación</option>
                <option value="FABRICACION">Fabricación</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Indica el tipo de trabajo que se realiza en esta máquina
              </p>
            </div>

            {/* Notas */}
            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-slate-700 mb-1">
                Notas
              </label>
              <textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={4}
                placeholder="Detalles técnicos, historial, observaciones..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent resize-none"
              />
            </div>
          </div>

          {/* Acciones */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving || loadingClientes}
              className="px-6 py-2 rounded-lg bg-[#0A3D91] text-white hover:bg-[#083777] disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-white border-r-transparent" />
              )}
              {saving ? "Guardando..." : isEdit ? "Actualizar" : "Crear Máquina"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}