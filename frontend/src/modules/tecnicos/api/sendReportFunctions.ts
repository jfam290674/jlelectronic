// src/modules/tecnicos/api/sendReportFunctions.ts
/**
 * Funciones para enviar reportes técnicos por Email y WhatsApp
 */

import { getCsrfToken } from "../../../utils/csrf";

const BASE_URL = "/api/tecnicos/reports";

// ================================================================================
// TIPOS
// ================================================================================

export interface SendEmailPayload {
  recipients: string[];
  subject: string;
  message: string;
  attach_technical_report?: boolean;
  attach_delivery_act?: boolean;
}

export interface SendEmailResponse {
  success: boolean;
  sent_to: string[];
  invalid_emails: string[];
  detail?: string;
}

export interface SendWhatsAppPayload {
  phone: string;
  message: string;
  attach_technical_report?: boolean;
  attach_delivery_act?: boolean;
}

export interface SendWhatsAppResponse {
  success: boolean;
  phone_formatted: string;
  whatsapp_url: string;
  detail?: string;
}

// ================================================================================
// FUNCIONES API
// ================================================================================

/**
 * Enviar reporte técnico por email
 */
export async function sendReportEmail(
  reportId: number,
  payload: SendEmailPayload
): Promise<SendEmailResponse> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${reportId}/send-email/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Error al enviar email");
  }

  return res.json();
}

/**
 * Preparar envío por WhatsApp (genera URL)
 */
export async function sendReportWhatsApp(
  reportId: number,
  payload: SendWhatsAppPayload
): Promise<SendWhatsAppResponse> {
  const csrftoken = await getCsrfToken();

  const res = await fetch(`${BASE_URL}/${reportId}/send-whatsapp/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Error al preparar WhatsApp");
  }

  return res.json();
}