// src/modules/tecnicos/pages/TemplateList.tsx
/**
 * Lista y gestión de plantillas de texto para técnicos.
 * 
 * CARACTERÍSTICAS:
 * - Plantillas reutilizables para diagnósticos, estados, actividades, observaciones y recomendaciones
 * - CRUD completo: Crear, Editar, Eliminar
 * - Filtros por tipo de plantilla y búsqueda
 * - Modal para crear/editar con formulario simple
 * - Vista responsiva con cards
 */

import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type TechnicianTemplate,
  type TemplateType,
  TEMPLATE_TYPE_LABELS,
} from "../api/templates";
import { useAuthUser } from "../../../auth/useAuthUser";
import { toast } from "react-toastify";

// ===========================
// TIPOS LOCALES
// ===========================

type ModalMode = "create" | "edit" | null;

interface ModalState {
  mode: ModalMode;
  template: TechnicianTemplate | null;
}

interface FormData {
  template_type: TemplateType;
  text: string;
  active: boolean;
}

// ===========================
// COMPONENTE PRINCIPAL
// ===========================

export default function TemplateList(): React.ReactElement {
  const user = useAuthUser();
  const navigate = useNavigate();

  // Estados
  const [templates, setTemplates] = React.useState<TechnicianTemplate[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [filterType, setFilterType] = React.useState<TemplateType | "ALL">("ALL");
  const [modal, setModal] = React.useState<ModalState>({
    mode: null,
    template: null,
  });

  // Verificar autenticación
  React.useEffect(() => {
    if (user === null) {
      toast.error("Debes iniciar sesión");
      navigate("/login");
    }
  }, [user, navigate]);

  // Cargar plantillas
  React.useEffect(() => {
    if (!user) return;

    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        const data = await listTemplates();
        if (mounted) {
          setTemplates(data.results);
        }
      } catch (err: any) {
        toast.error(err.message || "Error al cargar plantillas");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [user]);

  // Filtrado local
  const filteredTemplates = React.useMemo(() => {
    return templates.filter((t) => {
      const matchesSearch = t.text
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const matchesType = filterType === "ALL" || t.template_type === filterType;
      return matchesSearch && matchesType;
    });
  }, [templates, searchTerm, filterType]);

  // Handlers
  const handleOpenCreate = () => {
    setModal({ mode: "create", template: null });
  };

  const handleOpenEdit = (template: TechnicianTemplate) => {
    setModal({ mode: "edit", template });
  };

  const handleCloseModal = () => {
    setModal({ mode: null, template: null });
  };

  const handleSave = async (data: FormData) => {
    try {
      if (modal.mode === "create") {
        const newTemplate = await createTemplate({
          template_type: data.template_type,
          text: data.text,
          active: data.active,
        });
        setTemplates((prev) => [newTemplate, ...prev]);
        toast.success("Plantilla creada correctamente");
      } else if (modal.mode === "edit" && modal.template) {
        const updated = await updateTemplate(modal.template.id, {
          template_type: data.template_type,
          text: data.text,
          active: data.active,
        });
        setTemplates((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t))
        );
        toast.success("Plantilla actualizada correctamente");
      }
      handleCloseModal();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar plantilla");
    }
  };

  const handleDelete = async (template: TechnicianTemplate) => {
    const confirmed = window.confirm(
      `¿Estás seguro de eliminar esta plantilla?\n\n"${template.text.substring(0, 50)}..."\n\nEsta acción no se puede deshacer.`
    );

    if (!confirmed) return;

    try {
      await deleteTemplate(template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      toast.success("Plantilla eliminada correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar plantilla");
    }
  };

  // Guard de carga inicial
  if (user === undefined || loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <div className="h-8 w-64 bg-slate-200 rounded animate-pulse mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-48 bg-slate-200 rounded-xl animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (user === null) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-800">
              Plantillas de texto
            </h1>
            <p className="text-slate-600 mt-1">
              Crea plantillas reutilizables para agilizar tus informes técnicos
            </p>
          </div>

          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 rounded-lg bg-[#0A3D91] text-white hover:bg-[#083777] inline-flex items-center gap-2 flex-shrink-0"
          >
            <PlusIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Nueva plantilla</span>
          </button>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Búsqueda */}
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar en el texto..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]"
              />
            </div>

            {/* Filtro por tipo */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as TemplateType | "ALL")}
              className="px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]"
            >
              <option value="ALL">Todos los tipos</option>
              {(Object.entries(TEMPLATE_TYPE_LABELS) as [TemplateType, string][]).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Lista de plantillas */}
        {filteredTemplates.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
            <p className="text-slate-600 mb-4">
              {templates.length === 0
                ? "No hay plantillas creadas"
                : "No se encontraron plantillas con los filtros aplicados"}
            </p>
            {templates.length === 0 && (
              <button
                onClick={handleOpenCreate}
                className="px-4 py-2 rounded-lg bg-[#0A3D91] text-white hover:bg-[#083777] inline-flex items-center gap-2"
              >
                <PlusIcon className="h-5 w-5" />
                Crear primera plantilla
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onEdit={handleOpenEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal Crear/Editar */}
      {modal.mode && (
        <TemplateModal
          mode={modal.mode}
          template={modal.template}
          onSave={handleSave}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}

// ===========================
// COMPONENTE: TemplateCard
// ===========================

function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: TechnicianTemplate;
  onEdit: (t: TechnicianTemplate) => void;
  onDelete: (t: TechnicianTemplate) => void;
}): React.ReactElement {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[#0A3D91] mb-1">
            {template.template_type_display}
          </h3>
        </div>

        {/* Badge de estado */}
        {template.active ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-green-100 text-green-700 text-xs font-medium flex-shrink-0">
            <CheckIcon className="h-3 w-3" />
            Activa
          </span>
        ) : (
          <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium flex-shrink-0">
            Inactiva
          </span>
        )}
      </div>

      {/* Texto de la plantilla */}
      <div className="mb-4">
        <p className="text-slate-700 line-clamp-4 text-sm">
          {template.text}
        </p>
      </div>

      {/* Footer con acciones */}
      <div className="flex items-center gap-2 pt-3 border-t">
        <button
          onClick={() => onEdit(template)}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-2 text-sm"
          title="Editar"
        >
          <PencilIcon className="h-4 w-4" />
          Editar
        </button>

        <button
          onClick={() => onDelete(template)}
          className="px-3 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
          title="Eliminar"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Meta info */}
      <div className="mt-3 pt-3 border-t text-xs text-slate-500">
        Creada el {new Date(template.created_at).toLocaleDateString("es-EC", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}
      </div>
    </div>
  );
}

// ===========================
// COMPONENTE: TemplateModal
// ===========================

function TemplateModal({
  mode,
  template,
  onSave,
  onClose,
}: {
  mode: "create" | "edit";
  template: TechnicianTemplate | null;
  onSave: (data: FormData) => Promise<void>;
  onClose: () => void;
}): React.ReactElement {
  const [saving, setSaving] = React.useState(false);
  const [formData, setFormData] = React.useState<FormData>({
    template_type: template?.template_type || "DIAGNOSTIC",
    text: template?.text || "",
    active: template?.active ?? true,
  });

  // Cerrar con Escape
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [saving, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.text.trim()) {
      toast.error("El texto de la plantilla es obligatorio");
      return;
    }

    setSaving(true);
    try {
      await onSave(formData);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-slate-800">
            {mode === "create" ? "Nueva plantilla" : "Editar plantilla"}
          </h3>

          <button
            onClick={onClose}
            disabled={saving}
            className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-50"
            title="Cerrar"
          >
            <XMarkIcon className="h-6 w-6 text-slate-600" />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Tipo de plantilla */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Tipo de plantilla <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.template_type}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  template_type: e.target.value as TemplateType,
                }))
              }
              className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]"
              required
            >
              {(Object.entries(TEMPLATE_TYPE_LABELS) as [TemplateType, string][]).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Selecciona el tipo de sección donde se usará esta plantilla
            </p>
          </div>

          {/* Texto de la plantilla */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Texto de la plantilla <span className="text-red-500">*</span>
            </label>
            <textarea
              value={formData.text}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, text: e.target.value }))
              }
              rows={8}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91]"
              placeholder="Escribe el texto de la plantilla..."
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              Este texto se podrá insertar rápidamente en tus informes técnicos
            </p>
          </div>

          {/* Estado */}
          <div>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, active: e.target.checked }))
                }
                className="w-4 h-4 rounded border-slate-300 text-[#0A3D91] focus:ring-2 focus:ring-[#0A3D91]"
              />
              <span className="text-sm text-slate-700">Plantilla activa</span>
            </label>
            <p className="text-xs text-slate-500 mt-1 ml-6">
              Solo las plantillas activas aparecerán disponibles para usar
            </p>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#0A3D91] text-white hover:bg-[#083777] disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {saving ? "Guardando..." : "Guardar plantilla"}
          </button>
        </div>
      </div>
    </div>
  );
}