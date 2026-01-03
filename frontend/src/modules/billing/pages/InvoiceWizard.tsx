// frontend/src/modules/billing/pages/InvoiceWizard.tsx
// -*- coding: utf-8 -*-
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  createInvoice,
  getSecuencialesDisponibles,
} from "../services/billingApi";
import type { SecuencialDisponible } from "../services/billingApi";


// Tipos básicos (ajustados a tus serializers reales)
interface Empresa {
  id: number;
  ruc: string;
  razon_social: string;
  iva_codigo?: string;
  iva_codigo_porcentaje?: string;
  iva_tarifa?: number | string;
}

interface Establecimiento {
  id: number;
  codigo: string;
  nombre: string;
  direccion?: string;
}

interface PuntoEmision {
  id: number;
  codigo: string;
  descripcion?: string;
}

interface Warehouse {
  id: number;
  name: string;
  code: string;
  category?: string;
  active?: boolean;
}

// Cliente según MODULO CLIENTES
interface Cliente {
  id: number;
  identificador: string; // RUC / CI / etc.
  nombre: string;
  direccion?: string;
  ciudad?: string;
  celular?: string;
  email?: string;
  activo?: boolean;
}

// Producto: alineado al MODULO PRODUCTOS + campos flexibles
interface Producto {
  id: number | string;
  // Nombres/códigos principales según tu backend
  codigo?: string;
  codigo_alterno?: string;
  categoria?: string;
  nombre_equipo?: string;
  modelo?: string;
  descripcion?: string;
  precio?: number | string;
  tipo_id?: number | string;
  tipo_nombre?: string;

  // Alias genéricos para compatibilidad
  nombre?: string;
  name?: string;
  description?: string;
  model?: string;
  codigo_interno?: string;
  codigo_principal?: string;
  code?: string;
  sku?: string;
  type?: string;
  tipo?: string;
  precio_venta?: number | string;
  price?: number | string;

  es_servicio?: boolean;
  controla_stock?: boolean;
  [key: string]: any;
}


// Línea en el formulario (draft)
interface InvoiceLineDraft {
  id: number; // id local del front
  product_id: number | string | null;
  product_label: string;
  cantidad: number;
  precio_unitario: number;
  descuento: number;
  stock_actual: number | null;
  es_servicio: boolean;
  controla_stock: boolean;
  iva_tarifa: number | null; // IVA de la línea (si no tiene, se usa el de la empresa para cálculo estimado)
}

// Respuesta al crear factura (subset del Invoice real)
interface InvoiceCreateResponse {
  id: number;
  secuencial_display: string;
  estado: string;
  clave_acceso: string;
}

const formatMoney = (value: number): string =>
  value.toLocaleString("es-EC", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Normaliza respuestas que pueden venir como {results: [...]}
const ensureArray = <T,>(data: any): T[] => {
  if (Array.isArray(data)) return data as T[];
  if (data && Array.isArray(data.results)) return data.results as T[];
  return [];
};

// Heurística para deducir tipo_identificación SRI desde identificador
const inferTipoIdentificacion = (
  identificador: string | undefined | null,
): string => {
  const v = (identificador || "").trim();
  if (!v) {
    // Sin identificador, asumimos consumidor final
    return "07";
  }
  if (/^\d{13}$/.test(v)) {
    // 13 dígitos: usualmente RUC
    return "04";
  }
  if (/^\d{10}$/.test(v)) {
    // 10 dígitos: usualmente cédula
    return "05";
  }
  // Caso general: pasaporte / exterior
  return "06";
};

// Helpers para productos (para adaptarse a nombres de campos distintos)
const getProductDisplayCode = (p: Producto): string => {
  return (
    (p.codigo_interno as string) ||
    (p.codigo_principal as string) ||
    (p.codigo as string) ||
    (p.code as string) ||
    (p.sku as string) ||
    (p.codigo_alterno as string) ||
    (p.alt_code as string) ||
    ""
  );
};

const getProductDisplayName = (p: Producto): string => {
  return (
    (p.nombre_equipo as string) ||
    (p.nombre as string) ||
    (p.name as string) ||
    (p.descripcion as string) ||
    (p.description as string) ||
    (p.model as string) ||
    (p.modelo as string) ||
    ""
  );
};

const getProductUnitPrice = (p: Producto): number => {
  const raw = p.precio_venta ?? p.precio ?? p.price ?? 0;
  if (typeof raw === "number") return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

// Tipo de producto (para filtros) alineado a ProductoSerializer (tipo_nombre)
const getProductTipoLabel = (p: Producto): string => {
  const raw =
    (p.tipo_nombre as string) ||
    (p.tipo as string) ||
    (p.type as string) ||
    "";
  return raw ? String(raw).trim() : "";
};

// Determina si un producto es servicio (no descuenta stock)
const isServicioProduct = (p: Producto): boolean => {
  if (typeof p.es_servicio === "boolean") return p.es_servicio;
  if (typeof p.controla_stock === "boolean") return !p.controla_stock;
  const tipo = getProductTipoLabel(p).toUpperCase();
  return tipo === "SERVICIO" || tipo === "SERVICE";
};

// Determina si un producto controla stock (productos físicos)
const controlsStock = (p: Producto): boolean => {
  if (typeof p.controla_stock === "boolean") return p.controla_stock;
  const tipo = getProductTipoLabel(p).toUpperCase();
  if (tipo === "SERVICIO" || tipo === "SERVICE") return false;
  // Por defecto, asumimos que los no-servicio sí controlan stock
  return true;
};

// Heurística para IVA del producto (si no lo tiene, se usa luego el de la empresa)
const getProductIvaRate = (p: Producto, empresa?: Empresa | null): number => {
  const raw =
    p["iva_tarifa"] ??
    p["iva_codigo_porcentaje"] ??
    p["iva_porcentaje"] ??
    null;

  let fromProduct: number | null = null;

  if (typeof raw === "number") {
    fromProduct = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      fromProduct = parsed;
    }
  }

  if (fromProduct !== null) {
    return fromProduct;
  }

  if (empresa && empresa.iva_tarifa != null) {
    const eRaw: any = empresa.iva_tarifa;
    const n = typeof eRaw === "number" ? eRaw : Number(eRaw);
    if (Number.isFinite(n)) {
      return n;
    }
  }

  return 0;
};

/**
 * Normaliza la guía de remisión al formato SRI:
 *  EEE-PPP-######### (3-3-9 dígitos).
 *
 * Lógica:
 * - Acepta vacío -> OK, sin error.
 * - Quita todo lo que no sea dígito.
 * - Si los dígitos ≠ 15 → error.
 * - Si son 15 → devuelve "001-001-000000123".
 */
const normalizeGuiaRemisionForBackend = (
  raw: string,
): { value: string; error: string | null } => {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { value: "", error: null };
  }

  const digits = trimmed.replace(/\D/g, "");

  if (digits.length !== 15) {
    return {
      value: trimmed,
      error:
        "La guía de remisión debe tener exactamente 15 dígitos (formato 001-001-000000123).",
    };
  }

  const normalized = `${digits.slice(0, 3)}-${digits.slice(
    3,
    6,
  )}-${digits.slice(6)}`;

  return { value: normalized, error: null };
};

const InvoiceWizard: React.FC = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState<number>(1);

  // Paso 1: contexto general
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [establecimientos, setEstablecimientos] = useState<Establecimiento[]>(
    [],
  );
  const [puntosEmision, setPuntosEmision] = useState<PuntoEmision[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteSearch, setClienteSearch] = useState<string>("");

  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [establecimientoId, setEstablecimientoId] = useState<number | null>(
    null,
  );
  const [puntoEmisionId, setPuntoEmisionId] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [clienteSeleccionado, setClienteSeleccionado] =
    useState<Cliente | null>(null);
  const [fechaEmision, setFechaEmision] = useState<string>(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
  });
  const [descontarInventario, setDescontarInventario] =
    useState<boolean>(true);

  const [secuenciales, setSecuenciales] = useState<SecuencialDisponible[]>([]);
  const [secuencialPreview, setSecuencialPreview] = useState<string>("");

  // Datos de pago / adicionales (SRI y negocio)
  const [condicionPago, setCondicionPago] = useState<string>("Contado");
  const [referenciaPago, setReferenciaPago] = useState<string>("");
  const [observaciones, setObservaciones] = useState<string>("");
  const [guiaRemision, setGuiaRemision] = useState<string>("");
  const [placaVehiculo, setPlacaVehiculo] = useState<string>("");
  const [guiaRemisionError, setGuiaRemisionError] = useState<string | null>(
    null,
  );

  // Paso 2: líneas
  const [lines, setLines] = useState<InvoiceLineDraft[]>([]);
  const [productoSearchTerm, setProductoSearchTerm] = useState<string>("");
  const [productosEncontrados, setProductosEncontrados] = useState<Producto[]>(
    [],
  );
  const [productoCategoriaFilter, setProductoCategoriaFilter] =
    useState<string>("");
  const [productoTipoFilter, setProductoTipoFilter] = useState<string>("");

  // Estado general
  const [loadingInitial, setLoadingInitial] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // loaders específicos
  const [loadingClientes, setLoadingClientes] = useState<boolean>(false);
  const [loadingProductos, setLoadingProductos] = useState<boolean>(false);

  // =========================
  // Carga inicial: empresas, bodegas
  // =========================
  useEffect(() => {
    const cargarDatosIniciales = async () => {
      setLoadingInitial(true);
      try {
        // 1) Empresas
        const respEmp = await fetch("/api/billing/empresas/", {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
        });
        if (!respEmp.ok) {
          throw new Error(`Error HTTP ${respEmp.status} al cargar empresas`);
        }
        const dataEmpRaw: any = await respEmp.json();
        const dataEmp = ensureArray<Empresa>(dataEmpRaw);
        setEmpresas(dataEmp);

        if (dataEmp.length === 1) {
          setEmpresaId(dataEmp[0].id);
        }

        // 2) Bodegas (warehouses) desde inventario
        const respWh = await fetch("/api/inventory/warehouses/", {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
        });
        if (!respWh.ok) {
          throw new Error(`Error HTTP ${respWh.status} al cargar bodegas`);
        }
        const dataWhRaw: any = await respWh.json();
        const dataWh = ensureArray<Warehouse>(dataWhRaw);
        setWarehouses(dataWh);
      } catch (error: any) {
        console.error("Error cargando datos iniciales del wizard:", error);
        toast.error("Error al cargar datos iniciales de facturación.");
      } finally {
        setLoadingInitial(false);
      }
    };

    cargarDatosIniciales();
  }, []);

  // =========================
  // Cargar establecimientos cuando cambia empresa
  // =========================
  useEffect(() => {
    const cargarEstablecimientos = async () => {
      if (!empresaId) {
        setEstablecimientos([]);
        setEstablecimientoId(null);
        return;
      }
      try {
        const url = `/api/billing/establecimientos/?empresa=${empresaId}`;
        const resp = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
        });
        if (!resp.ok) {
          throw new Error(
            `Error HTTP ${resp.status} al cargar establecimientos`,
          );
        }
        const dataRaw: any = await resp.json();
        const data = ensureArray<Establecimiento>(dataRaw);
        setEstablecimientos(data);
        setEstablecimientoId(data.length ? data[0].id : null);
      } catch (error: any) {
        console.error("Error cargando establecimientos:", error);
        toast.error("Error al cargar establecimientos.");
      }
    };

    cargarEstablecimientos();
  }, [empresaId]);

  // =========================
  // Cargar puntos de emisión cuando cambia establecimiento
  // =========================
  useEffect(() => {
    const cargarPuntosEmision = async () => {
      if (!establecimientoId) {
        setPuntosEmision([]);
        setPuntoEmisionId(null);
        return;
      }
      try {
        const url = `/api/billing/puntos-emision/?establecimiento=${establecimientoId}`;
        const resp = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
        });
        if (!resp.ok) {
          throw new Error(
            `Error HTTP ${resp.status} al cargar puntos de emisión`,
          );
        }
        const dataRaw: any = await resp.json();
        const data = ensureArray<PuntoEmision>(dataRaw);
        setPuntosEmision(data);
        setPuntoEmisionId(data.length ? data[0].id : null);
      } catch (error: any) {
        console.error("Error cargando puntos de emisión:", error);
        toast.error("Error al cargar puntos de emisión.");
      }
    };

    cargarPuntosEmision();
  }, [establecimientoId]);

  // =========================
  // Cargar secuenciales disponibles cuando cambia empresa
  // =========================
  useEffect(() => {
    const cargarSecuenciales = async () => {
      if (!empresaId) {
        setSecuenciales([]);
        setSecuencialPreview("");
        return;
      }
      try {
        const list = await getSecuencialesDisponibles(empresaId);
        setSecuenciales(list || []);
      } catch (error: any) {
        console.error("Error cargando secuenciales:", error);
        toast.error("Error al cargar próxima factura.");
        setSecuenciales([]);
        setSecuencialPreview("");
      }
    };

    void cargarSecuenciales();
  }, [empresaId]);


  // Actualizar la vista previa del secuencial según empresa + establecimiento + punto
  useEffect(() => {
    if (!empresaId || !establecimientoId || !puntoEmisionId) {
      setSecuencialPreview("");
      return;
    }
    const found = secuenciales.find(
      (s) =>
        s.establecimiento_id === establecimientoId &&
        s.punto_emision_id === puntoEmisionId,
    );
    setSecuencialPreview(found?.next_factura || "");
  }, [empresaId, establecimientoId, puntoEmisionId, secuenciales]);

  // =========================
  // Búsqueda automática de clientes (debounce)
  // =========================
  useEffect(() => {
    const term = clienteSearch.trim();
    if (!term || term.length < 3) {
      setClientes([]);
      return;
    }

    let cancelled = false;
    setLoadingClientes(true);

    const timeoutId = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.append("search", term);
        params.append("page_size", "10");

        const resp = await fetch(`/api/clientes/?${params.toString()}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
        });
        if (!resp.ok) {
          throw new Error(`Error HTTP ${resp.status} al buscar clientes`);
        }
        const dataRaw: any = await resp.json();
        const results = ensureArray<Cliente>(dataRaw);
        if (!cancelled) {
          setClientes(results);
          if (!results.length) {
            toast.info("No se encontraron clientes con ese criterio.");
          }
        }
      } catch (error: any) {
        console.error("Error buscando clientes:", error);
        if (!cancelled) {
          toast.error("Error al buscar clientes.");
        }
      } finally {
        if (!cancelled) {
          setLoadingClientes(false);
        }
      }
    }, 400); // 400ms de debounce

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [clienteSearch]);

  const handleSeleccionarCliente = (cli: Cliente) => {
    setClienteSeleccionado(cli);
  };

  // =========================
  // Búsqueda automática de productos (debounce)
  // =========================
  useEffect(() => {
    const term = productoSearchTerm.trim();

    if (!term || term.length < 2) {
      setLoadingProductos(false);
      return;
    }

    let cancelled = false;
    setLoadingProductos(true);

    const timeoutId = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.append("search", term);
        params.append("page_size", "20");
        if (warehouseId) {
          params.append("warehouse", String(warehouseId));
          params.append("warehouse_id", String(warehouseId));
        }

        const resp = await fetch(`/api/productos/?${params.toString()}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
        });
        if (!resp.ok) {
          throw new Error(`Error HTTP ${resp.status} al buscar productos`);
        }
        const dataRaw: any = await resp.json();
        const results = ensureArray<Producto>(dataRaw);
        if (!cancelled) {
          setProductosEncontrados(results);
          if (!results.length) {
            toast.info("No se encontraron productos con ese criterio.");
          }
        }
      } catch (error: any) {
        console.error("Error buscando productos:", error);
        if (!cancelled) {
          toast.error("Error al buscar productos.");
        }
      } finally {
        if (!cancelled) {
          setLoadingProductos(false);
        }
      }
    }, 350); // 350ms de debounce

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [productoSearchTerm, warehouseId]);

  // =========================
  // Pre-carga inicial de productos al entrar en Paso 2
  // =========================
  useEffect(() => {
    if (step !== 2) return;
    if (productosEncontrados.length > 0) return;

    let cancelled = false;

    const cargarProductosIniciales = async () => {
      setLoadingProductos(true);
      try {
        const params = new URLSearchParams();
        params.append("page_size", "20");
        if (warehouseId) {
          params.append("warehouse", String(warehouseId));
          params.append("warehouse_id", String(warehouseId));
        }

        const resp = await fetch(`/api/productos/?${params.toString()}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
        });

        if (!resp.ok) {
          throw new Error(
            `Error HTTP ${resp.status} al cargar productos iniciales`,
          );
        }

        const dataRaw: any = await resp.json();
        const results = ensureArray<Producto>(dataRaw);

        if (!cancelled) {
          setProductosEncontrados(results);
        }
      } catch (error: any) {
        console.error("Error cargando productos iniciales:", error);
        if (!cancelled) {
          toast.error("Error al cargar productos iniciales.");
        }
      } finally {
        if (!cancelled) {
          setLoadingProductos(false);
        }
      }
    };

    void cargarProductosIniciales();

    return () => {
      cancelled = true;
    };
  }, [step, warehouseId, productosEncontrados.length]);

  // Catálogo dinámico de categorías / tipos basado en resultados actuales
  const productoCategoriasDisponibles = useMemo(
    () =>
      Array.from(
        new Set(
          productosEncontrados
            .map((p) => (p.categoria as string) || "")
            .map((v) => v.toString().trim())
            .filter(Boolean),
        ),
      ),
    [productosEncontrados],
  );

  const productoTiposDisponibles = useMemo(
    () =>
      Array.from(
        new Set(
          productosEncontrados
            .map((p) => getProductTipoLabel(p))
            .map((v) => v.toString().trim())
            .filter(Boolean),
        ),
      ),
    [productosEncontrados],
  );

  const productosFiltrados = useMemo(() => {
    return productosEncontrados.filter((p) => {
      const categoria = ((p.categoria as string) || "").toString().trim();
      const tipo = getProductTipoLabel(p);

      if (productoCategoriaFilter && categoria !== productoCategoriaFilter) {
        return false;
      }
      if (productoTipoFilter && tipo !== productoTipoFilter) {
        return false;
      }
      return true;
    });
  }, [productosEncontrados, productoCategoriaFilter, productoTipoFilter]);

  // =========================
  // Añadir producto como línea
  // =========================
  const addProductAsLine = async (prod: Producto) => {
    const esServicio = isServicioProduct(prod);
    const controlaStock = controlsStock(prod);

    let stockActual: number | null = null;

    if (warehouseId) {
      try {
        const params = new URLSearchParams();
        params.append("warehouse", String(warehouseId));
        params.append("warehouse_id", String(warehouseId));
        params.append("product", String(prod.id));
        params.append("product_id", String(prod.id));

        const resp = await fetch(
          `/api/inventory/stock/?${params.toString()}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            credentials: "include",
          },
        );
        if (resp.ok) {
          const data: any = await resp.json();
          let item: any | undefined;

          if (Array.isArray(data) && data.length) {
            item = data[0];
          } else if (data && Array.isArray(data.results) && data.results.length) {
            item = data.results[0];
          } else if (data && typeof data === "object") {
            item = data;
          }

          if (item) {
            const candidates = [
              item.quantity,
              item.qty,
              item.qty_available,
              item.available_quantity,
              item.cantidad,
              item.cantidad_disponible,
            ];

            const found = candidates.find(
              (v) => v !== null && v !== undefined && v !== "",
            );

            if (found !== undefined) {
              const qNum =
                typeof found === "number"
                  ? found
                  : Number(String(found).trim());
              stockActual = Number.isFinite(qNum) ? qNum : null;
            }
          }
        } else {
          console.warn(
            "Respuesta no OK al obtener stock (status):",
            resp.status,
          );
        }
      } catch (error: any) {
        console.warn("No se pudo obtener stock para producto:", error);
      }
    }

    const code = getProductDisplayCode(prod);
    const name = getProductDisplayName(prod);
    const defaultPrice = getProductUnitPrice(prod);
    const empresaActual =
      empresaId != null
        ? empresas.find((e) => e.id === empresaId) || null
        : null;
    const ivaTarifaLinea = getProductIvaRate(prod, empresaActual);

    setLines((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        product_id: prod.id,
        product_label: code
          ? `${code} · ${name || "(Sin nombre)"}`
          : name || "(Sin nombre)",
        cantidad: 1,
        precio_unitario: defaultPrice,
        descuento: 0,
        stock_actual: stockActual,
        es_servicio: esServicio,
        controla_stock: controlaStock,
        iva_tarifa: Number.isFinite(ivaTarifaLinea) ? ivaTarifaLinea : 0,
      },
    ]);
  };

  const updateLineField = (
    lineId: number,
    field: keyof InvoiceLineDraft,
    value: any,
  ) => {
    setLines((prev) =>
      prev.map((ln) =>
        ln.id === lineId
          ? {
              ...ln,
              [field]:
                field === "cantidad" ||
                field === "precio_unitario" ||
                field === "descuento" ||
                field === "iva_tarifa"
                  ? Number(value) || 0
                  : value,
            }
          : ln,
      ),
    );
  };

  const removeLine = (lineId: number) => {
    setLines((prev) => prev.filter((ln) => ln.id !== lineId));
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let descuentoTotal = 0;
    let total = 0;
    let impuestos = 0;

    let ivaTarifaEmpresa = 0;
    if (empresaId && empresas.length > 0) {
      const emp = empresas.find((e) => e.id === empresaId);
      if (emp && emp.iva_tarifa != null) {
        const raw: any = emp.iva_tarifa;
        const n = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(n)) {
          ivaTarifaEmpresa = n;
        }
      }
    }

    for (const line of lines) {
      const base = (line.cantidad || 0) * (line.precio_unitario || 0);
      const desc = line.descuento || 0;
      const net = base - desc;
      subtotal += base;
      descuentoTotal += desc;
      total += net;

      const ivaRate =
        line.iva_tarifa != null ? line.iva_tarifa : ivaTarifaEmpresa;
      if (ivaRate && net > 0) {
        impuestos += (net * ivaRate) / 100;
      }
    }

    return {
      subtotal,
      descuentoTotal,
      impuestos,
      total,
    };
  }, [lines, empresaId, empresas]);

  // =========================
  // Navegación de pasos
  // =========================
  const isFechaEmisionValida = (): boolean => {
    if (!fechaEmision) return false;
    const f = new Date(`${fechaEmision}T00:00:00`);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (f.getTime() > hoy.getTime()) {
      return false;
    }
    return true;
  };

  const canGoNextFromStep1 = (): boolean => {
    const baseValid = !!(
      empresaId &&
      establecimientoId &&
      puntoEmisionId &&
      clienteSeleccionado &&
      fechaEmision
    );

    if (!baseValid) {
      return false;
    }

    if (!isFechaEmisionValida()) {
      return false;
    }

    if (descontarInventario && !warehouseId) {
      return false;
    }

    return true;
  };

  const handleNext = () => {
    if (step === 1) {
      if (!canGoNextFromStep1()) {
        if (!isFechaEmisionValida()) {
          toast.info("La fecha de emisión no puede ser futura.");
          return;
        }
        if (descontarInventario && !warehouseId) {
          toast.info(
            "Selecciona una bodega de origen si deseas descontar inventario al autorizar.",
          );
        } else {
          toast.info("Completa todos los campos obligatorios del Paso 1.");
        }
        return;
      }
    }
    if (step === 2 && lines.length === 0) {
      toast.info("Agrega al menos una línea de detalle en el Paso 2.");
      return;
    }
    setStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrev = () => {
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const handleCancelar = () => {
    if (
      window.confirm(
        "¿Seguro que deseas cancelar? Se perderán los datos no guardados.",
      )
    ) {
      navigate("/billing/invoices");
    }
  };

  // =========================
  // Envío (crear factura)
  // =========================
  const handleConfirmar = async () => {
    if (!empresaId || !establecimientoId || !puntoEmisionId) {
      toast.error("Faltan datos esenciales para emitir la factura.");
      return;
    }
    if (!clienteSeleccionado) {
      toast.error("Selecciona un cliente antes de confirmar.");
      return;
    }
    if (!lines.length) {
      toast.error("La factura debe tener al menos una línea.");
      return;
    }

    if (!isFechaEmisionValida()) {
      toast.error("La fecha de emisión no puede ser futura.");
      return;
    }

    // Normalizar y validar guía de remisión ANTES de enviar al backend
    const { value: guiaRemisionNormalizada, error: guiaError } =
      normalizeGuiaRemisionForBackend(guiaRemision);

    if (guiaError) {
      setGuiaRemisionError(guiaError);
      toast.error(guiaError);
      return;
    }
    setGuiaRemisionError(null);

    // Si el usuario ingresó algo válido, sincronizamos la versión normalizada para que la vea
    if (guiaRemision && guiaRemision !== guiaRemisionNormalizada) {
      setGuiaRemision(guiaRemisionNormalizada);
    }

    const hayLineasConInventario = lines.some(
      (ln) => !ln.es_servicio && ln.controla_stock && descontarInventario,
    );

    if (hayLineasConInventario && !warehouseId) {
      toast.error(
        "Debes seleccionar una bodega para productos físicos cuando se descuenta inventario.",
      );
      return;
    }

    // Totales a nivel de factura
    const total_sin_impuestos = totals.total;
    const total_descuento = totals.descuentoTotal;
    const propina = 0;
    const importe_total = totals.total + totals.impuestos;

    // Snapshot de comprador
    const tipo_identificacion_comprador = inferTipoIdentificacion(
      clienteSeleccionado.identificador,
    );
    const identificacion_comprador = clienteSeleccionado.identificador || "";
    const razon_social_comprador = clienteSeleccionado.nombre || "";
    const direccion_comprador = clienteSeleccionado.direccion || "";
    const email_comprador = clienteSeleccionado.email || "";
    const telefono_comprador = clienteSeleccionado.celular || "";

    // Datos de pago y adicionales
    const condicion_pago = (condicionPago || "").trim();
    const referencia_pago = (referenciaPago || "").trim();

    let observaciones_compuestas = (observaciones || "").trim();

    const guiaRemisionTrim = (guiaRemisionNormalizada || "").trim();
    const placaVehiculoTrim = (placaVehiculo || "").trim();

    if (guiaRemisionTrim) {
      observaciones_compuestas +=
        (observaciones_compuestas ? " | " : "") +
        `Guía de remisión: ${guiaRemisionTrim}`;
    }

    if (placaVehiculoTrim) {
      observaciones_compuestas +=
        (observaciones_compuestas ? " | " : "") +
        `Placa: ${placaVehiculoTrim}`;
    }

    // Mapeo de condición de pago a forma_pago / plazo_pago
    let forma_pago: string | null = null;
    let plazo_pago: number | null = null;

    const cp = (condicion_pago || "").toLowerCase();

    if (cp.includes("contado")) {
      forma_pago = "01";
      plazo_pago = 0;
    } else if (cp.includes("crédito 30") || cp.includes("credito 30")) {
      forma_pago = "20";
      plazo_pago = 30;
    } else if (cp.includes("crédito 60") || cp.includes("credito 60")) {
      forma_pago = "20";
      plazo_pago = 60;
    } else if (
      cp.includes("tarjeta de crédito") ||
      cp.includes("tarjeta de credito")
    ) {
      forma_pago = "19";
      plazo_pago = 0;
    } else if (
      cp.includes("transferencia") ||
      cp.includes("depósito") ||
      cp.includes("deposito")
    ) {
      forma_pago = "20";
      plazo_pago = 0;
    } else if (cp.includes("cheque")) {
      forma_pago = "20";
      plazo_pago = 0;
    }

    const forma_pago_final = forma_pago ?? "01";
    const plazo_pago_final =
      plazo_pago != null && plazo_pago >= 0 ? plazo_pago : 0;

    // Construimos payload empezando SOLO con campos obligatorios/relevantes
    const payload: any = {
      empresa: empresaId,
      establecimiento: establecimientoId,
      punto_emision: puntoEmisionId,
      warehouse: hayLineasConInventario ? warehouseId : null,
      descontar_inventario: descontarInventario,
      cliente: clienteSeleccionado.id,
      fecha_emision: fechaEmision,
      total_sin_impuestos,
      total_descuento,
      propina,
      importe_total,
      moneda: "USD",
      tipo_identificacion_comprador,
      identificacion_comprador,
      razon_social_comprador,
      direccion_comprador,
      email_comprador,
      telefono_comprador,
      forma_pago: forma_pago_final,
      plazo_pago: plazo_pago_final,
      lines: lines.map((ln) => {
        const base =
          (ln.cantidad || 0) * (ln.precio_unitario || 0) -
          (ln.descuento || 0);
        const precio_total_sin_impuesto = base < 0 ? 0 : base;

        return {
          producto: ln.product_id,
          cantidad: ln.cantidad,
          precio_unitario: ln.precio_unitario,
          descuento: ln.descuento,
          precio_total_sin_impuesto,
          es_servicio: ln.es_servicio,
        };
      }),
    };

    // Campos OPCIONALES: solo se añaden si tienen valor
    if (condicion_pago) {
      payload.condicion_pago = condicion_pago;
    }
    if (referencia_pago) {
      payload.referencia_pago = referencia_pago;
    }
    if (guiaRemisionTrim) {
      payload.guia_remision = guiaRemisionTrim;
    }
    if (placaVehiculoTrim) {
      payload.placa = placaVehiculoTrim;
    }
    if (observaciones_compuestas) {
      payload.observaciones = observaciones_compuestas;
    }

    setSubmitting(true);
    try {
      const data = (await createInvoice(payload)) as InvoiceCreateResponse;
      toast.success(
        `Factura creada correctamente (${data.secuencial_display}).`,
      );
      navigate(`/billing/invoices/${data.id}`);
    } catch (error: any) {
      console.error("Error creando factura:", error);
      const msg =
        error?.message ||
        "Error al crear la factura. Revisa los datos e inténtalo de nuevo.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // =========================
  // Render
  // =========================
  return (
    <div className="px-4 py-4 md:py-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-800 md:text-xl">
            Nueva factura electrónica
          </h1>
          <p className="text-xs text-gray-500 md:text-sm">
            Asistente guiado para emitir una factura integrada con inventario.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleCancelar}
            className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-auto"
          >
            Cancelar
          </button>
        </div>
      </div>

      <div className="mx-auto mt-4 max-w-5xl">
        {/* Indicador simple de pasos */}
        <div className="mb-4 flex items-center justify-center gap-2 text-xs">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center gap-1">
              <div
                className={[
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold",
                  step === s
                    ? "border-blue-500 bg-blue-500 text-white"
                    : step > s
                    ? "border-green-500 bg-green-500 text-white"
                    : "border-gray-300 bg-white text-gray-600",
                ].join(" ")}
              >
                {s}
              </div>
              {s < 4 && <div className="h-px w-6 bg-gray-300" />}
            </div>
          ))}
        </div>

        {loadingInitial ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500 shadow-sm">
            Cargando datos iniciales...
          </div>
        ) : (
          <>
            {/* Paso 1 */}
            {step === 1 && (
              <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-gray-700">
                  Paso 1 · Datos generales
                </h2>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Empresa
                    </label>
                    <select
                      value={empresaId ?? ""}
                      onChange={(e) =>
                        setEmpresaId(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Selecciona empresa</option>
                      {empresas.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.razon_social} ({emp.ruc})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Establecimiento
                    </label>
                    <select
                      value={establecimientoId ?? ""}
                      onChange={(e) =>
                        setEstablecimientoId(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Selecciona establecimiento</option>
                      {establecimientos.map((est) => (
                        <option key={est.id} value={est.id}>
                          {est.codigo} - {est.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Punto de emisión
                    </label>
                    <select
                      value={puntoEmisionId ?? ""}
                      onChange={(e) =>
                        setPuntoEmisionId(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Selecciona punto de emisión</option>
                      {puntosEmision.map((pe) => (
                        <option key={pe.id} value={pe.id}>
                          {pe.codigo}
                          {pe.descripcion ? ` - ${pe.descripcion}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Bodega origen (para descontar inventario)
                    </label>
                    <select
                      value={warehouseId ?? ""}
                      onChange={(e) =>
                        setWarehouseId(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Selecciona bodega</option>
                      {warehouses.map((wh) => (
                        <option key={wh.id} value={wh.id}>
                          {wh.code} - {wh.name}
                        </option>
                      ))}
                    </select>
                    {descontarInventario && !warehouseId && (
                      <p className="mt-1 text-[11px] text-yellow-700">
                        Si vas a descontar inventario, selecciona una bodega
                        antes de continuar.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Fecha de emisión
                    </label>
                    <input
                      type="date"
                      value={fechaEmision}
                      onChange={(e) => setFechaEmision(e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {!isFechaEmisionValida() && fechaEmision && (
                      <p className="mt-1 text-[11px] text-red-600">
                        La fecha de emisión no puede ser futura.
                      </p>
                    )}
                  </div>

                  <div className="flex items-end">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={descontarInventario}
                        onChange={(e) =>
                          setDescontarInventario(e.target.checked)
                        }
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Descontar inventario al autorizar
                    </label>
                  </div>
                </div>

                {/* Cliente */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Cliente (escribe para buscar)
                    </label>
                    <div className="mt-1">
                      <input
                        type="text"
                        value={clienteSearch}
                        onChange={(e) => setClienteSearch(e.target.value)}
                        className="block w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Mínimo 3 caracteres: RUC, CI, nombre..."
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {loadingClientes
                        ? "Buscando clientes..."
                        : "Los resultados aparecen automáticamente mientras escribes."}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Cliente seleccionado
                    </label>
                    <div className="mt-1 min-h-[2.5rem] rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-800">
                      {clienteSeleccionado ? (
                        <div>
                          <div className="font-semibold">
                            {clienteSeleccionado.nombre}
                          </div>
                          <div>
                            {clienteSeleccionado.identificador} ·{" "}
                            {clienteSeleccionado.email || "sin email"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-500">
                          Ningún cliente seleccionado aún.
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {clientes.length > 0 && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-700">
                        Resultados de búsqueda ({clientes.length})
                      </span>
                      <span className="text-[11px] text-gray-500">
                        Haz clic para seleccionar un cliente
                      </span>
                    </div>
                    <div className="max-h-40 overflow-auto text-xs">
                      {clientes.map((cli) => (
                        <button
                          key={cli.id}
                          type="button"
                          onClick={() => handleSeleccionarCliente(cli)}
                          className={[
                            "flex w-full items-center justify-between rounded px-2 py-1 text-left",
                            clienteSeleccionado?.id === cli.id
                              ? "bg-blue-50 text-blue-800"
                              : "hover:bg-white",
                          ].join(" ")}
                        >
                          <div>
                            <div className="font-semibold">{cli.nombre}</div>
                            <div className="text-[11px] text-gray-600">
                              {cli.identificador} ·{" "}
                              {cli.email || "sin email"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Próxima factura */}
                <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-2 text-xs text-gray-700">
                  Próxima factura estimada:{" "}
                  <span className="font-mono font-semibold">
                    {secuencialPreview || "—"}
                  </span>
                </div>
              </div>
            )}

            {/* Paso 2 */}
            {step === 2 && (
              <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-gray-700">
                  Paso 2 · Detalle de productos/servicios
                </h2>

                {/* Buscador de productos */}
                <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs font-medium text-gray-700">
                    <span>Buscar productos</span>
                    {loadingProductos && (
                      <span className="text-[11px] text-gray-500">
                        Buscando...
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={productoSearchTerm}
                      onChange={(e) => setProductoSearchTerm(e.target.value)}
                      className="min-w-[200px] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Mínimo 2 caracteres: código o nombre..."
                    />
                    <select
                      value={productoCategoriaFilter}
                      onChange={(e) =>
                        setProductoCategoriaFilter(e.target.value)
                      }
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Todas las categorías</option>
                      {productoCategoriasDisponibles.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <select
                      value={productoTipoFilter}
                      onChange={(e) => setProductoTipoFilter(e.target.value)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Todos los tipos</option>
                      {productoTiposDisponibles.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  {warehouseId ? (
                    <p className="mt-1 text-[11px] text-gray-500">
                      Se mostrará el stock actual por la bodega seleccionada en
                      el Paso 1 (para productos físicos que controlan stock).
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-yellow-700">
                      Para ver stock aproximado de productos físicos, selecciona
                      primero una bodega en el Paso 1.
                    </p>
                  )}

                  {productosEncontrados.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-auto rounded-md border border-gray-200 bg-white text-xs">
                      {productosFiltrados.length > 0 ? (
                        productosFiltrados.map((prod) => {
                          const code = getProductDisplayCode(prod);
                          const name = getProductDisplayName(prod);
                          const cat = (prod.categoria as string) || "";
                          const tipo = getProductTipoLabel(prod);
                          return (
                            <button
                              key={prod.id}
                              type="button"
                              onClick={() => addProductAsLine(prod)}
                              className="flex w-full items-center justify-between px-2 py-1 text-left hover:bg-gray-50"
                            >
                              <div>
                                <div className="font-semibold">
                                  {code || "—"} · {name || "(Sin nombre)"}
                                </div>
                                <div className="text-[11px] text-gray-500">
                                  {cat}
                                  {tipo
                                    ? cat
                                      ? ` · ${String(tipo)}`
                                      : String(tipo)
                                    : ""}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-2 py-2 text-[11px] text-gray-500">
                          No hay productos que coincidan con los filtros de
                          categoría/tipo.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tabla de líneas */}
                <div className="rounded-md border border-gray-200">
                  <div className="border-b border-gray-200 px-3 py-2">
                    <span className="text-xs font-semibold text-gray-700">
                      Líneas de detalle
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">
                            Producto
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">
                            Cantidad
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">
                            Precio unitario
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">
                            Descuento
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">
                            Total línea
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">
                            Stock
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">
                            Acciones
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {lines.length === 0 && (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-3 py-3 text-center text-gray-500"
                            >
                              Aún no has agregado líneas. Escribe para buscar un
                              producto y haz clic para añadirlo.
                            </td>
                          </tr>
                        )}
                        {lines.map((ln) => {
                          const base =
                            (ln.cantidad || 0) * (ln.precio_unitario || 0);
                          const net = base - (ln.descuento || 0);
                          return (
                            <tr key={ln.id}>
                              <td className="px-3 py-1 text-[11px] text-gray-800">
                                {ln.product_label}
                                {ln.es_servicio && (
                                  <span className="ml-1 rounded bg-purple-50 px-1 text-[10px] text-purple-700">
                                    Servicio
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1 text-right">
                                <input
                                  type="number"
                                  min={0}
                                  value={ln.cantidad}
                                  onChange={(e) =>
                                    updateLineField(
                                      ln.id,
                                      "cantidad",
                                      e.target.value,
                                    )
                                  }
                                  className="w-20 rounded-md border border-gray-300 px-1 py-0.5 text-right text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-1 text-right">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={ln.precio_unitario}
                                  onChange={(e) =>
                                    updateLineField(
                                      ln.id,
                                      "precio_unitario",
                                      e.target.value,
                                    )
                                  }
                                  className="w-24 rounded-md border border-gray-300 px-1 py-0.5 text-right text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-1 text-right">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={ln.descuento}
                                  onChange={(e) =>
                                    updateLineField(
                                      ln.id,
                                      "descuento",
                                      e.target.value,
                                    )
                                  }
                                  className="w-24 rounded-md border border-gray-300 px-1 py-0.5 text-right text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-1 text-right font-semibold text-gray-800">
                                {formatMoney(net)}
                              </td>
                              <td className="px-3 py-1 text-right text-gray-600">
                                {ln.es_servicio ? (
                                  "N/A"
                                ) : ln.stock_actual === null ? (
                                  "—"
                                ) : (
                                  <div className="inline-flex flex-col items-end">
                                    <span>{ln.stock_actual}</span>
                                    {descontarInventario &&
                                      ln.controla_stock &&
                                      typeof ln.stock_actual === "number" &&
                                      ln.cantidad > ln.stock_actual && (
                                        <span className="mt-0.5 rounded bg-red-50 px-1 text-[10px] font-semibold text-red-700">
                                          Excede stock
                                        </span>
                                      )}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-1 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeLine(ln.id)}
                                  className="rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-100"
                                >
                                  Quitar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Paso 3 */}
            {step === 3 && (
              <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-gray-700">
                  Paso 3 · Totales, impuestos y condiciones de pago
                </h2>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                    <h3 className="mb-2 text-xs font-semibold text-gray-700">
                      Resumen de líneas
                    </h3>
                    {lines.length === 0 ? (
                      <p>No hay líneas todavía.</p>
                    ) : (
                      <ul className="space-y-1">
                        {lines.map((ln) => (
                          <li key={ln.id}>
                            <span className="font-semibold">
                              {ln.cantidad} x {ln.product_label}
                            </span>{" "}
                            · {formatMoney(ln.precio_unitario)} cada uno
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                    <h3 className="mb-2 text-xs font-semibold text-gray-700">
                      Resumen económico (estimado)
                    </h3>
                    <dl className="space-y-1">
                      <div className="flex justify-between">
                        <dt>Subtotal bruto:</dt>
                        <dd>{formatMoney(totals.subtotal)} USD</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Descuento total:</dt>
                        <dd>{formatMoney(totals.descuentoTotal)} USD</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Impuestos (estimado):</dt>
                        <dd>{formatMoney(totals.impuestos)} USD</dd>
                      </div>
                      <div className="flex justify-between border-t border-dashed border-gray-300 pt-1">
                        <dt className="font-semibold">Total:</dt>
                        <dd className="font-semibold">
                          {formatMoney(totals.total + totals.impuestos)} USD
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-[10px] text-gray-500">
                      El cálculo de IVA es estimado por línea (según tarifa del
                      producto o, en su defecto, de la empresa). El backend
                      recalculará los totales oficiales antes de enviar al SRI.
                    </p>
                  </div>
                </div>

                {/* Condición de pago y datos de envío/transporte */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                    <h3 className="mb-2 text-xs font-semibold text-gray-700">
                      Condición y referencia de pago
                    </h3>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600">
                          Condición de pago
                        </label>
                        <select
                          value={condicionPago}
                          onChange={(e) => setCondicionPago(e.target.value)}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Selecciona condición</option>
                          <option value="Contado">Contado</option>
                          <option value="Crédito 30 días">
                            Crédito 30 días
                          </option>
                          <option value="Crédito 60 días">
                            Crédito 60 días
                          </option>
                          <option value="Tarjeta de crédito">
                            Tarjeta de crédito
                          </option>
                          <option value="Transferencia bancaria">
                            Transferencia bancaria
                          </option>
                          <option value="Depósito bancario">
                            Depósito bancario
                          </option>
                          <option value="Cheque">Cheque</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600">
                          Referencia de pago (opcional)
                        </label>
                        <input
                          type="text"
                          value={referenciaPago}
                          onChange={(e) => setReferenciaPago(e.target.value)}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="Ej: Depósito Banco Pichincha, voucher 123456"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                    <h3 className="mb-2 text-xs font-semibold text-gray-700">
                      Datos de envío / transporte
                    </h3>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600">
                          Guía de remisión (opcional)
                        </label>
                        <input
                          type="text"
                          value={guiaRemision}
                          onChange={(e) => {
                            setGuiaRemision(e.target.value);
                            if (guiaRemisionError) {
                              setGuiaRemisionError(null);
                            }
                          }}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="Ej: 001-001-000000123"
                        />
                        {guiaRemisionError && (
                          <p className="mt-1 text-[10px] text-red-600">
                            {guiaRemisionError}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600">
                          Placa vehículo (opcional)
                        </label>
                        <input
                          type="text"
                          value={placaVehiculo}
                          onChange={(e) => setPlacaVehiculo(e.target.value)}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="Ej: PBA-0123"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Observaciones generales */}
                <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                  <h3 className="mb-2 text-xs font-semibold text-gray-700">
                    Observaciones adicionales (opcional)
                  </h3>
                  <textarea
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Ej: Entrega inmediata, precios incluyen instalación básica, etc."
                  />
                  <p className="mt-1 text-[10px] text-gray-500">
                    Estas observaciones se enviarán al SRI dentro de
                    infoAdicional y se mostrarán en el RIDE. La guía de remisión
                    y la placa, si se ingresan, se concatenan automáticamente
                    aquí.
                  </p>
                </div>
              </div>
            )}

            {/* Paso 4 */}
            {step === 4 && (
              <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-gray-700">
                  Paso 4 · Confirmación
                </h2>
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                  <p className="mb-2">
                    Estás a punto de crear una factura con los siguientes datos:
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      Empresa:{" "}
                      <strong>
                        {
                          empresas.find((e) => e.id === empresaId)
                            ?.razon_social
                        }
                      </strong>
                    </li>
                    <li>
                      Cliente:{" "}
                      <strong>
                        {clienteSeleccionado
                          ? `${clienteSeleccionado.nombre} (${clienteSeleccionado.identificador})`
                          : "-"}
                      </strong>
                    </li>
                    <li>
                      Bodega origen:{" "}
                      <strong>
                        {warehouses.find((w) => w.id === warehouseId)?.name ||
                          (lines.some(
                            (ln) =>
                              !ln.es_servicio &&
                              ln.controla_stock &&
                              descontarInventario,
                          )
                            ? "No seleccionada (requerida)"
                            : "No aplica")}
                      </strong>
                    </li>
                    <li>
                      Condición de pago:{" "}
                      <strong>{condicionPago || "No especificada"}</strong>
                    </li>
                    <li>
                      Referencia de pago:{" "}
                      <strong>
                        {referenciaPago || "Sin referencia registrada"}
                      </strong>
                    </li>
                    <li>
                      Guía de remisión:{" "}
                      <strong>{guiaRemision || "No registrada"}</strong>
                    </li>
                    <li>
                      Placa vehículo:{" "}
                      <strong>{placaVehiculo || "No registrada"}</strong>
                    </li>
                    <li>
                      Fecha emisión: <strong>{fechaEmision}</strong>
                    </li>
                    <li>
                      Número estimado:{" "}
                      <strong>{secuencialPreview || "pendiente"}</strong>
                    </li>
                    <li>
                      Total estimado:{" "}
                      <strong>
                        {formatMoney(totals.total + totals.impuestos)} USD
                      </strong>
                    </li>
                  </ul>
                  <p className="mt-3 text-[11px] text-gray-600">
                    Al confirmar, se creará la factura en el backend. A partir
                    de esa factura, el sistema podrá generar automáticamente los
                    movimientos de inventario y los egresos contables asociados
                    según las reglas de negocio configuradas.
                  </p>
                </div>
              </div>
            )}

            {/* Controles inferiores */}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handlePrev}
                disabled={step === 1}
                className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Anterior
              </button>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                {step < 4 && (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-auto"
                  >
                    Siguiente
                  </button>
                )}
                {step === 4 && (
                  <button
                    type="button"
                    onClick={handleConfirmar}
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center rounded-md bg-green-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-green-500 sm:w-auto"
                  >
                    {submitting ? "Creando factura..." : "Confirmar y crear"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InvoiceWizard;
