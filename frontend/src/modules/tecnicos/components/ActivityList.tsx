// src/modules/tecnicos/components/ActivityList.tsx
/**
 * Lista editable de actividades con snippets personalizables.
 * - Agregar actividades escribiendo libremente
 * - O insertar desde snippets personalizables (plantillas de ACTIVITY)
 * - Reordenar con drag & drop (mobile-friendly)
 * - Editar/eliminar actividades
 */

import * as React from "react";
import {
  PlusIcon,
  TrashIcon,
  Bars3Icon,
  DocumentTextIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import type { ReportActivity } from "../api/reports";
import { listTemplates, type TechnicianTemplate } from "../api/templates";

interface ActivityListProps {
  activities: ReportActivity[];
  onChange: (activities: ReportActivity[]) => void;
  label?: string;
}

export default function ActivityList({
  activities,
  onChange,
  label = "Actividades realizadas",
}: ActivityListProps): React.ReactElement {
  const [newActivity, setNewActivity] = React.useState("");
  const [snippets, setSnippets] = React.useState<TechnicianTemplate[]>([]);
  const [snippetsLoading, setSnippetsLoading] = React.useState(false);
  const [showSnippets, setShowSnippets] = React.useState(false);

  // Cargar snippets de tipo ACTIVITY al montar
  React.useEffect(() => {
    let mounted = true;

    const loadSnippets = async () => {
      setSnippetsLoading(true);
      try {
        const data = await listTemplates({
          template_type: "ACTIVITY",
          active: true,
          page_size: 50,
        });

        if (mounted) {
          setSnippets(data.results);
        }
      } catch (err) {
        console.error("Error cargando snippets:", err);
      } finally {
        if (mounted) {
          setSnippetsLoading(false);
        }
      }
    };

    loadSnippets();

    return () => {
      mounted = false;
    };
  }, []);

  const addActivity = (text?: string) => {
    const activityText = text || newActivity.trim();
    if (!activityText) return;

    const maxOrder =
      activities.length > 0 ? Math.max(...activities.map((a) => a.order)) : 0;

    onChange([
      ...activities,
      {
        activity_text: activityText,
        order: maxOrder + 1,
      },
    ]);

    if (!text) {
      setNewActivity("");
    }
  };

  const insertSnippet = (snippet: TechnicianTemplate) => {
    addActivity(snippet.text);
    setShowSnippets(false);
  };

  const removeActivity = (index: number) => {
    const updated = activities.filter((_, i) => i !== index);
    onChange(updated.map((a, i) => ({ ...a, order: i + 1 })));
  };

  const updateActivity = (index: number, text: string) => {
    const updated = [...activities];
    updated[index] = { ...updated[index], activity_text: text };
    onChange(updated);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...activities];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    onChange(updated.map((a, i) => ({ ...a, order: i + 1 })));
  };

  const moveDown = (index: number) => {
    if (index === activities.length - 1) return;
    const updated = [...activities];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    onChange(updated.map((a, i) => ({ ...a, order: i + 1 })));
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">
        {label}
      </label>

      {/* Lista de actividades */}
      <div className="space-y-2">
        {activities.map((activity, index) => (
          <div
            key={index}
            className="flex items-center gap-2 p-3 rounded-lg border border-slate-300 bg-white"
          >
            {/* Drag handle */}
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => moveUp(index)}
                disabled={index === 0}
                className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Subir"
              >
                ▲
              </button>
              <Bars3Icon className="h-4 w-4 text-slate-400" />
              <button
                type="button"
                onClick={() => moveDown(index)}
                disabled={index === activities.length - 1}
                className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Bajar"
              >
                ▼
              </button>
            </div>

            {/* Input editable */}
            <input
              type="text"
              value={activity.activity_text}
              onChange={(e) => updateActivity(index, e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm"
              placeholder="Descripción de la actividad"
            />

            {/* Botón eliminar */}
            <button
              type="button"
              onClick={() => removeActivity(index)}
              className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
              title="Eliminar"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          </div>
        ))}
      </div>

      {/* Input para agregar nueva actividad */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={newActivity}
            onChange={(e) => setNewActivity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addActivity();
              }
            }}
            placeholder="Nueva actividad..."
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm"
          />
          <button
            type="button"
            onClick={() => addActivity()}
            className="px-4 py-2 rounded-lg bg-[#0A3D91] text-white hover:bg-[#083777] inline-flex items-center gap-2"
          >
            <PlusIcon className="h-5 w-5" />
            Agregar
          </button>
        </div>

        {/* Botón insertar snippet */}
        {snippets.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSnippets(!showSnippets)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 inline-flex items-center justify-between text-sm text-slate-700"
            >
              <div className="flex items-center gap-2">
                <DocumentTextIcon className="h-4 w-4" />
                <span>Insertar desde mis plantillas</span>
              </div>
              <ChevronDownIcon
                className={`h-4 w-4 transition-transform ${
                  showSnippets ? "rotate-180" : ""
                }`}
              />
            </button>

            {/* Dropdown de snippets */}
            {showSnippets && (
              <>
                {/* Backdrop para cerrar */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowSnippets(false)}
                />

                {/* Lista de snippets */}
                <div className="absolute z-20 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {snippets.map((snippet) => (
                    <button
                      key={snippet.id}
                      type="button"
                      onClick={() => insertSnippet(snippet)}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-200 last:border-b-0 transition"
                    >
                      <div className="text-sm text-slate-900 line-clamp-2">
                        {snippet.text}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Mensaje si no hay snippets */}
        {!snippetsLoading && snippets.length === 0 && (
          <p className="text-xs text-slate-500">
            Tip: Crea plantillas de actividades en "Mis Plantillas" para
            insertarlas rápidamente
          </p>
        )}
      </div>
    </div>
  );
}