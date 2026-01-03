// src/modules/tecnicos/api/reports.ts
/**
 * API para informes tÃ©cnicos y actas de entrega.
 */

import { getCsrfToken } from "../../../utils/csrf";

const BASE_URL = "/api/tecnicos/reports";
const DELIVERY_ACTS_URL = "/api/tecnicos/delivery-acts";

// ================================================================================
// TIPOS - REPORTS
// ================================================================================

export type ReportType = "PREVENTIVE" | "CORRECTIVE" | "TECHNICAL_VISIT" | "WARRANTY";
export type ReportStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  PREVENTIVE: "Preventivo",
  CORRECTIVE: "Correctivo",
  TECHNICAL_VISIT: "Visita TÃ©cnica",
  WARRANTY: "GarantÃ­a",
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: "Borrador",
  IN_PROGRESS: "En Progreso",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
};

export interface ReportActivity {
  id?: number;
  activity_text: string;
  order: number;
}

export interface ReportSpare {
  id?: number;
  product?: number | null;
  product_name?: string;
  product_info?: { id: number; description: string; }; // 🆕 Info del producto
  description?: string;
  quantity: number;
  notes?: string;
  order: number;
}

export interface ReportPhoto {
  id?: number;
  photo?: string;
  photo_type?: "BEFORE" | "DURING" | "AFTER";
  notes?: string;
  include_in_report?: boolean;
  order?: number;
  created_at?: string;
}

export interface ClientInfo {
  id: number;
  name?: string;
  nombre?: string;
  razon_social?: string;
  tax_id?: string;
  identificador?: string;
}

export interface MachineInfo {
  id: number;
  name: string;
  brand: string;
  model: string;
  serial: string;
  display_label: string;
}

/**
 * ConfiguraciÃ³n del PDF (quÃ© secciones y fotos incluir, en quÃ© orden).
 */
export interface PDFConfiguration {
  sections?: string[]; // ['history', 'diagnostic', 'activities', 'spares', 'observations', 'recommendations', 'photos']
  photo_ids?: number[]; // IDs de fotos en orden especÃ­fico
  order?: string[]; // Orden de las secciones en el PDF
}

export interface TechnicalReport {
  id: number;
  report_number: string;
  report_type: ReportType;
  report_type_display: string;
  status: ReportStatus;
  status_display: string;
  
  technician: number;
  technician_name: string;
  client: number;
  client_info: ClientInfo;
  machine: number;
  machine_info: MachineInfo;
  
  report_date: string;
  visit_date: string | null; // 🆕 Fecha de visita técnica
  city: string;
  person_in_charge: string;
  requested_by: string; // 🆕 Persona que solicita el servicio
  
  history_state: string;
  diagnostic: string;
  observations: string;
  recommendations: string;
  show_recommendations_in_report: boolean;
  
  activities: ReportActivity[];
  spares: ReportSpare[];
  photos: ReportPhoto[];
  
  // ConfiguraciÃ³n del PDF
  pdf_configuration: PDFConfiguration | null;
  
  // Firmas
  technician_signature: string;
  technician_signature_name: string;
  technician_signature_id: string;
  client_signature: string;
  client_signature_name: string;
  client_signature_id: string;
  
  // PDFs generados
  technical_report_pdf: string | null;
  technical_report_pdf_url: string | null;
  delivery_act_pdf: string | null;
  delivery_act_pdf_url: string | null;
  
  // Estado
  completed_at: string | null;
  has_delivery_act: boolean;
  
  created_at: string;
  updated_at: string;
}

export interface ReportCreateData {
  report_type: ReportType;
  client: number;
  machine: number;
  report_date?: string;
  visit_date?: string | null; // 🆕 Fecha de visita técnica
  city?: string;
  person_in_charge?: string;
  requested_by?: string; // 🆕 Persona que solicita el servicio
  history_state?: string;
  diagnostic?: string;
  observations?: string;
  recommendations?: string;
  show_recommendations_in_report?: boolean;
  pdf_configuration?: PDFConfiguration;
  activities_data?: Array<{ activity_text: string; order: number }>;
  spares_data?: Array<{
    product?: number | null;
    description?: string;
    quantity: number;
    notes?: string;
    order: number;
  }>;
  // âœ… AGREGADO: Fotos en base64
  photos_data?: Array<{
    photo: string;  // Base64 string (data:image/png;base64,...)
    photo_type?: "BEFORE" | "DURING" | "AFTER";
    notes?: string;
    include_in_report?: boolean;
    order?: number;
  }>;
  technician_signature?: string;
  technician_signature_name?: string;
  technician_signature_id?: string;
  client_signature?: string;
  client_signature_name?: string;
  client_signature_id?: string;
}

export interface ReportUpdateData {
  report_type?: ReportType;
  report_date?: string;
  visit_date?: string | null; // 🆕 Fecha de visita técnica
  city?: string;
  person_in_charge?: string;
  requested_by?: string; // 🆕 Persona que solicita el servicio
  history_state?: string;
  diagnostic?: string;
  observations?: string;
  recommendations?: string;
  show_recommendations_in_report?: boolean;
  pdf_configuration?: PDFConfiguration;
  activities_data?: Array<{ activity_text: string; order: number }>;
  spares_data?: Array<{
    product?: number | null;
    description?: string;
    quantity: number;
    notes?: string;
    order: number;
  }>;
  // âœ… AGREGADO: Fotos en base64
  photos_data?: Array<{
    photo: string;  // Base64 string (data:image/png;base64,...)
    photo_type?: "BEFORE" | "DURING" | "AFTER";
    notes?: string;
    include_in_report?: boolean;
    order?: number;
  }>;
  technician_signature?: string;
  technician_signature_name?: string;
  technician_signature_id?: string;
  client_signature?: string;
  client_signature_name?: string;
  client_signature_id?: string;
}

export interface ReportListParams {
  page?: number;
  page_size?: number;
  technician?: number;
  client?: number;
  machine?: number;
  report_type?: ReportType;
  status?: ReportStatus;
  report_date_from?: string;
  report_date_to?: string;
  q?: string;
}

export interface ReportListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: TechnicalReport[];
}

// ================================================================================
// TIPOS - DELIVERY ACTS
// ================================================================================

export interface DeliveryAct {
  id: number;
  report: number;
  report_info: {
    report_number: string;
    client_name: string;
    machine_name: string;
    report_date: string;
  };
  
  delivery_date: string;
  delivery_location: string;
  
  technician_signature: string;
  technician_name: string;
  technician_id: string;
  
  client_signature: string;
  client_name: string;
  client_id: string;
  
  additional_notes: string;
  
  pdf_file: string | null;
  pdf_url: string | null;
  
  created_at: string;
  updated_at: string;
}

export interface DeliveryActCreateData {
  report: number;
  delivery_date?: string;
  delivery_location?: string;
  technician_signature: string;
  technician_name: string;
  technician_id?: string;
  client_signature: string;
  client_name: string;
  client_id?: string;
  additional_notes?: string;
}

export interface DeliveryActUpdateData {
  delivery_date?: string;
  delivery_location?: string;
  technician_signature?: string;
  technician_name?: string;
  technician_id?: string;
  client_signature?: string;
  client_name?: string;
  client_id?: string;
  additional_notes?: string;
}

export interface DeliveryActListParams {
  page?: number;
  page_size?: number;
  report?: number;
  delivery_date_from?: string;
  delivery_date_to?: string;
}

export interface DeliveryActListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: DeliveryAct[];
}

// ================================================================================
// API FUNCTIONS - REPORTS CRUD
// ================================================================================

export async function listReports(
  params: ReportListParams = {}
): Promise<ReportListResponse> {
  const query = new URLSearchParams();

  if (params.page) query.set("page", params.page.toString());
  if (params.page_size) query.set("page_size", params.page_size.toString());
  if (params.technician) query.set("technician", params.technician.toString());
  if (params.client) query.set("client", params.client.toString());
  if (params.machine) query.set("machine", params.machine.toString());
  if (params.report_type) query.set("report_type", params.report_type);
  if (params.status) query.set("status", params.status);
  if (params.report_date_from) query.set("report_date_from", params.report_date_from);
  if (params.report_date_to) query.set("report_date_to", params.report_date_to);
  if (params.q) query.set("q", params.q);

  const url = query.toString() ? `${BASE_URL}/?${query}` : `${BASE_URL}/`;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudieron cargar los informes.`);
  }

  return res.json();
}

export async function getReport(id: number): Promise<TechnicalReport> {
  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo cargar el informe.`);
  }

  return res.json();
}

export async function createReport(
  data: ReportCreateData
): Promise<TechnicalReport> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo crear el informe.`);
  }

  return res.json();
}

export async function updateReport(
  id: number,
  data: ReportUpdateData
): Promise<TechnicalReport> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo actualizar el informe.`);
  }

  return res.json();
}

export async function patchReport(
  id: number,
  data: Partial<ReportUpdateData>
): Promise<TechnicalReport> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo actualizar el informe.`);
  }

  return res.json();
}

export async function deleteReport(id: number): Promise<void> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "X-CSRFToken": csrftoken,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo eliminar el informe.`);
  }
}

/**
 * Sube una fotografÃ­a al informe usando FormData (multipart/form-data).
 * 
 * @param reportId - ID del informe
 * @param file - Archivo de imagen (File object)
 * @param metadata - Metadatos de la foto (tipo, notas, orden, etc.)
 * @returns Objeto ReportPhoto creado
 */
export async function uploadReportPhoto(
  reportId: number,
  file: File,
  metadata: {
    photo_type?: "BEFORE" | "DURING" | "AFTER";
    notes?: string;
    include_in_report?: boolean;
    order?: number;
  } = {}
): Promise<ReportPhoto> {
  const csrftoken = await getCsrfToken();

  const formData = new FormData();
  formData.append("photo", file);
  
  if (metadata.photo_type) {
    formData.append("photo_type", metadata.photo_type);
  }
  if (metadata.notes) {
    formData.append("notes", metadata.notes);
  }
  if (metadata.include_in_report !== undefined) {
    formData.append("include_in_report", metadata.include_in_report.toString());
  }
  if (metadata.order !== undefined) {
    formData.append("order", metadata.order.toString());
  }

  const res = await fetch(`${BASE_URL}/${reportId}/upload-photo/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "X-CSRFToken": csrftoken,
      // NO incluir Content-Type - el navegador lo establece automÃ¡ticamente con boundary
    },
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      errorData.detail || 
      errorData.error || 
      `Error ${res.status}: No se pudo subir la fotografÃ­a.`
    );
  }

  return res.json();
}

// ================================================================================
// API FUNCTIONS - REPORT ACTIONS
// ================================================================================

/**
 * Marca el informe como completado.
 * Valida que tenga firmas y genera entrada en historial.
 */
export async function completeReport(id: number): Promise<TechnicalReport> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/complete/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo completar el informe.`);
  }

  return res.json();
}

/**
 * Genera los PDFs del informe (Reporte TÃ©cnico + Acta de Entrega).
 * Usa la configuraciÃ³n guardada en pdf_configuration o permite sobrescribirla.
 */
export async function generateReportPDF(
  id: number,
  pdf_config?: PDFConfiguration
): Promise<{
  technical_report_pdf_url: string;
  delivery_act_pdf_url: string;
}> {
  const csrftoken = await getCsrfToken();

  const body: { pdf_config?: PDFConfiguration } = {};
  if (pdf_config) {
    body.pdf_config = pdf_config;
  }

  const res = await fetch(`${BASE_URL}/${id}/generate-pdf/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo generar el PDF.`);
  }

  return res.json();
}

/**
 * EnvÃ­a el informe por correo electrÃ³nico.
 */
export async function sendReportEmail(
  id: number,
  data: {
    recipients: string[];
    subject?: string;
    message?: string;
    attach_technical_report?: boolean;
    attach_delivery_act?: boolean;
  }
): Promise<{ detail: string }> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/send-email/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo enviar el email.`);
  }

  return res.json();
}

/**
 * Prepara mensaje de WhatsApp con el informe.
 */
export async function sendReportWhatsApp(
  id: number,
  data: {
    phone: string;
    message?: string;
    attach_technical_report?: boolean;
    attach_delivery_act?: boolean;
  }
): Promise<{ detail: string; whatsapp_url: string }> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${id}/send-whatsapp/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo preparar WhatsApp.`);
  }

  return res.json();
}

// ================================================================================
// API FUNCTIONS - DELIVERY ACTS CRUD
// ================================================================================

export async function listDeliveryActs(
  params: DeliveryActListParams = {}
): Promise<DeliveryActListResponse> {
  const query = new URLSearchParams();

  if (params.page) query.set("page", params.page.toString());
  if (params.page_size) query.set("page_size", params.page_size.toString());
  if (params.report) query.set("report", params.report.toString());
  if (params.delivery_date_from) query.set("delivery_date_from", params.delivery_date_from);
  if (params.delivery_date_to) query.set("delivery_date_to", params.delivery_date_to);

  const url = query.toString() ? `${DELIVERY_ACTS_URL}/?${query}` : `${DELIVERY_ACTS_URL}/`;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudieron cargar las actas.`);
  }

  return res.json();
}

export async function getDeliveryAct(id: number): Promise<DeliveryAct> {
  const res = await fetch(`${DELIVERY_ACTS_URL}/${id}/`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo cargar el acta.`);
  }

  return res.json();
}

export async function createDeliveryAct(
  data: DeliveryActCreateData
): Promise<DeliveryAct> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${DELIVERY_ACTS_URL}/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo crear el acta.`);
  }

  return res.json();
}

export async function updateDeliveryAct(
  id: number,
  data: DeliveryActUpdateData
): Promise<DeliveryAct> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${DELIVERY_ACTS_URL}/${id}/`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo actualizar el acta.`);
  }

  return res.json();
}

export async function patchDeliveryAct(
  id: number,
  data: Partial<DeliveryActUpdateData>
): Promise<DeliveryAct> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${DELIVERY_ACTS_URL}/${id}/`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo actualizar el acta.`);
  }

  return res.json();
}

export async function deleteDeliveryAct(id: number): Promise<void> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${DELIVERY_ACTS_URL}/${id}/`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "X-CSRFToken": csrftoken,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo eliminar el acta.`);
  }
}

/**
 * Genera el PDF del Acta de Entrega.
 */
export async function generateDeliveryActPDF(
  id: number
): Promise<{ pdf_url: string }> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${DELIVERY_ACTS_URL}/${id}/generate-pdf/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${res.status}: No se pudo generar el PDF del acta.`);
  }

  return res.json();
}