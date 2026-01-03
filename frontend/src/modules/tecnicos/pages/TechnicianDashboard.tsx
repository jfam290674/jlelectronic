// src/modules/tecnicos/pages/TechnicianDashboard.tsx
/**
 * Dashboard principal para técnicos.
 * CORRECCIÓN: Removidos conflictos bg-white vs bg-blue-50/bg-green-50
 */

import * as React from "react";
import { Link } from "react-router-dom";
import {
  PlusCircleIcon,
  DocumentTextIcon,
  ClipboardDocumentListIcon,
  WrenchScrewdriverIcon,
  CheckCircleIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { listReports, type TechnicalReport } from "../api/reports";
import ReportStatusBadge from "../components/ReportStatusBadge";
import { toast } from "react-toastify";

export default function TechnicianDashboard(): React.ReactElement {
  const [loading, setLoading] = React.useState(true);
  const [stats, setStats] = React.useState({
    draft: 0,
    in_progress: 0,
    completed: 0,
    total: 0,
  });
  const [recentReports, setRecentReports] = React.useState<TechnicalReport[]>([]);

  React.useEffect(() => {
    let mounted = true;

    const loadDashboard = async () => {
      setLoading(true);

      try {
        const data = await listReports({ page_size: 10 });

        if (!mounted) return;

        setRecentReports(data.results);

        const statsData = {
          draft: data.results.filter((r) => r.status === "DRAFT").length,
          in_progress: data.results.filter((r) => r.status === "IN_PROGRESS").length,
          completed: data.results.filter((r) => r.status === "COMPLETED").length,
          total: data.count,
        };

        setStats(statsData);
      } catch (err: any) {
        if (mounted) {
          toast.error(err.message || "Error al cargar el dashboard");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadDashboard();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-800">
              Dashboard Técnico
            </h1>
            <p className="text-slate-600 mt-1">
              Resumen de tus informes y actividades
            </p>
          </div>

          <Link
            to="/tecnicos/reports/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] shadow-sm"
          >
            <PlusCircleIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Nuevo Informe</span>
          </Link>
        </div>

        {/* Stats Cards */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-slate-200 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-slate-100">
                  <DocumentTextIcon className="h-6 w-6 text-slate-700" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Total Informes</p>
                  <p className="text-2xl font-semibold text-slate-800">{stats.total}</p>
                </div>
              </div>
            </div>

            {/* Borradores */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-slate-100">
                  <ClipboardDocumentListIcon className="h-6 w-6 text-slate-700" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Borradores</p>
                  <p className="text-2xl font-semibold text-slate-800">{stats.draft}</p>
                </div>
              </div>
            </div>

            {/* En Progreso - CORREGIDO: removido bg-white */}
            <div className="rounded-xl p-5 shadow-sm border border-blue-200 bg-blue-50">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-blue-100">
                  <ClockIcon className="h-6 w-6 text-blue-700" />
                </div>
                <div>
                  <p className="text-sm text-blue-700">En Progreso</p>
                  <p className="text-2xl font-semibold text-blue-800">{stats.in_progress}</p>
                </div>
              </div>
            </div>

            {/* Completados - CORREGIDO: removido bg-white */}
            <div className="rounded-xl p-5 shadow-sm border border-green-200 bg-green-50">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-green-100">
                  <CheckCircleIcon className="h-6 w-6 text-green-700" />
                </div>
                <div>
                  <p className="text-sm text-green-700">Completados</p>
                  <p className="text-2xl font-semibold text-green-800">{stats.completed}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            Acciones Rápidas
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Link
              to="/tecnicos/reports/new"
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-slate-200 hover:border-[#0A3D91] hover:bg-slate-50 transition"
            >
              <PlusCircleIcon className="h-8 w-8 text-[#0A3D91]" />
              <div>
                <p className="font-medium text-slate-800">Nuevo Informe</p>
                <p className="text-xs text-slate-600">Crear informe técnico</p>
              </div>
            </Link>

            <Link
              to="/tecnicos/templates"
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-slate-200 hover:border-[#0A3D91] hover:bg-slate-50 transition"
            >
              <ClipboardDocumentListIcon className="h-8 w-8 text-[#0A3D91]" />
              <div>
                <p className="font-medium text-slate-800">Mis Plantillas</p>
                <p className="text-xs text-slate-600">Gestionar plantillas</p>
              </div>
            </Link>

            <Link
              to="/tecnicos/machines"
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-slate-200 hover:border-[#0A3D91] hover:bg-slate-50 transition"
            >
              <WrenchScrewdriverIcon className="h-8 w-8 text-[#0A3D91]" />
              <div>
                <p className="font-medium text-slate-800">Máquinas</p>
                <p className="text-xs text-slate-600">Ver máquinas</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Informes Recientes */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">
              Informes Recientes
            </h2>
            <Link
              to="/tecnicos/reports"
              className="text-sm text-[#0A3D91] hover:underline"
            >
              Ver todos →
            </Link>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-slate-200 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recentReports.length === 0 ? (
            <div className="p-12 text-center">
              <DocumentTextIcon className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No hay informes aún</p>
              <Link
                to="/tecnicos/reports/new"
                className="inline-block mt-3 px-4 py-2 rounded-lg bg-[#0A3D91] text-white hover:bg-[#083777]"
              >
                Crear primer informe
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {recentReports.map((report) => (
                <Link
                  key={report.id}
                  to={`/tecnicos/reports/${report.id}`}
                  className="block p-4 hover:bg-slate-50 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-slate-800">
                          {report.report_number}
                        </span>
                        <ReportStatusBadge status={report.status} size="sm" />
                      </div>

                      <p className="text-sm text-slate-600 truncate">
                        {report.client_info.nombre || report.client_info.name} •{" "}
                        {report.machine_info.display_label}
                      </p>

                      <p className="text-xs text-slate-500 mt-1">
                        {report.report_type_display} •{" "}
                        {new Date(report.report_date).toLocaleDateString("es-EC")}
                      </p>
                    </div>

                    <div className="text-right text-xs text-slate-500">
                      Actualizado{" "}
                      {new Date(report.updated_at).toLocaleDateString("es-EC")}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}