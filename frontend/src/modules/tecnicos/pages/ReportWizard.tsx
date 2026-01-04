// src/modules/tecnicos/pages/ReportWizard.tsx
/**
 * Wizard multi-paso para crear/editar informes técnicos.
 * VERSIÓN PROFESIONAL con UI/UX mobile-first y MAESTRO v9.0 compliance.
 * 
 * COMPLIANCE:
 * - WCAG 2.2 AA (AAA en flujos críticos)
 * - prefers-reduced-motion respetado
 * - Touch targets ≥48px
 * - Focus visible en todos los elementos
 * - ARIA roles correctos
 * 
 * PASOS:
 * 1. Datos básicos (tipo, cliente, máquina con creación inline, fecha, ciudad, persona)
 * 2. Detalles técnicos (historial, diagnóstico, observaciones, recomendaciones con snippets)
 * 3. Actividades realizadas (con snippets personalizables)
 * 4. Repuestos usados (integración bodega + manual)
 * 5. Fotografías (BEFORE/DURING/AFTER con metadata)
 * 6. Firmas (técnico y cliente)
 * 7. Configurador PDF (seleccionar secciones, fotos, orden)
 * 
 * MEJORAS v2:
 * - Desktop stepper responsivo con scroll horizontal
 * - Modal de finalización con opciones PDF/WhatsApp/Email
 * - Status correcto: IN_PROGRESS al guardar
 */

import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusCircleIcon,
  DocumentTextIcon,
  CameraIcon,
  ClipboardDocumentCheckIcon,
  Cog6ToothIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import {
  getReport,
  createReport,
  updateReport,
  uploadReportPhoto,
  type ReportCreateData,
  type ReportUpdateData,
  type ReportType,
  type ReportSpare,
} from "../api/reports";
import { listClients, type Client } from "../api/clients";
import { listTemplates, type TechnicianTemplate, type TemplateType } from "../api/templates";
import MachineSelector from "../components/MachineSelector";
import MachineInlineForm from "../components/MachineInlineForm";
import ActivityList from "../components/ActivityList";
import SparePartsList from "../components/SparePartsList";
import PhotoCapture, { type PhotoData } from "../components/PhotoCapture";
import SignatureCanvas from "../components/SignatureCanvas";
import { toast } from "react-toastify";

// ===========================
// TIPOS LOCALES
// ===========================

interface WizardState {
  // Paso 1: Datos básicos
  report_type: ReportType;
  client: number | null;
  machine: number | null;
  report_date: string;
  visit_date: string;  // 🆕 NUEVO: Fecha de visita técnica
  city: string;
  person_in_charge: string;
  requested_by: string;  // 🆕 NUEVO: Persona que solicita el servicio

  // Paso 2: Detalles técnicos
  history_state: string;
  diagnostic: string;
  observations: string;
  recommendations: string;
  show_recommendations_in_report: boolean;

  // Paso 3: Actividades
  activities: Array<{ activity_text: string; order: number }>;

  // Paso 4: Repuestos (usando ReportSpare del API)
  spares: ReportSpare[];

  // Paso 5: Fotografías
  photos: PhotoData[];

  // Paso 6: Firmas
  technician_signature: string;
  technician_signature_name: string;
  technician_signature_id: string;
  client_signature: string;
  client_signature_name: string;
  client_signature_id: string;

  // Paso 7: Configuración PDF
  pdf_configuration: {
    sections: string[];
    photo_ids: number[];
    order: string[];
  };
}

const INITIAL_STATE: WizardState = {
  report_type: "CORRECTIVE",
  client: null,
  machine: null,
  report_date: new Date().toISOString().split("T")[0],
  visit_date: "",  // 🆕 NUEVO: Sin fecha por defecto (usuario debe seleccionar)
  city: "",
  person_in_charge: "",
  requested_by: "",  // 🆕 NUEVO: Persona que solicita (opcional)
  history_state: "",
  diagnostic: "",
  observations: "",
  recommendations: "",
  show_recommendations_in_report: true,
  activities: [],
  spares: [],
  photos: [],
  technician_signature: "",
  technician_signature_name: "",
  technician_signature_id: "",
  client_signature: "",
  client_signature_name: "",
  client_signature_id: "",
  pdf_configuration: {
    sections: ["history_state", "diagnostic", "activities", "spares", "observations", "recommendations"],
    photo_ids: [],
    order: [],
  },
};

const STEPS = [
  { id: 1, label: "Datos básicos", icon: ClipboardDocumentCheckIcon },
  { id: 2, label: "Detalles técnicos", icon: DocumentTextIcon },
  { id: 3, label: "Actividades", icon: CheckCircleIcon },
  { id: 4, label: "Repuestos", icon: Cog6ToothIcon },
  { id: 5, label: "Fotografías", icon: CameraIcon },
  { id: 6, label: "Firmas", icon: DocumentTextIcon },
  { id: 7, label: "Configurar PDF", icon: Cog6ToothIcon },
];

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  PREVENTIVE: "Preventivo",
  CORRECTIVE: "Correctivo",
  TECHNICAL_VISIT: "Visita Técnica",
  WARRANTY: "Garantía",
};

// ===========================
// COMPONENTE PRINCIPAL
// ===========================

export default function ReportWizard(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!params.id;
  const reportId = params.id ? parseInt(params.id, 10) : null;

  const [loading, setLoading] = React.useState(isEdit);
  const [saving, setSaving] = React.useState(false);
  const [currentStep, setCurrentStep] = React.useState(1);
  const [state, setState] = React.useState<WizardState>(INITIAL_STATE);
  const [clients, setClients] = React.useState<Client[]>([]);
  const [showMachineModal, setShowMachineModal] = React.useState(false);
  const [machineRefreshKey, setMachineRefreshKey] = React.useState(0);
  
  // 🆕 MODAL DE FINALIZACIÓN
  const [showFinishModal, setShowFinishModal] = React.useState(false);

  // Cargar datos en modo edición
  React.useEffect(() => {
    if (!isEdit || !reportId) return;

    let mounted = true;

    (async () => {
      try {
        const report = await getReport(reportId);

        if (!mounted) return;

        setState({
          report_type: report.report_type,
          client: report.client,
          machine: report.machine,
          report_date: report.report_date,
          visit_date: report.visit_date || "",  // 🆕 NUEVO
          city: report.city || "",
          person_in_charge: report.person_in_charge || "",
          history_state: report.history_state || "",
          requested_by: report.requested_by || "",  // 🆕 NUEVO
          diagnostic: report.diagnostic || "",
          observations: report.observations || "",
          recommendations: report.recommendations || "",
          show_recommendations_in_report: report.show_recommendations_in_report,
          activities: report.activities || [],
          spares: (report.spares || []).map((s) => ({
            ...s,
            product: s.product ?? null,
          })) as ReportSpare[],
          photos: (report.photos || []).map((p) => ({
            preview: p.photo || "",
            photo_type: p.photo_type || "DURING",
            notes: p.notes || "",
            include_in_report: p.include_in_report ?? true,
            order: p.order ?? 0,
          })),
          technician_signature: report.technician_signature || "",
          technician_signature_name: report.technician_signature_name || "",
          technician_signature_id: report.technician_signature_id || "",
          client_signature: report.client_signature || "",
          client_signature_name: report.client_signature_name || "",
          client_signature_id: report.client_signature_id || "",
          pdf_configuration: {
            sections: report.pdf_configuration?.sections || INITIAL_STATE.pdf_configuration.sections,
            photo_ids: report.pdf_configuration?.photo_ids || [],
            order: report.pdf_configuration?.order || [],
          },
        });
      } catch (err: any) {
        toast.error(err.message || "Error al cargar el informe");
        navigate("/tecnicos/reports");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isEdit, reportId, navigate]);

  // Cargar lista de clientes
  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const data = await listClients({ page_size: 1000 });
        if (mounted) setClients(data.results || []);
      } catch {
        // Silencioso
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // ===========================
  // VALIDACIONES POR PASO
  // ===========================

  const validateStep = (step: number): { valid: boolean; error?: string } => {
    if (step === 1) {
      if (!state.report_type) return { valid: false, error: "Selecciona el tipo de informe" };
      if (!state.client) return { valid: false, error: "Selecciona un cliente" };
      if (!state.machine) return { valid: false, error: "Selecciona o crea una máquina" };
      if (!state.report_date) return { valid: false, error: "Ingresa la fecha del informe" };
      if (!state.visit_date) return { valid: false, error: "Ingresa la fecha de la visita técnica" };  // 🆕 NUEVO
    }

    if (step === 2) {
      if (!state.diagnostic.trim()) {
        return { valid: false, error: "El diagnóstico es obligatorio" };
      }
      
      if (state.show_recommendations_in_report && !state.recommendations.trim()) {
        return {
          valid: false,
          error: "Si marcaste 'Mostrar recomendaciones', debes escribir las recomendaciones o desmarca la opción",
        };
      }
    }

    if (step === 3) {
      if (state.activities.length === 0) {
        return { valid: false, error: "Agrega al menos una actividad realizada" };
      }
    }

    return { valid: true };
  };

  // ===========================
  // NAVEGACIÓN
  // ===========================

  const handleNext = () => {
    const validation = validateStep(currentStep);
    if (!validation.valid) {
      toast.error(validation.error, {
        position: "top-center",
        autoClose: 3000,
        style: {
          background: "#FEE2E2",
          color: "#991B1B",
          borderRadius: "12px",
        },
      });
      return;
    }

    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleGoToStep = (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // ===========================
  // GUARDADO
  // ===========================

  const handleSave = async (goBack = false) => {
    const validation = validateStep(currentStep);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    setSaving(true);

    try {
      // 🔧 Payload con status (backend acepta este campo)
      const basePayload: ReportCreateData | ReportUpdateData = {
        report_type: state.report_type,
        client: state.client!,
        machine: state.machine!,
        report_date: state.report_date,
        visit_date: state.visit_date || null,  // 🆕 NUEVO
        city: state.city,
        person_in_charge: state.person_in_charge,
        requested_by: state.requested_by,  // 🆕 NUEVO
        history_state: state.history_state,
        diagnostic: state.diagnostic,
        observations: state.observations,
        recommendations: state.recommendations,
        show_recommendations_in_report: state.show_recommendations_in_report,
        activities_data: state.activities,
        spares_data: state.spares,
        technician_signature: state.technician_signature,
        technician_signature_name: state.technician_signature_name,
        technician_signature_id: state.technician_signature_id,
        client_signature: state.client_signature,
        client_signature_name: state.client_signature_name,
        client_signature_id: state.client_signature_id,
        pdf_configuration: state.pdf_configuration,
      };
      
      // 🆕 Agregar status (backend lo acepta, tipos TS pendientes de actualizar)
      const payload = { ...basePayload, status: "IN_PROGRESS" as const };

      // Debug: Payload enviado (comentado para producción)

      if (isEdit && reportId) {
        await updateReport(reportId, payload);
        
        // ✅ SUBIR FOTOS NUEVAS
        for (const photo of state.photos) {
          if (photo.file) {
            try {
              await uploadReportPhoto(reportId, photo.file, {
                photo_type: photo.photo_type,
                notes: photo.notes,
                include_in_report: photo.include_in_report,
                order: photo.order,
              });
            } catch (err: any) {
              console.error("Error subiendo foto:", (err as any)?.message || err);
              toast.warning(`No se pudo subir una foto: ${err.message}`);
            }
          }
        }

        toast.success("✅ Informe actualizado correctamente", {
          position: "top-center",
          autoClose: 2000,
        });
      } else {
        const created = await createReport(payload);
        
        // Debug: Informe creado exitosamente

        // ✅ SUBIR FOTOS NUEVAS
        for (const photo of state.photos) {
          if (photo.file) {
            try {
              await uploadReportPhoto(created.id, photo.file, {
                photo_type: photo.photo_type,
                notes: photo.notes,
                include_in_report: photo.include_in_report,
                order: photo.order,
              });
            } catch (err: any) {
              console.error("Error subiendo foto:", (err as any)?.message || err);
              toast.warning(`No se pudo subir una foto: ${err.message}`);
            }
          }
        }

        toast.success("✅ Informe creado correctamente", {
          position: "top-center",
          autoClose: 2000,
        });

        if (goBack) {
          navigate("/tecnicos/reports");
        } else {
          navigate(`/tecnicos/reports/${created.id}/edit`, { replace: true });
        }
        return;
      }

      if (goBack) {
        navigate("/tecnicos/reports");
      }
    } catch (err: any) {
      console.error("Error al guardar:", (err as any)?.response?.data?.detail || (err as any)?.message);
      
      let errorMessage = "❌ Error al guardar el informe";
      if (err.response?.data) {
        const errorData = err.response.data;
        if (typeof errorData === "object") {
          const errors = Object.entries(errorData)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ");
          errorMessage = `❌ ${errors}`;
        }
      } else if (err.message) {
        errorMessage = `❌ ${err.message}`;
      }

      toast.error(errorMessage, {
        position: "top-center",
        autoClose: 6000,
      });
    } finally {
      setSaving(false);
    }
  };

  // 🆕 FINALIZAR CON OPCIONES
  const handleFinish = () => {
    const validation = validateStep(currentStep);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }
    
    setShowFinishModal(true);
  };

  const handleFinishAction = async (action: "save" | "pdf" | "whatsapp" | "email") => {
    setShowFinishModal(false);
    await handleSave(action === "save");
    
    if (action !== "save") {
      // Aquí puedes agregar lógica para generar PDF, enviar WhatsApp, etc.
      toast.info(`Función ${action} en desarrollo`);
    }
  };

  // Skeleton loader
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="mx-auto max-w-5xl px-4 py-6" role="status" aria-live="polite" aria-label="Cargando informe">
          <div className="h-10 w-64 bg-slate-200 rounded-xl motion-safe:animate-pulse mb-6" />
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 space-y-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-slate-200 rounded-xl motion-safe:animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const progressPercentage = (currentStep / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        {/* Skip to content link for keyboard navigation */}
        <a
          href="#wizard-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:bg-[#0A3D91] focus:text-white focus:rounded-lg focus:top-4 focus:left-4"
        >
          Ir al contenido principal
        </a>

        {/* Header with Progress */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Link
              to="/tecnicos/reports"
              className="p-2.5 rounded-xl border-2 border-slate-300 hover:border-[#0A3D91] hover:bg-white motion-safe:transition-all motion-safe:duration-200 group focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
              title="Volver a lista de informes"
              aria-label="Volver a lista de informes"
            >
              <ArrowLeftIcon className="h-5 w-5 text-slate-600 group-hover:text-[#0A3D91]" />
            </Link>

            <div className="flex-1">
              <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
                {isEdit ? "Editar Informe" : "Nuevo Informe Técnico"}
              </h1>
              <p className="text-slate-600 mt-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0A3D91] text-white text-sm font-medium">
                  Paso {currentStep} de {STEPS.length}
                </span>
                <span className="hidden sm:inline">• {STEPS[currentStep - 1].label}</span>
              </p>
            </div>
          </div>

          {/* Animated Progress Bar - WCAG compliant */}
          <div
            className="relative h-3 bg-slate-200 rounded-full overflow-hidden shadow-inner"
            role="progressbar"
            aria-valuenow={progressPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progreso del formulario: ${Math.round(progressPercentage)}%`}
          >
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#0A3D91] to-[#0d4bb8] rounded-full motion-safe:transition-all motion-safe:duration-500 motion-safe:ease-out"
              style={{ width: `${progressPercentage}%` }}
            >
              <div className="absolute inset-0 bg-white/20 motion-safe:animate-pulse" />
            </div>
          </div>
        </div>

        {/* 🆕 Desktop Stepper RESPONSIVO con scroll horizontal */}
        <nav 
          className="hidden lg:block bg-white rounded-2xl shadow-lg border border-slate-200 p-6 overflow-x-auto" 
          aria-label="Progreso del formulario"
        >
          <ol className="flex items-center gap-3 min-w-max">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isActive = step.id === currentStep;
              const isCompleted = step.id < currentStep;

              return (
                <React.Fragment key={step.id}>
                  <li className="flex-shrink-0">
                    <button
                      onClick={() => handleGoToStep(step.id)}
                      disabled={step.id > currentStep}
                      aria-current={isActive ? "step" : undefined}
                      aria-disabled={step.id > currentStep}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl motion-safe:transition-all motion-safe:duration-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 whitespace-nowrap ${
                        isActive
                          ? "bg-[#0A3D91] text-white shadow-lg motion-safe:scale-105"
                          : isCompleted
                          ? "bg-green-50 text-green-700 hover:bg-green-100 motion-safe:hover:scale-105"
                          : "bg-slate-50 text-slate-500 cursor-not-allowed opacity-60"
                      }`}
                    >
                      <div
                        className={`flex items-center justify-center w-10 h-10 rounded-xl text-sm font-bold ${
                          isActive
                            ? "bg-white text-[#0A3D91]"
                            : isCompleted
                            ? "bg-green-600 text-white"
                            : "bg-slate-200 text-slate-500"
                        }`}
                        aria-hidden="true"
                      >
                        {isCompleted ? (
                          <CheckCircleIcon className="h-6 w-6" />
                        ) : (
                          <Icon className="h-6 w-6" />
                        )}
                      </div>
                      <span className="text-sm font-medium">{step.label}</span>
                    </button>
                  </li>

                  {index < STEPS.length - 1 && (
                    <div
                      className={`flex-shrink-0 w-12 h-1 rounded-full motion-safe:transition-all motion-safe:duration-300 ${
                        step.id < currentStep ? "bg-green-600" : "bg-slate-200"
                      }`}
                      aria-hidden="true"
                    />
                  )}
                </React.Fragment>
              );
            })}
          </ol>
        </nav>

        {/* Mobile Stepper */}
        <div className="lg:hidden bg-white rounded-2xl shadow-lg border border-slate-200 p-4" role="region" aria-label="Progreso móvil">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-700">
              Progreso
            </span>
            <span className="text-sm font-bold text-[#0A3D91]" aria-live="polite">
              {Math.round(progressPercentage)}%
            </span>
          </div>
          <div className="flex gap-1.5" role="list" aria-label="Pasos del formulario">
            {STEPS.map((step) => (
              <div
                key={step.id}
                role="listitem"
                aria-label={`${step.label} - ${step.id === currentStep ? 'actual' : step.id < currentStep ? 'completado' : 'pendiente'}`}
                className={`flex-1 h-2 rounded-full motion-safe:transition-all motion-safe:duration-300 ${
                  step.id === currentStep
                    ? "bg-[#0A3D91] motion-safe:scale-110"
                    : step.id < currentStep
                    ? "bg-green-600"
                    : "bg-slate-200"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Contenido del paso actual */}
        <main id="wizard-content" className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 md:p-8 min-h-[500px]">
          <div className="motion-safe:animate-fadeIn">
            {currentStep === 1 && (
              <Step1BasicData
                state={state}
                setState={setState}
                clients={clients}
                onShowMachineModal={() => setShowMachineModal(true)}
                machineRefreshKey={machineRefreshKey}
              />
            )}

            {currentStep === 2 && (
              <Step2TechnicalDetails
                state={state}
                setState={setState}
              />
            )}

            {currentStep === 3 && (
              <Step3Activities
                activities={state.activities}
                onChange={(activities) => setState((prev) => ({ ...prev, activities }))}
              />
            )}

            {currentStep === 4 && (
              <Step4Spares
                spares={state.spares}
                onChange={(spares) => setState((prev) => ({ ...prev, spares }))}
              />
            )}

            {currentStep === 5 && (
              <Step5Photos
                photos={state.photos}
                onChange={(photos) => setState((prev) => ({ ...prev, photos }))}
              />
            )}

            {currentStep === 6 && (
              <Step6Signatures
                state={state}
                setState={setState}
              />
            )}

            {currentStep === 7 && (
              <Step7PDFConfiguration
                state={state}
                setState={setState}
              />
            )}
          </div>
        </main>

        {/* Navigation Buttons */}
        <nav className="flex items-center justify-between gap-4 pb-6" aria-label="Navegación del formulario">
          <button
            onClick={handlePrev}
            disabled={currentStep === 1}
            aria-label="Ir al paso anterior"
            className="min-h-[48px] px-6 py-3 rounded-xl border-2 border-slate-300 text-slate-700 font-medium hover:bg-white hover:border-[#0A3D91] hover:text-[#0A3D91] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-slate-300 disabled:hover:text-slate-700 motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
          >
            <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Anterior</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              aria-label="Guardar borrador del informe"
              className="min-h-[48px] px-6 py-3 rounded-xl border-2 border-slate-300 text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 motion-safe:transition-all motion-safe:duration-200 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
            >
              {saving ? "Guardando..." : "Guardar borrador"}
            </button>

            {currentStep < STEPS.length ? (
              <button
                onClick={handleNext}
                aria-label="Ir al siguiente paso"
                className="min-h-[48px] px-6 py-3 rounded-xl bg-gradient-to-r from-[#0A3D91] to-[#0d4bb8] text-white font-medium hover:shadow-lg motion-safe:hover:scale-105 motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
              >
                <span>Siguiente</span>
                <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={saving}
                aria-label="Finalizar y guardar informe"
                className="min-h-[48px] px-8 py-3 rounded-xl bg-gradient-to-r from-green-600 to-green-700 text-white font-bold hover:shadow-xl motion-safe:hover:scale-105 disabled:opacity-50 motion-safe:disabled:hover:scale-100 motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
              >
                <CheckCircleIcon className="h-6 w-6" aria-hidden="true" />
                <span>Finalizar Informe</span>
              </button>
            )}
          </div>
        </nav>
      </div>

      {/* Machine Creation Modal */}
      <MachineInlineForm
        clientId={state.client}
        isOpen={showMachineModal}
        onClose={() => setShowMachineModal(false)}
        onSuccess={(machineId) => {
          setState((prev) => ({ ...prev, machine: machineId }));
          setMachineRefreshKey((prev) => prev + 1);
          setShowMachineModal(false);
          toast.success("✅ Máquina creada correctamente");
        }}
      />

      {/* 🆕 MODAL DE FINALIZACIÓN */}
      {showFinishModal && (
        <FinishModal
          onClose={() => setShowFinishModal(false)}
          onAction={handleFinishAction}
          saving={saving}
        />
      )}
    </div>
  );
}

// ===========================
// 🆕 MODAL DE FINALIZACIÓN
// ===========================

function FinishModal({
  onClose,
  onAction,
  saving,
}: {
  onClose: () => void;
  onAction: (action: "save" | "pdf" | "whatsapp" | "email") => void;
  saving: boolean;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-labelledby="finish-modal-title"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-6 motion-safe:animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 id="finish-modal-title" className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <CheckCircleIcon className="h-7 w-7 text-green-600" />
              <span>Finalizar Informe</span>
            </h2>
            <p className="text-slate-600 mt-2 text-sm">
              Elige cómo deseas continuar después de guardar
            </p>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 motion-safe:transition-colors"
            aria-label="Cerrar modal"
          >
            <XMarkIcon className="h-6 w-6 text-slate-500" />
          </button>
        </div>

        {/* Opciones */}
        <div className="space-y-3">
          <button
            onClick={() => onAction("pdf")}
            disabled={saving}
            className="w-full min-h-[60px] p-4 rounded-xl border-2 border-slate-200 hover:border-[#0A3D91] hover:bg-slate-50 text-left motion-safe:transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <DocumentTextIcon className="h-6 w-6 text-blue-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900">Ver y enviar PDF</div>
                <div className="text-sm text-slate-600">Generar informe y compartir</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => onAction("whatsapp")}
            disabled={saving}
            className="w-full min-h-[60px] p-4 rounded-xl border-2 border-slate-200 hover:border-green-600 hover:bg-green-50 text-left motion-safe:transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                <PaperAirplaneIcon className="h-6 w-6 text-green-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900">Enviar por WhatsApp</div>
                <div className="text-sm text-slate-600">Compartir directamente al cliente</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => onAction("email")}
            disabled={saving}
            className="w-full min-h-[60px] p-4 rounded-xl border-2 border-slate-200 hover:border-indigo-600 hover:bg-indigo-50 text-left motion-safe:transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                <EnvelopeIcon className="h-6 w-6 text-indigo-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900">Enviar por Email</div>
                <div className="text-sm text-slate-600">Enviar a correo electrónico</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => onAction("save")}
            disabled={saving}
            className="w-full min-h-[60px] p-4 rounded-xl border-2 border-slate-300 hover:border-slate-400 hover:bg-slate-50 text-left motion-safe:transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                <CheckCircleIcon className="h-6 w-6 text-slate-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900">Solo guardar</div>
                <div className="text-sm text-slate-600">Finalizar sin enviar</div>
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="w-full min-h-[48px] px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 motion-safe:transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================
// PASO 1: DATOS BÁSICOS
// ===========================

function Step1BasicData({
  state,
  setState,
  clients,
  onShowMachineModal,
  machineRefreshKey,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  clients: Client[];
  onShowMachineModal: () => void;
  machineRefreshKey: number;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Información básica del informe
        </h2>
        <p className="text-slate-600">
          Completa los datos principales del servicio técnico
        </p>
      </div>

      {/* Tipo de informe */}
      <fieldset className="space-y-2">
        <legend className="block text-sm font-semibold text-slate-700">
          Tipo de informe <span className="text-red-600" aria-label="obligatorio">*</span>
        </legend>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="group" aria-label="Seleccionar tipo de informe">
          {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setState((prev) => ({ ...prev, report_type: type }))}
              aria-pressed={state.report_type === type}
              className={`min-h-[48px] p-4 rounded-xl border-2 font-medium motion-safe:transition-all motion-safe:duration-200 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 ${
                state.report_type === type
                  ? "border-[#0A3D91] bg-[#0A3D91] text-white shadow-lg motion-safe:scale-105"
                  : "border-slate-300 bg-white text-slate-700 hover:border-[#0A3D91] motion-safe:hover:scale-105"
              }`}
            >
              {REPORT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Cliente */}
      <div className="space-y-2">
        <label htmlFor="client-select" className="block text-sm font-semibold text-slate-700">
          Cliente <span className="text-red-600" aria-label="obligatorio">*</span>
        </label>
        <select
          id="client-select"
          value={state.client || ""}
          onChange={(e) =>
            setState((prev) => ({
              ...prev,
              client: e.target.value ? parseInt(e.target.value, 10) : null,
              machine: null,
            }))
          }
          className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all motion-safe:duration-200 text-base"
          aria-required="true"
        >
          <option value="">Selecciona un cliente</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre || c.name || c.razon_social}
            </option>
          ))}
        </select>
      </div>

      {/* Máquina con creación inline */}
      {state.client && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="machine-select" className="block text-sm font-semibold text-slate-700">
              Máquina <span className="text-red-600" aria-label="obligatorio">*</span>
            </label>
            <button
              type="button"
              onClick={onShowMachineModal}
              className="inline-flex items-center gap-2 min-h-[48px] px-4 py-2 rounded-lg bg-green-50 text-green-700 border-2 border-green-200 hover:bg-green-100 hover:border-green-300 motion-safe:transition-all motion-safe:duration-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
              aria-label="Crear nueva máquina"
            >
              <PlusCircleIcon className="h-5 w-5" aria-hidden="true" />
              <span>Nueva máquina</span>
            </button>
          </div>
          <MachineSelector
            key={machineRefreshKey}
            clientId={state.client}
            value={state.machine}
            onChange={(machineId) =>
              setState((prev) => ({ ...prev, machine: machineId }))
            }
          />
        </div>
      )}

      {/* 🆕 ACTUALIZADO: Fechas y datos de personas */}
      {/* Fila 1: Fechas (Emisión y Visita) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="report-date" className="block text-sm font-semibold text-slate-700">
            Fecha de emisión del informe <span className="text-red-600" aria-label="obligatorio">*</span>
          </label>
          <input
            type="date"
            id="report-date"
            value={state.report_date}
            onChange={(e) =>
              setState((prev) => ({ ...prev, report_date: e.target.value }))
            }
            aria-required="true"
            className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all motion-safe:duration-200"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="visit-date" className="block text-sm font-semibold text-slate-700">
            Fecha de la visita técnica <span className="text-red-600" aria-label="obligatorio">*</span>
          </label>
          <input
            type="date"
            id="visit-date"
            value={state.visit_date}
            onChange={(e) =>
              setState((prev) => ({ ...prev, visit_date: e.target.value }))
            }
            aria-required="true"
            className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all motion-safe:duration-200"
          />
          <p className="text-xs text-slate-600 mt-1">
            Fecha real en que se realizó la visita al cliente
          </p>
        </div>
      </div>

      {/* Fila 2: Ciudad, Responsable, Solicitante */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <label htmlFor="city" className="block text-sm font-semibold text-slate-700">
            Ciudad
          </label>
          <input
            type="text"
            id="city"
            value={state.city}
            onChange={(e) =>
              setState((prev) => ({ ...prev, city: e.target.value }))
            }
            placeholder="Ej: Quito"
            className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all motion-safe:duration-200"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="person-in-charge" className="block text-sm font-semibold text-slate-700">
            Persona a cargo
          </label>
          <input
            type="text"
            id="person-in-charge"
            value={state.person_in_charge}
            onChange={(e) =>
              setState((prev) => ({ ...prev, person_in_charge: e.target.value }))
            }
            placeholder="Responsable del cliente"
            className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all motion-safe:duration-200"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="requested-by" className="block text-sm font-semibold text-slate-700">
            Solicitado por
          </label>
          <input
            type="text"
            id="requested-by"
            value={state.requested_by}
            onChange={(e) =>
              setState((prev) => ({ ...prev, requested_by: e.target.value }))
            }
            placeholder="Persona que solicita el servicio"
            className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all motion-safe:duration-200"
          />
          <p className="text-xs text-slate-600 mt-1">
            Puede ser diferente de la persona a cargo
          </p>
        </div>
      </div>
    </div>
  );
}

// ===========================
// PASO 2: DETALLES TÉCNICOS
// ===========================

function Step2TechnicalDetails({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}): React.ReactElement {
  const [snippets, setSnippets] = React.useState<Record<string, TechnicianTemplate[]>>({
    STATE: [],
    DIAGNOSTIC: [],
    OBSERVATION: [],
    RECOMMENDATION: [],
  });

  React.useEffect(() => {
    (async () => {
      try {
        const types: TemplateType[] = [
          "STATE",
          "DIAGNOSTIC",
          "OBSERVATION",
          "RECOMMENDATION",
        ];

        const results = await Promise.all(
          types.map((type) =>
            listTemplates({ template_type: type, active: true, page_size: 50 })
          )
        );

        setSnippets({
          STATE: results[0].results,
          DIAGNOSTIC: results[1].results,
          OBSERVATION: results[2].results,
          RECOMMENDATION: results[3].results,
        });
      } catch (err) {
        // Error cargando snippets (no crítico)
      }
    })();
  }, []);

  const insertSnippet = (field: keyof Pick<WizardState, "history_state" | "diagnostic" | "observations" | "recommendations">, text: string) => {
    setState((prev) => ({
      ...prev,
      [field]: prev[field] ? `${prev[field]}\n${text}` : text,
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Detalles técnicos del servicio
        </h2>
        <p className="text-slate-600">
          Describe el estado, diagnóstico y observaciones del equipo
        </p>
      </div>

      <FieldWithSnippets
        label="Estado / Historial del equipo"
        value={state.history_state}
        onChange={(value) => setState((prev) => ({ ...prev, history_state: value }))}
        snippets={snippets.STATE}
        onInsertSnippet={(text) => insertSnippet("history_state", text)}
        placeholder="Describe el estado en que se encontró el equipo..."
        rows={4}
      />

      <FieldWithSnippets
        label="Diagnóstico"
        value={state.diagnostic}
        onChange={(value) => setState((prev) => ({ ...prev, diagnostic: value }))}
        snippets={snippets.DIAGNOSTIC}
        onInsertSnippet={(text) => insertSnippet("diagnostic", text)}
        placeholder="Describe el diagnóstico técnico..."
        rows={5}
        required
      />

      <FieldWithSnippets
        label="Observaciones"
        value={state.observations}
        onChange={(value) => setState((prev) => ({ ...prev, observations: value }))}
        snippets={snippets.OBSERVATION}
        onInsertSnippet={(text) => insertSnippet("observations", text)}
        placeholder="Observaciones adicionales..."
        rows={4}
      />

      <FieldWithSnippets
        label="Recomendaciones"
        value={state.recommendations}
        onChange={(value) => setState((prev) => ({ ...prev, recommendations: value }))}
        snippets={snippets.RECOMMENDATION}
        onInsertSnippet={(text) => insertSnippet("recommendations", text)}
        placeholder="Recomendaciones para el cliente..."
        rows={4}
      />

      <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 bg-slate-50 cursor-pointer hover:border-[#0A3D91] motion-safe:transition-all motion-safe:duration-200">
        <input
          type="checkbox"
          checked={state.show_recommendations_in_report}
          onChange={(e) =>
            setState((prev) => ({
              ...prev,
              show_recommendations_in_report: e.target.checked,
            }))
          }
          className="w-5 h-5 rounded border-slate-300 text-[#0A3D91] focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
        />
        <span className="text-sm font-medium text-slate-700">
          Incluir recomendaciones en el reporte PDF
        </span>
      </label>

      {state.show_recommendations_in_report && !state.recommendations.trim() && (
        <div className="p-4 rounded-xl bg-yellow-50 border-2 border-yellow-200 flex items-start gap-3" role="alert" aria-live="polite">
          <div className="flex-shrink-0 mt-0.5">
            <svg className="h-5 w-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-800">
              ⚠️ Debes escribir las recomendaciones
            </p>
            <p className="text-xs text-yellow-700 mt-1">
              Si no vas a incluir recomendaciones, desmarca la opción de arriba
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================
// CAMPO CON SNIPPETS
// ===========================

function FieldWithSnippets({
  label,
  value,
  onChange,
  snippets,
  onInsertSnippet,
  placeholder,
  rows,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  snippets: TechnicianTemplate[];
  onInsertSnippet: (text: string) => void;
  placeholder: string;
  rows: number;
  required?: boolean;
}): React.ReactElement {
  const [showSnippets, setShowSnippets] = React.useState(false);
  const fieldId = React.useId();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={fieldId} className="block text-sm font-semibold text-slate-700">
          {label} {required && <span className="text-red-600" aria-label="obligatorio">*</span>}
        </label>
        {snippets.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSnippets(!showSnippets)}
            aria-expanded={showSnippets}
            aria-controls={`${fieldId}-snippets`}
            className="inline-flex items-center gap-2 min-h-[48px] px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 motion-safe:transition-all motion-safe:duration-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2"
          >
            <DocumentTextIcon className="h-4 w-4" aria-hidden="true" />
            <span>{showSnippets ? "Ocultar" : "Ver"} plantillas ({snippets.length})</span>
          </button>
        )}
      </div>

      <textarea
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        aria-required={required}
        className="w-full px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent motion-safe:transition-all motion-safe:duration-200 resize-none"
      />

      {showSnippets && snippets.length > 0 && (
        <div id={`${fieldId}-snippets`} className="mt-2 p-4 rounded-xl border-2 border-indigo-200 bg-indigo-50 space-y-2 max-h-48 overflow-y-auto" role="region" aria-label="Plantillas disponibles">
          {snippets.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              onClick={() => {
                onInsertSnippet(snippet.text);
                setShowSnippets(false);
              }}
              className="w-full text-left px-3 py-2 rounded-lg bg-white hover:bg-indigo-100 border border-indigo-200 hover:border-indigo-300 motion-safe:transition-all motion-safe:duration-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2"
            >
              {snippet.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================
// PASO 3: ACTIVIDADES
// ===========================

function Step3Activities({
  activities,
  onChange,
}: {
  activities: Array<{ activity_text: string; order: number }>;
  onChange: (activities: Array<{ activity_text: string; order: number }>) => void;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Actividades realizadas
        </h2>
        <p className="text-slate-600">
          Registra todas las actividades ejecutadas durante el servicio
        </p>
      </div>

      <ActivityList
        activities={activities}
        onChange={onChange}
        label=""
      />
    </div>
  );
}

// ===========================
// PASO 4: REPUESTOS
// ===========================

function Step4Spares({
  spares,
  onChange,
}: {
  spares: ReportSpare[];
  onChange: (spares: ReportSpare[]) => void;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Repuestos y accesorios
        </h2>
        <p className="text-slate-600">
          Agrega los repuestos utilizados desde bodega o manualmente
        </p>
      </div>

      <SparePartsList
        spares={spares}
        onChange={onChange}
        label=""
      />
    </div>
  );
}

// ===========================
// PASO 5: FOTOGRAFÍAS
// ===========================

function Step5Photos({
  photos,
  onChange,
}: {
  photos: PhotoData[];
  onChange: (photos: PhotoData[]) => void;
}): React.ReactElement {
  const addPhoto = () => {
    const newPhoto: PhotoData = {
      preview: "",
      photo_type: "DURING",
      notes: "",
      include_in_report: true,
      order: photos.length,
    };
    onChange([...photos, newPhoto]);
  };

  const updatePhoto = (index: number, photo: PhotoData | null) => {
    if (photo === null) {
      onChange(photos.filter((_, i) => i !== index).map((p, i) => ({ ...p, order: i })));
    } else {
      onChange(photos.map((p, i) => (i === index ? photo : p)));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            Fotografías del servicio
          </h2>
          <p className="text-slate-600">
            Captura imágenes de antes, durante y después del servicio
          </p>
        </div>
        <button
          type="button"
          onClick={addPhoto}
          aria-label="Agregar nueva fotografía"
          className="inline-flex items-center gap-2 min-h-[48px] px-4 py-2 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] motion-safe:transition-all motion-safe:duration-200 font-medium focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
        >
          <PlusCircleIcon className="h-5 w-5" aria-hidden="true" />
          <span>Agregar foto</span>
        </button>
      </div>

      {photos.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50">
          <CameraIcon className="h-16 w-16 text-slate-300 mx-auto mb-4" aria-hidden="true" />
          <p className="text-slate-600 mb-4">No hay fotografías agregadas</p>
          <button
            type="button"
            onClick={addPhoto}
            aria-label="Tomar primera fotografía"
            className="inline-flex items-center gap-2 min-h-[48px] px-6 py-3 rounded-xl bg-[#0A3D91] text-white hover:bg-[#083777] motion-safe:transition-all motion-safe:duration-200 font-medium focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
          >
            <CameraIcon className="h-5 w-5" aria-hidden="true" />
            <span>Tomar primera foto</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {photos.map((photo, index) => (
            <div key={index} className="p-6 rounded-2xl border-2 border-slate-200 bg-slate-50">
              <div className="mb-4">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0A3D91] text-white text-sm font-medium">
                  <CameraIcon className="h-4 w-4" aria-hidden="true" />
                  <span>Foto #{index + 1}</span>
                </span>
              </div>
              <PhotoCapture
                initialPhoto={photo}
                onChange={(updatedPhoto) => updatePhoto(index, updatedPhoto)}
                defaultOrder={index}
                label=""
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================
// PASO 6: FIRMAS
// ===========================

function Step6Signatures({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}): React.ReactElement {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Firmas de conformidad
        </h2>
        <p className="text-slate-600">
          Recoge las firmas digitales del técnico y del cliente
        </p>
      </div>

      {/* Firma del técnico */}
      <section className="p-6 rounded-2xl border-2 border-blue-200 bg-blue-50 space-y-4" aria-labelledby="tech-signature-heading">
        <h3 id="tech-signature-heading" className="text-lg font-bold text-blue-900 flex items-center gap-2">
          <ClipboardDocumentCheckIcon className="h-6 w-6" aria-hidden="true" />
          <span>Firma del técnico</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="tech-name" className="block text-sm font-semibold text-slate-700 mb-2">
              Nombre completo
            </label>
            <input
              type="text"
              id="tech-name"
              value={state.technician_signature_name}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  technician_signature_name: e.target.value,
                }))
              }
              placeholder="Nombre del técnico"
              className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent bg-white"
            />
          </div>

          <div>
            <label htmlFor="tech-id" className="block text-sm font-semibold text-slate-700 mb-2">
              Cédula
            </label>
            <input
              type="text"
              id="tech-id"
              value={state.technician_signature_id}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  technician_signature_id: e.target.value,
                }))
              }
              placeholder="Número de cédula"
              className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent bg-white"
            />
          </div>
        </div>

        <SignatureCanvas
          initialSignature={state.technician_signature}
          onChange={(sig) =>
            setState((prev) => ({ ...prev, technician_signature: sig || "" }))
          }
          label="Firma digital del técnico"
        />
      </section>

      {/* Firma del cliente */}
      <section className="p-6 rounded-2xl border-2 border-green-200 bg-green-50 space-y-4" aria-labelledby="client-signature-heading">
        <h3 id="client-signature-heading" className="text-lg font-bold text-green-900 flex items-center gap-2">
          <ClipboardDocumentCheckIcon className="h-6 w-6" aria-hidden="true" />
          <span>Firma del cliente</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="client-name" className="block text-sm font-semibold text-slate-700 mb-2">
              Nombre completo
            </label>
            <input
              type="text"
              id="client-name"
              value={state.client_signature_name}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  client_signature_name: e.target.value,
                }))
              }
              placeholder="Nombre del responsable"
              className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent bg-white"
            />
          </div>

          <div>
            <label htmlFor="client-id" className="block text-sm font-semibold text-slate-700 mb-2">
              Cédula
            </label>
            <input
              type="text"
              id="client-id"
              value={state.client_signature_id}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  client_signature_id: e.target.value,
                }))
              }
              placeholder="Número de cédula"
              className="w-full min-h-[48px] px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent bg-white"
            />
          </div>
        </div>

        <SignatureCanvas
          initialSignature={state.client_signature}
          onChange={(sig) =>
            setState((prev) => ({ ...prev, client_signature: sig || "" }))
          }
          label="Firma digital del cliente"
        />
      </section>
    </div>
  );
}

// ===========================
// PASO 7: CONFIGURADOR PDF
// ===========================

function Step7PDFConfiguration({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}): React.ReactElement {
  const availableSections = [
    { id: "history_state", label: "Estado / Historial" },
    { id: "diagnostic", label: "Diagnóstico" },
    { id: "activities", label: "Actividades realizadas" },
    { id: "spares", label: "Repuestos utilizados" },
    { id: "observations", label: "Observaciones" },
    { id: "recommendations", label: "Recomendaciones" },
  ];

  const toggleSection = (sectionId: string) => {
    setState((prev) => ({
      ...prev,
      pdf_configuration: {
        ...prev.pdf_configuration,
        sections: prev.pdf_configuration.sections.includes(sectionId)
          ? prev.pdf_configuration.sections.filter((s) => s !== sectionId)
          : [...prev.pdf_configuration.sections, sectionId],
      },
    }));
  };

  const togglePhoto = (photoIndex: number) => {
    setState((prev) => ({
      ...prev,
      pdf_configuration: {
        ...prev.pdf_configuration,
        photo_ids: prev.pdf_configuration.photo_ids.includes(photoIndex)
          ? prev.pdf_configuration.photo_ids.filter((i) => i !== photoIndex)
          : [...prev.pdf_configuration.photo_ids, photoIndex],
      },
    }));
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          Configuración del PDF
        </h2>
        <p className="text-slate-600">
          Personaliza qué secciones y fotos incluir en el reporte final
        </p>
      </div>

      {/* Secciones */}
      <fieldset className="space-y-4">
        <legend className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <Cog6ToothIcon className="h-6 w-6 text-[#0A3D91]" aria-hidden="true" />
          <span>Secciones del reporte</span>
        </legend>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" role="group" aria-label="Seleccionar secciones del reporte">
          {availableSections.map((section) => (
            <label
              key={section.id}
              className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 bg-white cursor-pointer hover:border-[#0A3D91] motion-safe:transition-all motion-safe:duration-200"
            >
              <input
                type="checkbox"
                checked={state.pdf_configuration.sections.includes(section.id)}
                onChange={() => toggleSection(section.id)}
                className="w-5 h-5 rounded border-slate-300 text-[#0A3D91] focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
                aria-label={`Incluir ${section.label}`}
              />
              <span className="text-sm font-medium text-slate-700">
                {section.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Fotografías */}
      {state.photos.length > 0 && (
        <fieldset className="space-y-4">
          <legend className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <CameraIcon className="h-6 w-6 text-[#0A3D91]" aria-hidden="true" />
            <span>Fotografías a incluir</span>
          </legend>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="group" aria-label="Seleccionar fotografías">
            {state.photos.map((photo, index) => (
              <label
                key={index}
                className="flex items-start gap-3 p-4 rounded-xl border-2 border-slate-200 bg-white cursor-pointer hover:border-[#0A3D91] motion-safe:transition-all motion-safe:duration-200"
              >
                <input
                  type="checkbox"
                  checked={state.pdf_configuration.photo_ids.includes(index)}
                  onChange={() => togglePhoto(index)}
                  className="w-5 h-5 rounded border-slate-300 text-[#0A3D91] focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 mt-1"
                  aria-label={`Incluir foto número ${index + 1}`}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-slate-900">
                      Foto #{index + 1}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      {photo.photo_type}
                    </span>
                  </div>
                  {photo.preview && (
                    <img
                      src={photo.preview}
                      alt={`Previsualización de foto ${index + 1}`}
                      className="w-full h-24 object-cover rounded-lg"
                    />
                  )}
                  {photo.notes && (
                    <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                      {photo.notes}
                    </p>
                  )}
                </div>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Info final */}
      <div className="p-6 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200" role="status" aria-live="polite">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-1">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
              <ClipboardDocumentCheckIcon className="h-6 w-6 text-blue-700" aria-hidden="true" />
            </div>
          </div>
          <div>
            <h3 className="font-bold text-blue-900 mb-1">
              ¿Listo para finalizar?
            </h3>
            <p className="text-sm text-blue-800">
              Has configurado{" "}
              <strong>{state.pdf_configuration.sections.length} secciones</strong> y{" "}
              <strong>{state.pdf_configuration.photo_ids.length} fotografías</strong> para
              el PDF. Haz clic en "Finalizar Informe" para elegir cómo continuar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}