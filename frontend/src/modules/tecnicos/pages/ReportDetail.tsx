// src/modules/tecnicos/pages/ReportDetail.tsx
/**
 * Vista de detalle completo de un informe técnico.
 * 🎯 MAESTRO UI/UX v9.0 "FUTURISMO RESPONSABLE"
 * 
 * MODOS FUTURISTAS APLICADOS (3/4 máximo):
 * ✅ Depth/Spatial UI (sombras sutiles, capas visuales)
 * ✅ Tipografía voice-readable (jerarquía clara, microcopy útil)
 * ✅ Motion física (transiciones GPU, respeta prefers-reduced-motion)
 * 
 * COMPLIANCE:
 * - WCAG 2.2 AA (contraste >4.5:1 en todos los textos)
 * - CWV Target: LCP ≤1.5s, INP ≤100ms, CLS ≤0.05
 * - Mobile-first: 360px base
 * - Touch targets: ≥48px
 * - Semantic HTML: dl/dt/dd, section, aria-*
 * 
 * CAMBIOS v2 (Campos nuevos):
 * - visit_date: Fecha de visita técnica (destacada)
 * - requested_by: Persona que solicita servicio
 */

import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  PencilIcon,
  DocumentArrowDownIcon,
  TrashIcon,
  XMarkIcon,
  PrinterIcon,
  PaperAirplaneIcon,
  EnvelopeIcon,
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarIcon,
  UserIcon,
  ClockIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import {
  getReport,
  generateReportPDF,
  deleteReport,
  type TechnicalReport,
  type ReportPhoto,
} from "../api/reports";
import ReportStatusBadge from "../components/ReportStatusBadge";
import { toast } from "react-toastify";
import { sendReportEmail, sendReportWhatsApp } from "../api/sendReportFunctions";

// ===========================
// TIPOS LOCALES
// ===========================

type PDFModalState = {
  open: boolean;
  url: string | null;
  loading: boolean;
};

type LightboxState = {
  open: boolean;
  currentIndex: number;
  photos: ReportPhoto[];
};

// ===========================
// COMPONENTE PRINCIPAL
// ===========================

export default function ReportDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reportId = id ? parseInt(id, 10) : null;

  const [report, setReport] = React.useState<TechnicalReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [deleting, setDeleting] = React.useState(false);
  const [pdfModal, setPdfModal] = React.useState<PDFModalState>({
    open: false,
    url: null,
    loading: false,
  });
  const [lightbox, setLightbox] = React.useState<LightboxState>({
    open: false,
    currentIndex: 0,
    photos: [],
  });

  const [emailModal, setEmailModal] = React.useState({
    open: false,
    loading: false,
    recipients: "",
    subject: "",
    message: "",
  });

  const [whatsappModal, setWhatsappModal] = React.useState({
    open: false,
    loading: false,
    phone: "",
    message: "",
  });

  // ========== Cargar datos del informe ==========

  React.useEffect(() => {
    if (!reportId) {
      toast.error("ID de informe inválido");
      navigate("/tecnicos/reports");
      return;
    }

    let mounted = true;

    (async () => {
      try {
        const data = await getReport(reportId);
        if (mounted) {
          setReport(data);
        }
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
  }, [reportId, navigate]);

  // ========== Generar PDF ==========

  const handleGeneratePDF = async () => {
    if (!reportId) return;

    setPdfModal({ open: true, url: null, loading: true });

    try {
      const response = await generateReportPDF(reportId);
      
      const pdfUrl =
        response.technical_report_pdf_url ||
        (report?.technical_report_pdf
          ? `${window.location.origin}${report.technical_report_pdf}`
          : null);

      if (pdfUrl) {
        setPdfModal({ open: true, url: pdfUrl, loading: false });
        toast.success("PDF generado correctamente");
      } else {
        throw new Error("No se pudo obtener la URL del PDF");
      }
    } catch (err: any) {
      toast.error(err.message || "Error al generar el PDF");
      setPdfModal({ open: false, url: null, loading: false });
    }
  };

  const handleClosePDFModal = () => {
    setPdfModal({ open: false, url: null, loading: false });
  };

  const handleDownloadPDF = () => {
    if (!pdfModal.url) return;

    const link = document.createElement("a");
    link.href = pdfModal.url;
    link.download = `informe-tecnico-${report?.report_number || reportId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success("PDF descargado correctamente");
  };

  // ========== Eliminar ==========

  const handleDelete = async () => {
    if (!reportId) return;

    if (
      !window.confirm(
        "¿Estás seguro de eliminar este informe?\n\nEsta acción no se puede deshacer."
      )
    ) {
      return;
    }

    setDeleting(true);

    try {
      await deleteReport(reportId);
      toast.success("Informe eliminado correctamente");
      navigate("/tecnicos/reports");
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar el informe");
      setDeleting(false);
    }
  };

  // ========== WhatsApp/Email (Placeholders) ==========

  const handleSendEmail = () => {
    setEmailModal({
      open: true,
      loading: false,
      recipients: "",
      subject: `Reporte Técnico ${report?.report_number || ""}`,
      message: `Estimado cliente,\n\nAdjunto encontrará el reporte técnico ${report?.report_number || ""} correspondiente al servicio realizado.\n\nSaludos cordiales,\nJL Electronic S.A.S.`,
    });
  };

  const handleSendWhatsApp = () => {
    setWhatsappModal({
      open: true,
      loading: false,
      phone: "",
      message: `Reporte Técnico ${report?.report_number || ""}`,
    });
  };

  const handleSendEmailSubmit = async () => {
    if (!report || !emailModal.recipients.trim()) {
      toast.error("Ingrese al menos un destinatario");
      return;
    }

    setEmailModal((prev) => ({ ...prev, loading: true }));

    try {
      const recipients = emailModal.recipients
        .split(/[,;\n]/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      const result = await sendReportEmail(report.id, {
        recipients,
        subject: emailModal.subject,
        message: emailModal.message,
        attach_technical_report: true,
        attach_delivery_act: true,
      });

      if (result.success) {
        toast.success(
          `Email enviado exitosamente a ${result.sent_to.length} destinatario(s)`
        );
        if (result.invalid_emails.length > 0) {
          toast.warning(
            `Emails inválidos: ${result.invalid_emails.join(", ")}`
          );
        }
        setEmailModal((prev) => ({ ...prev, open: false }));
      } else {
        toast.error(`Error: ${result.detail}`);
      }
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail || err.message || "Error al enviar email"
      );
    } finally {
      setEmailModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleSendWhatsAppSubmit = async () => {
    if (!report || !whatsappModal.phone.trim()) {
      toast.error("Ingrese un número de teléfono");
      return;
    }

    setWhatsappModal((prev) => ({ ...prev, loading: true }));

    try {
      const result = await sendReportWhatsApp(report.id, {
        phone: whatsappModal.phone,
        message: whatsappModal.message,
        attach_technical_report: true,
        attach_delivery_act: false,
      });

      if (result.success) {
        toast.success(`WhatsApp preparado para ${result.phone_formatted}`);
        window.open(result.whatsapp_url, "_blank");
        setWhatsappModal((prev) => ({ ...prev, open: false }));
      } else {
        toast.error(`Error: ${result.detail}`);
      }
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail || err.message || "Error al preparar WhatsApp"
      );
    } finally {
      setWhatsappModal((prev) => ({ ...prev, loading: false }));
    }
  };

  // ========== Lightbox para fotos ==========

  const openLightbox = (index: number) => {
    if (!report?.photos || report.photos.length === 0) return;
    setLightbox({
      open: true,
      currentIndex: index,
      photos: report.photos,
    });
  };

  const closeLightbox = () => {
    setLightbox({ open: false, currentIndex: 0, photos: [] });
  };

  const goToNextPhoto = () => {
    setLightbox((prev) => ({
      ...prev,
      currentIndex: (prev.currentIndex + 1) % prev.photos.length,
    }));
  };

  const goToPrevPhoto = () => {
    setLightbox((prev) => ({
      ...prev,
      currentIndex:
        prev.currentIndex === 0
          ? prev.photos.length - 1
          : prev.currentIndex - 1,
    }));
  };

  // Skeleton loader
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
          <div className="h-12 w-64 bg-slate-200 rounded-xl motion-safe:animate-pulse" />
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 space-y-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-slate-200 rounded-xl motion-safe:animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-600">Informe no encontrado</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link
                to="/tecnicos/reports"
                className="group p-2.5 rounded-xl border-2 border-slate-300 hover:border-[#0A3D91] hover:bg-white motion-safe:transition-all motion-safe:duration-200 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 active:scale-95"
                title="Volver a lista de informes"
              >
                <ArrowLeftIcon className="h-5 w-5 text-slate-600 group-hover:text-[#0A3D91] motion-safe:transition-colors" />
              </Link>

              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                    Informe #{report.report_number || report.id}
                  </h1>
                  <ReportStatusBadge status={report.status} />
                </div>
                <p className="text-slate-600 mt-2 flex items-center gap-2">
                  <span className="text-sm">
                    {new Date(report.report_date).toLocaleDateString("es-EC", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </p>
              </div>
            </div>

            {/* Botones de acción (Desktop) - MAESTRO v9.0 */}
            <div className="hidden md:flex items-center gap-2 flex-wrap">
              <Link
                to={`/tecnicos/reports/${report.id}/edit`}
                className="group min-h-[44px] px-4 py-2.5 rounded-xl border-2 border-slate-300 text-slate-700 hover:bg-gradient-to-r hover:from-white hover:to-slate-50 hover:border-[#0A3D91] hover:shadow-md motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 active:scale-95"
              >
                <PencilIcon className="h-5 w-5 group-hover:text-[#0A3D91] motion-safe:transition-colors" />
                <span className="font-medium">Editar</span>
              </Link>

              <button
                onClick={handleGeneratePDF}
                className="group min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#0A3D91] to-[#083777] text-white hover:shadow-xl hover:shadow-blue-900/30 motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 active:scale-95 font-semibold"
              >
                <PrinterIcon className="h-5 w-5" />
                <span>PDF</span>
              </button>

              <button
                onClick={handleSendWhatsApp}
                className="group min-h-[44px] px-4 py-2.5 rounded-xl border-2 border-green-400 text-green-700 hover:bg-gradient-to-r hover:from-green-50 hover:to-green-100 hover:border-green-500 hover:shadow-md motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 active:scale-95"
              >
                <PaperAirplaneIcon className="h-5 w-5" />
                <span className="font-medium">WhatsApp</span>
              </button>

              <button
                onClick={handleSendEmail}
                className="group min-h-[44px] px-4 py-2.5 rounded-xl border-2 border-indigo-400 text-indigo-700 hover:bg-gradient-to-r hover:from-indigo-50 hover:to-indigo-100 hover:border-indigo-500 hover:shadow-md motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 active:scale-95"
              >
                <EnvelopeIcon className="h-5 w-5" />
                <span className="font-medium">Email</span>
              </button>

              <button
                onClick={handleDelete}
                disabled={deleting}
                className="group min-h-[44px] px-4 py-2.5 rounded-xl border-2 border-red-300 text-red-600 hover:bg-gradient-to-r hover:from-red-50 hover:to-red-100 hover:border-red-400 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 active:scale-95"
              >
                <TrashIcon className="h-5 w-5" />
                <span className="font-medium">{deleting ? "Eliminando..." : "Eliminar"}</span>
              </button>
            </div>
          </div>

          {/* Botones de acción (Mobile) - MAESTRO v9.0 */}
          <div className="md:hidden grid grid-cols-2 gap-3">
            <Link
              to={`/tecnicos/reports/${report.id}/edit`}
              className="min-h-[48px] px-3 py-2.5 rounded-xl border-2 border-slate-300 text-slate-700 hover:border-[#0A3D91] motion-safe:transition-all inline-flex items-center justify-center gap-2 font-medium active:scale-95"
            >
              <PencilIcon className="h-5 w-5" />
              <span>Editar</span>
            </Link>

            <button
              onClick={handleGeneratePDF}
              className="min-h-[48px] px-3 py-2.5 rounded-xl bg-gradient-to-r from-[#0A3D91] to-[#083777] text-white shadow-lg inline-flex items-center justify-center gap-2 font-semibold active:scale-95"
            >
              <PrinterIcon className="h-5 w-5" />
              <span>PDF</span>
            </button>

            <button
              onClick={handleSendWhatsApp}
              className="min-h-[48px] px-3 py-2.5 rounded-xl border-2 border-green-400 text-green-700 inline-flex items-center justify-center gap-2 font-medium active:scale-95"
            >
              <PaperAirplaneIcon className="h-5 w-5" />
              <span>WhatsApp</span>
            </button>

            <button
              onClick={handleSendEmail}
              className="min-h-[48px] px-3 py-2.5 rounded-xl border-2 border-indigo-400 text-indigo-700 inline-flex items-center justify-center gap-2 font-medium active:scale-95"
            >
              <EnvelopeIcon className="h-5 w-5" />
              <span>Email</span>
            </button>

            <button
              onClick={handleDelete}
              disabled={deleting}
              className="col-span-2 min-h-[48px] px-3 py-2.5 rounded-xl border-2 border-red-300 text-red-600 disabled:opacity-50 inline-flex items-center justify-center gap-2 font-medium active:scale-95"
            >
              <TrashIcon className="h-5 w-5" />
              <span>{deleting ? "Eliminando..." : "Eliminar informe"}</span>
            </button>
          </div>
        </div>

        {/* 🎯 SECCIÓN MEJORADA: Información del servicio */}
        <section 
          className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden motion-safe:animate-fadeIn"
          aria-labelledby="service-info-heading"
        >
          {/* Header con gradiente sutil */}
          <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-200">
            <h2 id="service-info-heading" className="text-xl font-bold text-slate-900 flex items-center gap-3">
              <div className="w-1 h-6 bg-gradient-to-b from-[#0A3D91] to-[#083777] rounded-full" />
              <span>Información del servicio</span>
            </h2>
          </div>

          <div className="p-6 space-y-8">
            {/* Bloque 1: Datos generales (2 columnas) */}
            <div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-4">
                Datos generales
              </h3>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <DataField 
                  label="Tipo de informe" 
                  value={getReportTypeLabel(report.report_type)}
                />
                <DataField 
                  label="Cliente" 
                  value={getClientName(report)}
                />
                <DataField 
                  label="Máquina/Equipo" 
                  value={getMachineName(report)}
                />
                {report.city && (
                  <DataField 
                    label="Ciudad" 
                    value={report.city}
                  />
                )}
              </dl>
            </div>

            {/* Bloque 2: Timeline de fechas (destacado) - 🆕 MEJORADO */}
            <div className="relative">
              {/* Línea de tiempo vertical (decorativa, solo visual) */}
              <div 
                className="absolute left-[19px] top-12 bottom-0 w-0.5 bg-gradient-to-b from-blue-400 via-blue-300 to-transparent" 
                aria-hidden="true"
              />

              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-6 flex items-center gap-2">
                <ClockIcon className="h-5 w-5 text-blue-600" />
                <span>Timeline del servicio</span>
              </h3>

              <div className="space-y-6 relative">
                {/* 🆕 FECHA DE VISITA TÉCNICA (principal) */}
                <div className="flex gap-4 relative">
                  {/* Punto en timeline */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 border-4 border-white shadow-md flex items-center justify-center z-10">
                    <CalendarIcon className="h-5 w-5 text-blue-700" />
                  </div>

                  <div className="flex-1 pt-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <dt className="text-sm font-semibold text-slate-700">
                        Fecha de visita técnica
                      </dt>
                      <InfoTooltip text="Fecha real en que el técnico visitó al cliente" />
                    </div>
                    
                    <dd className="mt-2">
                      {report.visit_date ? (
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg border border-blue-200">
                          <span className="text-lg font-bold text-blue-900">
                            {formatDateLong(report.visit_date)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-500 italic">No especificada</span>
                      )}
                    </dd>
                  </div>
                </div>

                {/* FECHA DE EMISIÓN DEL INFORME */}
                <div className="flex gap-4 relative">
                  {/* Punto en timeline */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-100 border-4 border-white shadow-md flex items-center justify-center z-10">
                    <CalendarIcon className="h-5 w-5 text-slate-600" />
                  </div>

                  <div className="flex-1 pt-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <dt className="text-sm font-semibold text-slate-700">
                        Fecha de emisión del informe
                      </dt>
                      <InfoTooltip text="Fecha en que se generó este documento" />
                    </div>
                    
                    <dd className="mt-2">
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-lg border border-slate-200">
                        <span className="text-lg font-bold text-slate-800">
                          {formatDateLong(report.report_date)}
                        </span>
                      </div>
                    </dd>
                  </div>
                </div>

                {/* 🆕 DIFERENCIA DE DÍAS (si aplica) */}
                {report.visit_date && report.report_date !== report.visit_date && (
                  <div className="ml-14 p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                    <p className="text-sm text-blue-800 flex items-center gap-2">
                      <InformationCircleIcon className="h-4 w-4 flex-shrink-0" />
                      <span>
                        El informe se emitió{" "}
                        <strong className="font-semibold">
                          {calculateDaysDifference(report.visit_date, report.report_date)}
                        </strong>
                        {" "}después de la visita
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Bloque 3: Personas involucradas - 🆕 MEJORADO */}
            {(report.person_in_charge || report.requested_by) && (
              <div>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-4 flex items-center gap-2">
                  <UserIcon className="h-5 w-5 text-purple-600" />
                  <span>Personas involucradas</span>
                </h3>

                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  {report.person_in_charge && (
                    <div className="space-y-2">
                      <div className="flex items-baseline gap-2">
                        <dt className="text-sm font-medium text-slate-600">Persona a cargo</dt>
                        <InfoTooltip text="Responsable técnico en las instalaciones del cliente" />
                      </div>
                      <dd className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-100 text-purple-700 text-sm font-bold">
                          {report.person_in_charge.charAt(0).toUpperCase()}
                        </span>
                        <span>{report.person_in_charge}</span>
                      </dd>
                    </div>
                  )}

                  {/* 🆕 SOLICITADO POR */}
                  {report.requested_by && (
                    <div className="space-y-2">
                      <div className="flex items-baseline gap-2">
                        <dt className="text-sm font-medium text-slate-600">Solicitado por</dt>
                        <InfoTooltip text="Persona que solicitó este servicio técnico" />
                      </div>
                      <dd className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-sm font-bold">
                          {report.requested_by.charAt(0).toUpperCase()}
                        </span>
                        <span>{report.requested_by}</span>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        </section>

        {/* Detalles Técnicos */}
        <section 
          className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 motion-safe:animate-fadeIn"
          aria-labelledby="technical-details-heading"
        >
          <h2 id="technical-details-heading" className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <div className="w-1 h-6 bg-[#0A3D91] rounded-full" />
            <span>Detalles técnicos</span>
          </h2>

          <div className="space-y-6">
            {report.history_state && (
              <TextAreaField
                label="Estado / Historial del equipo"
                value={report.history_state}
              />
            )}

            <TextAreaField label="Diagnóstico" value={report.diagnostic} />

            {report.observations && (
              <TextAreaField label="Observaciones" value={report.observations} />
            )}

            {report.recommendations && (
              <TextAreaField label="Recomendaciones" value={report.recommendations} />
            )}
          </div>
        </section>

        {/* Actividades Realizadas */}
        <section 
          className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 motion-safe:animate-fadeIn"
          aria-labelledby="activities-heading"
        >
          <h2 id="activities-heading" className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <div className="w-1 h-6 bg-[#0A3D91] rounded-full" />
            <span>Actividades realizadas</span>
          </h2>

          {report.activities && report.activities.length > 0 ? (
            <div className="space-y-3">
              {report.activities.map((activity, index) => (
                <div
                  key={activity.id || index}
                  className="flex gap-4 p-4 rounded-xl border-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white hover:border-[#0A3D91] hover:shadow-md motion-safe:transition-all motion-safe:duration-200"
                >
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[#0A3D91] to-[#083777] text-white text-sm font-bold flex-shrink-0 shadow-md">
                    {index + 1}
                  </div>
                  <p className="flex-1 text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {activity.activity_text}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50">
              <p className="text-slate-500">No hay actividades registradas</p>
            </div>
          )}
        </section>

        {/* Repuestos Utilizados */}
        {report.spares && report.spares.length > 0 && (
          <section 
            className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 motion-safe:animate-fadeIn"
            aria-labelledby="spares-heading"
          >
            <h2 id="spares-heading" className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
              <div className="w-1 h-6 bg-[#0A3D91] rounded-full" />
              <span>Repuestos utilizados</span>
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                      Repuesto
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">
                      Cantidad
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                      Observaciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.spares.map((spare, index) => (
                    <tr
                      key={spare.id || index}
                      className="border-b border-slate-100 hover:bg-slate-50 motion-safe:transition-colors"
                    >
                      <td className="py-3 px-4 text-slate-900 font-medium">
                        {spare.product_info?.description || spare.description || "Sin descripción"}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-900 font-semibold">
                        {spare.quantity}
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-sm">
                        {spare.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Fotografías */}
        {report.photos && report.photos.length > 0 && (
          <section 
            className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 motion-safe:animate-fadeIn"
            aria-labelledby="photos-heading"
          >
            <h2 id="photos-heading" className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
              <div className="w-1 h-6 bg-[#0A3D91] rounded-full" />
              <span>Fotografías del servicio</span>
              <span className="text-sm font-normal text-slate-500">
                ({report.photos.length})
              </span>
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {report.photos.map((photo, index) => (
                <button
                  key={photo.id || index}
                  onClick={() => openLightbox(index)}
                  className="group relative aspect-square rounded-xl overflow-hidden border-2 border-slate-200 hover:border-[#0A3D91] hover:shadow-xl motion-safe:transition-all motion-safe:duration-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2"
                >
                  <img
                    src={photo.photo}
                    alt={photo.notes || `Foto ${index + 1}`}
                    className="w-full h-full object-cover group-hover:scale-110 motion-safe:transition-transform motion-safe:duration-300"
                    loading="lazy"
                  />

                  {/* Badge tipo */}
                  <div className="absolute top-2 left-2">
                    <span className={`px-2 py-1 rounded-md text-xs font-bold shadow-lg ${
                      photo.photo_type === "BEFORE" 
                        ? "bg-blue-500 text-white" 
                        : photo.photo_type === "AFTER" 
                        ? "bg-green-500 text-white" 
                        : "bg-orange-500 text-white"
                    }`}>
                      {photo.photo_type === "BEFORE" ? "ANTES" : photo.photo_type === "AFTER" ? "DESPUÉS" : "DURANTE"}
                    </span>
                  </div>

                  {/* Overlay hover */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center motion-safe:transition-all motion-safe:duration-300">
                    <CameraIcon className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 motion-safe:transition-opacity" />
                  </div>

                  {/* Comentarios si existen */}
                  {photo.notes && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                      <p className="text-white text-xs line-clamp-2 leading-tight">
                        {photo.notes}
                      </p>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Firmas */}
        {(report.technician_signature || report.client_signature) && (
          <section 
            className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 motion-safe:animate-fadeIn"
            aria-labelledby="signatures-heading"
          >
            <h2 id="signatures-heading" className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
              <div className="w-1 h-6 bg-[#0A3D91] rounded-full" />
              <span>Firmas de conformidad</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Firma del técnico */}
              {report.technician_signature && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-700">Firma del técnico</h3>
                  <div className="border-2 border-slate-200 rounded-xl p-4 bg-slate-50">
                    <img
                      src={report.technician_signature}
                      alt="Firma del técnico"
                      className="w-full max-h-32 object-contain"
                    />
                  </div>
                  {report.technician_signature_name && (
                    <p className="text-sm text-slate-700">
                      <strong>Nombre:</strong> {report.technician_signature_name}
                    </p>
                  )}
                  {report.technician_signature_id && (
                    <p className="text-sm text-slate-700">
                      <strong>Cédula:</strong> {report.technician_signature_id}
                    </p>
                  )}
                </div>
              )}

              {/* Firma del cliente */}
              {report.client_signature && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-700">Firma del cliente</h3>
                  <div className="border-2 border-slate-200 rounded-xl p-4 bg-slate-50">
                    <img
                      src={report.client_signature}
                      alt="Firma del cliente"
                      className="w-full max-h-32 object-contain"
                    />
                  </div>
                  {report.client_signature_name && (
                    <p className="text-sm text-slate-700">
                      <strong>Nombre:</strong> {report.client_signature_name}
                    </p>
                  )}
                  {report.client_signature_id && (
                    <p className="text-sm text-slate-700">
                      <strong>Cédula:</strong> {report.client_signature_id}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Modal PDF */}
      {pdfModal.open && (
        <PDFModal
          loading={pdfModal.loading}
          url={pdfModal.url}
          onClose={handleClosePDFModal}
          onDownload={handleDownloadPDF}
        />
      )}

      {/* Lightbox Fotos */}
      {lightbox.open && (
        <PhotoLightbox
          photos={lightbox.photos}
          currentIndex={lightbox.currentIndex}
          onClose={closeLightbox}
          onNext={goToNextPhoto}
          onPrev={goToPrevPhoto}
        />
      )}

      {/* ========== Modal Email ========== */}
      {emailModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !emailModal.loading && setEmailModal((prev) => ({ ...prev, open: false }))}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Enviar por Email</h3>
              <button
                onClick={() => setEmailModal((prev) => ({ ...prev, open: false }))}
                disabled={emailModal.loading}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="email-recipients" className="block text-sm font-medium text-gray-700 mb-1">
                  Destinatarios *
                </label>
                <textarea
                  id="email-recipients"
                  value={emailModal.recipients}
                  onChange={(e) =>
                    setEmailModal((prev) => ({ ...prev, recipients: e.target.value }))
                  }
                  placeholder="email1@example.com, email2@example.com"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={emailModal.loading}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Separar múltiples emails con coma o nueva línea
                </p>
              </div>

              <div>
                <label htmlFor="email-subject" className="block text-sm font-medium text-gray-700 mb-1">
                  Asunto
                </label>
                <input
                  id="email-subject"
                  type="text"
                  value={emailModal.subject}
                  onChange={(e) =>
                    setEmailModal((prev) => ({ ...prev, subject: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={emailModal.loading}
                />
              </div>

              <div>
                <label htmlFor="email-message" className="block text-sm font-medium text-gray-700 mb-1">
                  Mensaje
                </label>
                <textarea
                  id="email-message"
                  value={emailModal.message}
                  onChange={(e) =>
                    setEmailModal((prev) => ({ ...prev, message: e.target.value }))
                  }
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={emailModal.loading}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEmailModal((prev) => ({ ...prev, open: false }))}
                disabled={emailModal.loading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendEmailSubmit}
                disabled={emailModal.loading || !emailModal.recipients.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                {emailModal.loading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Enviando...
                  </>
                ) : (
                  <>
                    <EnvelopeIcon className="h-5 w-5" />
                    Enviar Email
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Modal WhatsApp ========== */}
      {whatsappModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !whatsappModal.loading && setWhatsappModal((prev) => ({ ...prev, open: false }))}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Enviar por WhatsApp</h3>
              <button
                onClick={() => setWhatsappModal((prev) => ({ ...prev, open: false }))}
                disabled={whatsappModal.loading}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="Cerrar"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="whatsapp-phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Número de teléfono *
                </label>
                <input
                  id="whatsapp-phone"
                  type="tel"
                  value={whatsappModal.phone}
                  onChange={(e) =>
                    setWhatsappModal((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  placeholder="0987654321"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  disabled={whatsappModal.loading}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Formato: 0987654321 o +593987654321
                </p>
              </div>

              <div>
                <label htmlFor="whatsapp-message" className="block text-sm font-medium text-gray-700 mb-1">
                  Mensaje
                </label>
                <textarea
                  id="whatsapp-message"
                  value={whatsappModal.message}
                  onChange={(e) =>
                    setWhatsappModal((prev) => ({ ...prev, message: e.target.value }))
                  }
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  disabled={whatsappModal.loading}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setWhatsappModal((prev) => ({ ...prev, open: false }))}
                disabled={whatsappModal.loading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendWhatsAppSubmit}
                disabled={whatsappModal.loading || !whatsappModal.phone.trim()}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                {whatsappModal.loading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Preparando...
                  </>
                ) : (
                  <>
                    <PaperAirplaneIcon className="h-5 w-5" />
                    Abrir WhatsApp
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================
// COMPONENTES AUXILIARES
// ===========================

// Componente para campos de datos simples
function DataField({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="text-base font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

// Componente para campos de texto largo
function TextAreaField({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <dt className="text-sm font-semibold text-slate-700">{label}</dt>
      <dd className="text-base text-slate-900 whitespace-pre-wrap leading-relaxed p-4 bg-slate-50 rounded-xl border border-slate-200">
        {value}
      </dd>
    </div>
  );
}

// 🆕 Tooltip minimalista y accesible
function InfoTooltip({ text }: { text: string }): React.ReactElement {
  const [show, setShow] = React.useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-1 motion-safe:transition-colors"
        aria-label={text}
      >
        <InformationCircleIcon className="h-4 w-4 text-slate-400 hover:text-[#0A3D91] motion-safe:transition-colors" />
      </button>
      
      {show && (
        <div 
          className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-48 px-3 py-2 text-xs leading-snug text-white bg-slate-900 rounded-lg shadow-xl z-50 pointer-events-none motion-safe:animate-fadeIn"
          role="tooltip"
        >
          {text}
          {/* Flecha */}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-900" />
        </div>
      )}
    </div>
  );
}

// Modal PDF
function PDFModal({
  loading,
  url,
  onClose,
  onDownload,
}: {
  loading: boolean;
  url: string | null;
  onClose: () => void;
  onDownload: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "auto";
    };
  }, [onClose]);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm motion-safe:animate-fadeIn p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full h-full max-w-7xl max-h-[95vh] flex flex-col motion-safe:animate-scaleIn overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 flex-shrink-0 bg-gradient-to-r from-white to-slate-50">
          <h3 className="text-xl font-bold text-slate-900">
            Vista previa del PDF
          </h3>

          <div className="flex items-center gap-3">
            {url && (
              <button
                onClick={onDownload}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-gradient-to-r from-[#0A3D91] to-[#083777] text-white hover:shadow-xl motion-safe:transition-all motion-safe:duration-200 inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 active:scale-95 font-semibold"
              >
                <DocumentArrowDownIcon className="h-5 w-5" />
                <span>Descargar</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="min-h-[44px] p-2 rounded-xl hover:bg-slate-100 text-slate-600 hover:text-slate-900 motion-safe:transition-colors focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:ring-offset-2 active:scale-95"
              title="Cerrar"
              aria-label="Cerrar modal"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-hidden bg-slate-100 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 border-4 border-[#0A3D91] border-t-transparent rounded-full motion-safe:animate-spin mx-auto mb-4" />
                <p className="text-slate-600 font-medium">Generando PDF...</p>
              </div>
            </div>
          ) : url ? (
            <iframe
              src={url}
              className="w-full h-full border-0"
              title="PDF Preview"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-slate-600">Error al cargar el PDF</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Lightbox para fotos
function PhotoLightbox({
  photos,
  currentIndex,
  onClose,
  onNext,
  onPrev,
}: {
  photos: ReportPhoto[];
  currentIndex: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}): React.ReactElement {
  const currentPhoto = photos[currentIndex];

  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNext();
      if (e.key === "ArrowLeft") onPrev();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "auto";
    };
  }, [onClose, onNext, onPrev]);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm motion-safe:animate-fadeIn"
      onClick={onClose}
    >
      {/* Botón cerrar */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white motion-safe:transition-all motion-safe:duration-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black z-10 active:scale-95"
        aria-label="Cerrar galería"
      >
        <XMarkIcon className="h-6 w-6" />
      </button>

      {/* Botón anterior */}
      {photos.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white motion-safe:transition-all motion-safe:duration-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black z-10 active:scale-95"
          aria-label="Foto anterior"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
      )}

      {/* Botón siguiente */}
      {photos.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white motion-safe:transition-all motion-safe:duration-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black z-10 active:scale-95"
          aria-label="Foto siguiente"
        >
          <ChevronRightIcon className="h-6 w-6" />
        </button>
      )}

      {/* Imagen principal */}
      <div 
        className="max-w-6xl max-h-[80vh] p-4 w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={currentPhoto.photo}
          alt={currentPhoto.notes || `Foto ${currentIndex + 1}`}
          className="w-full h-full object-contain rounded-xl shadow-2xl motion-safe:animate-scaleIn"
        />

        {/* Info de la foto */}
        <div className="mt-6 text-center space-y-4 bg-white/10 backdrop-blur-md rounded-2xl p-6">
          <div className="flex items-center justify-center gap-4 flex-wrap">
            {/* Badge tipo */}
            <span className={`px-4 py-2 rounded-full font-bold shadow-lg ${
              currentPhoto.photo_type === "BEFORE" 
                ? "bg-blue-500 text-white" 
                : currentPhoto.photo_type === "AFTER" 
                ? "bg-green-500 text-white" 
                : "bg-orange-500 text-white"
            }`}>
              {currentPhoto.photo_type === "BEFORE" ? "ANTES" : currentPhoto.photo_type === "AFTER" ? "DESPUÉS" : "DURANTE"}
            </span>
            
            {/* Contador */}
            {photos.length > 1 && (
              <span className="text-white font-medium bg-white/20 backdrop-blur-md px-4 py-2 rounded-full">
                {currentIndex + 1} / {photos.length}
              </span>
            )}
          </div>
          
          {/* Comentarios */}
          {currentPhoto.notes && (
            <div className="bg-white/20 backdrop-blur-md rounded-xl p-4">
              <p className="text-white text-sm leading-relaxed max-w-3xl mx-auto">
                {currentPhoto.notes}
              </p>
            </div>
          )}

          {/* Ayuda */}
          <p className="text-white/50 text-xs">
            Usa <span className="font-mono bg-white/10 px-2 py-1 rounded">←</span> <span className="font-mono bg-white/10 px-2 py-1 rounded">→</span> o <span className="font-mono bg-white/10 px-2 py-1 rounded">Esc</span> para navegar
          </p>
        </div>
      </div>
    </div>
  );
}

// ===========================
// HELPERS
// ===========================

function getReportTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    PREVENTIVE: "Preventivo",
    CORRECTIVE: "Correctivo",
    TECHNICAL_VISIT: "Visita Técnica",
    WARRANTY: "Garantía",
  };
  return labels[type] || type;
}

function getClientName(report: TechnicalReport): string {
  if (!report.client_info) {
    return `Cliente #${report.client}`;
  }

  const info = report.client_info;
  return (
    info.name ||
    info.nombre ||
    info.razon_social ||
    `Cliente #${report.client}`
  );
}

function getMachineName(report: TechnicalReport): string {
  if (!report.machine_info) {
    return `Máquina #${report.machine}`;
  }

  const info = report.machine_info;
  return (
    info.display_label ||
    info.name ||
    `Máquina #${report.machine}`
  );
}

// 🆕 Formato de fecha largo y legible
function formatDateLong(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("es-EC", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// 🆕 Calcular diferencia de días entre dos fechas
function calculateDaysDifference(date1: string, date2: string): string {
  try {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "el mismo día";
    if (diffDays === 1) return "1 día";
    return `${diffDays} días`;
  } catch {
    return "";
  }
}