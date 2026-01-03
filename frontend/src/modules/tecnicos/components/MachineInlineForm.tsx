// src/modules/tecnicos/components/MachineInlineForm.tsx
/**
 * Modal para creación rápida de máquinas (inline).
 * Usado en ReportWizard y otros flujos donde se necesita crear máquinas sobre la marcha.
 * 
 * CARACTERÍSTICAS:
 * - UI/UX mobile-first moderna
 * - Validaciones en tiempo real
 * - Animaciones suaves
 * - Feedback visual inmediato
 * - Cierre con backdrop o botón X
 */

import * as React from "react";
import {
  XMarkIcon,
  WrenchScrewdriverIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { createMachine } from "../api/machines";
import { toast } from "react-toastify";

// ===========================
// TIPOS
// ===========================

export interface MachineInlineFormProps {
  clientId: number | null;
  onClose: () => void;
  onSuccess: (machineId: number) => void;
  isOpen: boolean;
}

interface FormData {
  name: string;
  brand: string;
  model: string;
  serial: string;
  purpose: string; // Mantenido para futuro, pero no se envía al backend aún
  notes: string;
}

interface FormErrors {
  general?: string;
  name?: string;
  brand?: string;
  model?: string;
}

const INITIAL_FORM_DATA: FormData = {
  name: "",
  brand: "",
  model: "",
  serial: "",
  purpose: "",
  notes: "",
};

// ===========================
// COMPONENTE PRINCIPAL
// ===========================

export default function MachineInlineForm({
  clientId,
  onClose,
  onSuccess,
  isOpen,
}: MachineInlineFormProps): React.ReactElement | null {
  const [saving, setSaving] = React.useState(false);
  const [formData, setFormData] = React.useState<FormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  // Reset form cuando se abre el modal
  React.useEffect(() => {
    if (isOpen) {
      setFormData(INITIAL_FORM_DATA);
      setErrors({});
      setTouched({});
    }
  }, [isOpen]);

  // Cerrar con ESC
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Bloquear scroll del body cuando modal está abierto
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // ===========================
  // VALIDACIONES
  // ===========================

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    const hasIdentifier =
      formData.name.trim() ||
      formData.brand.trim() ||
      formData.model.trim();

    if (!hasIdentifier) {
      newErrors.general = "Ingresa al menos nombre, marca o modelo de la máquina";
      newErrors.name = "Requerido";
      newErrors.brand = "Requerido";
      newErrors.model = "Requerido";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Validación en tiempo real
  const validateField = (field: keyof FormData, value: string) => {
    const newErrors = { ...errors };

    // Limpiar errores generales si se empieza a escribir
    if (value.trim()) {
      delete newErrors.general;
      delete newErrors[field as keyof FormErrors];
    }

    setErrors(newErrors);
  };

  // ===========================
  // HANDLERS
  // ===========================

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    validateField(name as keyof FormData, value);
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!clientId) {
      toast.error("⚠️ No hay cliente seleccionado", {
        position: "top-center",
        autoClose: 3000,
      });
      return;
    }

    if (!validateForm()) {
      toast.error("⚠️ Completa al menos un campo de identificación", {
        position: "top-center",
        autoClose: 3000,
        style: {
          background: "#FEF3C7",
          color: "#92400E",
          borderRadius: "12px",
        },
      });
      return;
    }

    setSaving(true);

    try {
      const machine = await createMachine({
        client: clientId,
        name: formData.name.trim(),
        brand: formData.brand.trim(),
        model: formData.model.trim(),
        serial: formData.serial.trim(),
        notes: formData.notes.trim(),
        // NOTA: 'purpose' se mantiene en el formulario pero no se envía al backend
        // hasta que el modelo Machine lo soporte
      });

      toast.success("✅ Máquina creada correctamente", {
        position: "top-center",
        autoClose: 2000,
        style: {
          background: "#D1FAE5",
          color: "#065F46",
          borderRadius: "12px",
        },
      });

      onSuccess(machine.id);
    } catch (err: any) {
      const errorMessage = err.message || "Error al crear la máquina";
      
      toast.error(`❌ ${errorMessage}`, {
        position: "top-center",
        autoClose: 4000,
        style: {
          background: "#FEE2E2",
          color: "#991B1B",
          borderRadius: "12px",
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !saving) {
      onClose();
    }
  };

  // ===========================
  // RENDER
  // ===========================

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden animate-slideIn">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-[#0A3D91] to-[#0d4bb8] text-white p-6 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <WrenchScrewdriverIcon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-2xl font-bold">Nueva Máquina</h3>
              <p className="text-blue-100 text-sm">Registra un nuevo equipo</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-2 rounded-xl hover:bg-white/20 transition-all duration-200 disabled:opacity-50"
            title="Cerrar"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Error general */}
          {errors.general && (
            <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-200 flex items-start gap-3 animate-shake">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">!</span>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Atención requerida
                </p>
                <p className="text-sm text-amber-800 mt-1">{errors.general}</p>
              </div>
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Nombre descriptivo
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              onBlur={() => handleBlur("name")}
              placeholder="Ej: Compresor Principal, Línea de Producción A"
              className={`w-full px-4 py-3 rounded-xl border-2 transition-all duration-200 ${
                touched.name && errors.name
                  ? "border-amber-300 bg-amber-50 focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  : "border-slate-300 focus:border-[#0A3D91] focus:ring-2 focus:ring-blue-100"
              } focus:outline-none`}
            />
            {touched.name && errors.name && (
              <p className="mt-1.5 text-xs text-amber-700 flex items-center gap-1">
                <span>⚠️</span>
                Al menos uno de: nombre, marca o modelo
              </p>
            )}
            <p className="mt-1.5 text-xs text-slate-500">
              Ayuda a identificar rápidamente el equipo
            </p>
          </div>

          {/* Marca y Modelo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Marca
              </label>
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                onBlur={() => handleBlur("brand")}
                placeholder="Ej: Atlas Copco, Kaeser"
                className={`w-full px-4 py-3 rounded-xl border-2 transition-all duration-200 ${
                  touched.brand && errors.brand
                    ? "border-amber-300 bg-amber-50 focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                    : "border-slate-300 focus:border-[#0A3D91] focus:ring-2 focus:ring-blue-100"
                } focus:outline-none`}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Modelo
              </label>
              <input
                type="text"
                name="model"
                value={formData.model}
                onChange={handleChange}
                onBlur={() => handleBlur("model")}
                placeholder="Ej: GA 15, CSD 125"
                className={`w-full px-4 py-3 rounded-xl border-2 transition-all duration-200 ${
                  touched.model && errors.model
                    ? "border-amber-300 bg-amber-50 focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                    : "border-slate-300 focus:border-[#0A3D91] focus:ring-2 focus:ring-blue-100"
                } focus:outline-none`}
              />
            </div>
          </div>

          {/* Serie */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Número de serie
            </label>
            <input
              type="text"
              name="serial"
              value={formData.serial}
              onChange={handleChange}
              placeholder="Ej: ABC123456789"
              className="w-full px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:border-[#0A3D91] focus:ring-2 focus:ring-blue-100 transition-all duration-200"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Opcional. Si se especifica, debe ser único para este cliente
            </p>
          </div>

          {/* Notas */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Notas / Observaciones
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Detalles técnicos, historial, ubicación, observaciones..."
              className="w-full px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:border-[#0A3D91] focus:ring-2 focus:ring-blue-100 transition-all duration-200 resize-none"
            />
          </div>

          {/* Botones */}
          <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-6 py-3 rounded-xl border-2 border-slate-300 text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-[#0A3D91] to-[#0d4bb8] text-white font-bold hover:shadow-xl hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 transition-all duration-200 inline-flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-solid border-white border-r-transparent" />
                  Creando...
                </>
              ) : (
                <>
                  <CheckCircleIcon className="h-5 w-5" />
                  Crear máquina
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}