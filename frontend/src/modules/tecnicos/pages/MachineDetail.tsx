// src/modules/tecnicos/pages/MachineDetail.tsx
/**
 * Vista de detalle de una máquina.
 * - Información completa del registro
 * - Botones: Editar, Eliminar, Volver
 * - Historial de informes relacionados (placeholder)
 */

import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
  BuildingOfficeIcon,
  ClipboardDocumentListIcon,
} from "@heroicons/react/24/outline";
import { getMachine, deleteMachine, type Machine } from "../api/machines";
import { toast } from "react-toastify";

export default function MachineDetail(): React.ReactElement {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = React.useState(true);
  const [machine, setMachine] = React.useState<Machine | null>(null);

  // Cargar máquina
  React.useEffect(() => {
    if (!id) {
      navigate("/tecnicos/machines");
      return;
    }

    let mounted = true;

    const loadMachine = async () => {
      setLoading(true);

      try {
        const data = await getMachine(parseInt(id, 10));

        if (mounted) {
          setMachine(data);
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
  }, [id, navigate]);

  // Eliminar máquina
  const handleDelete = async () => {
    if (!machine) return;

    if (
      !window.confirm(
        `¿Eliminar máquina "${machine.display_label}"?\n\nEsta acción no se puede deshacer y se perderá todo el historial asociado.`
      )
    ) {
      return;
    }

    try {
      await deleteMachine(machine.id);
      toast.success("Máquina eliminada");
      navigate("/tecnicos/machines");
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar la máquina");
    }
  };

  // Loading state
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

  // Si no hay máquina (no debería pasar por el redirect en el useEffect)
  if (!machine) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <WrenchScrewdriverIcon className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600">Máquina no encontrada</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <button
              onClick={() => navigate("/tecnicos/machines")}
              className="mt-1 p-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white flex-shrink-0"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl md:text-3xl font-semibold text-slate-800 truncate">
                {machine.display_label}
              </h1>
              <p className="text-slate-600 mt-1">Información de la máquina</p>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to={`/tecnicos/machines/${machine.id}/edit`}
              className="p-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white"
              title="Editar"
            >
              <PencilIcon className="h-5 w-5" />
            </Link>

            <button
              onClick={handleDelete}
              className="p-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
              title="Eliminar"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Información Principal */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <WrenchScrewdriverIcon className="h-5 w-5" />
              Datos de la Máquina
            </h2>
          </div>

          <div className="p-6 space-y-5">
            {/* Cliente */}
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                Cliente
              </label>
              <div className="flex items-center gap-2">
                <BuildingOfficeIcon className="h-5 w-5 text-slate-400" />
                <span className="text-slate-800 font-medium">
                  {machine.client_name || `Cliente #${machine.client}`}
                </span>
              </div>
            </div>

            {/* Nombre */}
            {machine.name && (
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Nombre
                </label>
                <p className="text-slate-800">{machine.name}</p>
              </div>
            )}

            {/* Marca / Modelo */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {machine.brand && (
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">
                    Marca
                  </label>
                  <p className="text-slate-800">{machine.brand}</p>
                </div>
              )}

              {machine.model && (
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">
                    Modelo
                  </label>
                  <p className="text-slate-800">{machine.model}</p>
                </div>
              )}
            </div>

            {/* Serie */}
            {machine.serial && (
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Número de Serie
                </label>
                <p className="text-slate-800 font-mono">{machine.serial}</p>
              </div>
            )}

            {/* Finalidad */}
            {machine.purpose && (
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Finalidad
                </label>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    machine.purpose === "REPARACION"
                      ? "bg-blue-100 text-blue-700"
                      : machine.purpose === "FABRICACION"
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {machine.purpose === "REPARACION"
                    ? "Reparación"
                    : machine.purpose === "FABRICACION"
                    ? "Fabricación"
                    : machine.purpose}
                </span>
              </div>
            )}

            {/* Notas */}
            {machine.notes && (
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Notas
                </label>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-slate-700 whitespace-pre-wrap">{machine.notes}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Historial de Informes (Placeholder) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <ClipboardDocumentListIcon className="h-5 w-5" />
              Historial de Informes
            </h2>
          </div>

          <div className="p-12 text-center">
            <ClipboardDocumentListIcon className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 mb-1">
              Aún no hay informes para esta máquina
            </p>
            <p className="text-sm text-slate-500">
              Los informes técnicos asociados aparecerán aquí
            </p>
          </div>
        </div>

        {/* Botones de acción inferiores */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => navigate("/tecnicos/machines")}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white inline-flex items-center gap-2"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Volver al listado
          </button>

          <div className="flex items-center gap-2">
            <Link
              to={`/tecnicos/machines/${machine.id}/edit`}
              className="px-4 py-2 rounded-lg bg-[#0A3D91] text-white hover:bg-[#083777] inline-flex items-center gap-2"
            >
              <PencilIcon className="h-4 w-4" />
              Editar
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}