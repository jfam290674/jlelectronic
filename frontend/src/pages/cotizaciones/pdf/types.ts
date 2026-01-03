/* frontend/src/pages/cotizaciones/pdf/types.ts
 * Tipos compartidos para visores/plantillas de cotizaciones (STANDARD y EQUIPOS).
 * Regla: SOLO tipos, sin lógica de negocio (para evitar side-effects).
 */

export type MoneyLike = number | string;

export type SendVia = "email" | "whatsapp" | "";

export type CotizacionTipo = "STANDARD" | "EQUIPOS";

/** Cliente (detalle embebido por backend en `cliente_detalle`) */
export type Cliente = {
  id: number;
  nombre?: string;
  razon_social?: string;
  identificador?: string;
  ciudad?: string;
  direccion?: string;
  email?: string;
  telefono?: string;
  celular?: string;
};

/** Ítem de cotización (productos/equipos) */
export type Item = {
  id?: number;
  producto_id?: number | null;

  producto_nombre: string;
  producto_codigo?: string;

  producto_categoria?: string;
  producto_caracteristicas?: string;

  /** URL absoluta o relativa (según backend). */
  producto_imagen_url?: string;

  cantidad: number | string;
  precio_unitario: MoneyLike;

  /** opcional si backend lo envía */
  total_linea?: MoneyLike;
};

export type Cotizacion = {
  id: number;
  folio?: string;

  /** display del owner (backend) */
  owner_display?: string;

  cliente: number | null;
  cliente_display?: string;

  iva_percent: MoneyLike;
  descuento_cliente_percent: MoneyLike;

  subtotal: MoneyLike;
  descuento_total: MoneyLike;
  iva_total: MoneyLike;
  total: MoneyLike;

  enviado_via?: SendVia;
  enviado_en?: string | null;

  /** notas generales (si existen) */
  notas?: string;

  items: Item[];

  created_at?: string;
  updated_at?: string;

  /** backend: detalle del cliente embebido en retrieve/update */
  cliente_detalle?: Cliente;

  /**
   * NUEVO (planeado): tipo de proforma
   * - STANDARD: proforma actual
   * - EQUIPOS: proforma tipo carta / equipos
   */
  tipo?: CotizacionTipo;

  /**
   * NUEVO (planeado): campos carta/equipos
   * Texto final aplicado a la cotización (independiente de plantillas).
   */
  forma_pago_text?: string;
  tiempo_entrega_text?: string;

  /**
   * NUEVO (planeado): configuración editable para el armado de proforma
   * (visibilidad, orden, bloques extra, tamaños de imágenes, etc.)
   */
  proforma_config?: ProformaConfig;
};

/* ===================== Proforma modular (planeado) ===================== */

export type ProformaBlockKind =
  | "intro" // texto fijo inicial (EQUIPOS)
  | "cliente" // datos cliente
  | "asesor" // asesor
  | "titulo" // título de proforma
  | "imagen_principal" // hero image (equipos)
  | "items" // tabla de items
  | "totales" // resumen
  | "forma_pago" // bloque de forma de pago
  | "tiempo_entrega" // bloque de tiempo de entrega
  | "texto" // bloque texto libre (extra)
  | "imagen" // bloque imagen libre (extra)
  | "footer_note"; // notas finales opcionales

export type ProformaImageSizePreset = "XS" | "S" | "M" | "L" | "XL" | "FULL";

export type ProformaAlign = "left" | "center" | "right";

export type ProformaTextBlock = {
  kind: "texto" | "intro" | "titulo" | "footer_note" | "forma_pago" | "tiempo_entrega";
  /** Identificador estable para ordenar/editar */
  id: string;
  /** visible/incluido al exportar */
  visible: boolean;

  /** título interno (no necesariamente renderizado) */
  label?: string;

  /** contenido texto: idealmente HTML simple o markdown plano (definir luego) */
  content: string;

  align?: ProformaAlign;
};

export type ProformaImageBlock = {
  kind: "imagen" | "imagen_principal";
  id: string;
  visible: boolean;

  label?: string;

  /** URL (absoluta o relativa). Si es upload nuevo, se normaliza antes de guardar */
  src: string;

  /** opcional: caption */
  caption?: string;

  /** presets para UX rápida */
  size?: ProformaImageSizePreset;

  align?: ProformaAlign;

  /**
   * Opcional (futuro): crop/fit
   * - cover: llena y recorta
   * - contain: mantiene completo con bandas
   */
  fit?: "cover" | "contain";
};

export type ProformaSystemBlock = {
  kind:
    | "cliente"
    | "asesor"
    | "items"
    | "totales";
  id: string;
  visible: boolean;
  label?: string;
};

export type ProformaBlock = ProformaTextBlock | ProformaImageBlock | ProformaSystemBlock;

export type ProformaConfig = {
  /** versión del esquema para migraciones futuras */
  v: number;

  /** tipo de proforma */
  tipo: CotizacionTipo;

  /**
   * Orden final de render.
   * Cada bloque debe existir en `blocks`.
   */
  order: string[];

  /**
   * Diccionario de bloques (edición más simple que arrays gigantes).
   * - blocks[id] => block
   */
  blocks: Record<string, ProformaBlock>;
};

/* ===================== Plantillas (planeado) ===================== */

export type PlantillaTipo = "FORMA_PAGO" | "TIEMPO_ENTREGA" | "INTRO_EQUIPOS" | "TEXTO_LIBRE";

export type Plantilla = {
  id: number;
  tipo: PlantillaTipo;

  /** opcional: segmentación por sector (cárnica, pesquera, alimentaria, etc.) */
  sector?: string | null;

  titulo: string;
  contenido: string;

  is_default?: boolean;

  created_at?: string;
  updated_at?: string;
};
