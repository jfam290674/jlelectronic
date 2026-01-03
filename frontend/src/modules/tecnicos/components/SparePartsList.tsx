// src/modules/tecnicos/components/SparePartsList.tsx
/**
 * Lista editable de repuestos con integración a bodega.
 * 
 * CARACTERÍSTICAS:
 * - Selector de bodega
 * - Búsqueda filtrada por bodega y categoría REPUESTO
 * - Dropdown con resultados (foto, nombre, SKU, stock disponible)
 * - Selección desde bodega (product_id) o entrada manual (sin product_id)
 * - Validación de stock disponible
 */

import * as React from "react";
import {
  PlusIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  BuildingStorefrontIcon,
} from "@heroicons/react/24/outline";
import type { ReportSpare } from "../api/reports";
import { listStock } from "../../inventory/api/inventory";
import { listWarehouses } from "../../inventory/api/warehouses";
import type { StockItem } from "../../inventory/types";
import type { Warehouse } from "../../inventory/types";

interface SparePartsListProps {
  spares: ReportSpare[];
  onChange: (spares: ReportSpare[]) => void;
  label?: string;
}

export default function SparePartsList({
  spares,
  onChange,
  label = "Repuestos utilizados",
}: SparePartsListProps): React.ReactElement {
  const [searchMode, setSearchMode] = React.useState<"bodega" | "manual">("bodega");
  const [selectedWarehouse, setSelectedWarehouse] = React.useState<number | null>(null);
  const [warehouses, setWarehouses] = React.useState<Warehouse[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<StockItem[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [showResults, setShowResults] = React.useState(false);
  const [manualDescription, setManualDescription] = React.useState("");
  const [manualQuantity, setManualQuantity] = React.useState(1);

  // Cargar lista de bodegas
  React.useEffect(() => {
    (async () => {
      try {
        const data = await listWarehouses({ active: true, page_size: 100 });
        setWarehouses(data.results || []);
        // ✅ FIX: Convertir ID a number si es necesario
        if (data.results && data.results.length > 0) {
          const firstId = data.results[0].id;
          const warehouseId = typeof firstId === "string" ? parseInt(firstId, 10) : firstId;
          setSelectedWarehouse(warehouseId);
        }
      } catch (err) {
        console.error("Error cargando bodegas:", err);
      }
    })();
  }, []);

  // Helper: construir nombre del producto desde product_info
  const getProductName = (productInfo: any): string => {
    if (!productInfo) return "Producto sin información";
    
    const brand = productInfo.brand || "";
    const model = productInfo.model || "";
    if (brand && model) return `${brand} ${model}`;
    if (brand) return brand;
    if (model) return model;
    if (productInfo.code) return productInfo.code;
    if (productInfo.alt_code) return productInfo.alt_code;
    
    return `Producto #${productInfo.id || "?"}`;
  };

  // Helper: obtener código/SKU del producto
  const getProductCode = (productInfo: any): string | null => {
    if (!productInfo) return null;
    return productInfo.code || productInfo.alt_code || null;
  };

  // Debounced search
  React.useEffect(() => {
    if (searchMode !== "bodega" || searchQuery.trim().length < 2 || !selectedWarehouse) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        // ✅ FILTRAR POR: bodega seleccionada + categoría REPUESTO
        const data = await listStock({
          q: searchQuery.trim(),
          warehouse: selectedWarehouse,
          categoria: "REPUESTO",
          page_size: 10,
        });
        setSearchResults(data.results || []);
        setShowResults(true);
      } catch (err) {
        console.error("Error buscando productos:", err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, searchMode, selectedWarehouse]);

  // Agregar repuesto desde bodega
  const addFromBodega = (item: StockItem) => {
    const maxOrder = spares.length > 0 ? Math.max(...spares.map((s) => s.order)) : 0;

    const productId = typeof item.product === "string" 
      ? parseInt(item.product, 10) 
      : item.product;

    onChange([
      ...spares,
      {
        product: productId,
        description: getProductName(item.product_info),
        quantity: 1,
        order: maxOrder + 1,
      },
    ]);

    setSearchQuery("");
    setShowResults(false);
  };

  // Agregar repuesto manual
  const addManual = () => {
    const desc = manualDescription.trim();
    if (!desc) return;

    const maxOrder = spares.length > 0 ? Math.max(...spares.map((s) => s.order)) : 0;

    onChange([
      ...spares,
      {
        product: null,
        description: desc,
        quantity: manualQuantity,
        order: maxOrder + 1,
      },
    ]);

    setManualDescription("");
    setManualQuantity(1);
  };

  // Eliminar repuesto
  const removeSpare = (index: number) => {
    const updated = spares.filter((_, i) => i !== index);
    onChange(updated.map((s, i) => ({ ...s, order: i + 1 })));
  };

  // Actualizar cantidad
  const updateQuantity = (index: number, quantity: number) => {
    const updated = [...spares];
    updated[index] = { ...updated[index], quantity: Math.max(1, quantity) };
    onChange(updated);
  };

  // Actualizar descripción (solo para manuales)
  const updateDescription = (index: number, description: string) => {
    const updated = [...spares];
    updated[index] = { ...updated[index], description };
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      {label && (
        <label className="block text-sm font-medium text-slate-700">{label}</label>
      )}

      {/* Lista de repuestos agregados */}
      {spares.length > 0 && (
        <div className="space-y-2">
          {spares.map((spare, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-3 rounded-lg border-2 border-slate-300 bg-white"
            >
              <div
                className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                  spare.product
                    ? "bg-blue-100 text-blue-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                <CubeIcon className="h-5 w-5" />
              </div>

              <input
                type="number"
                min="1"
                value={spare.quantity}
                onChange={(e) => updateQuantity(index, parseInt(e.target.value) || 1)}
                className="w-16 px-2 py-2 rounded-lg border-2 border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm text-center font-medium"
              />

              <div className="flex-1">
                {spare.product ? (
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {spare.description}
                    </p>
                    <p className="text-xs text-blue-600">
                      Desde bodega (ID: {spare.product})
                    </p>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={spare.description || ""}
                    onChange={(e) => updateDescription(index, e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm"
                    placeholder="Descripción del repuesto"
                  />
                )}
              </div>

              <button
                type="button"
                onClick={() => removeSpare(index)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Eliminar"
              >
                <TrashIcon className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toggle: Bodega vs Manual */}
      <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
        <button
          type="button"
          onClick={() => setSearchMode("bodega")}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            searchMode === "bodega"
              ? "bg-[#0A3D91] text-white shadow-md"
              : "text-slate-600 hover:bg-slate-200"
          }`}
        >
          <CubeIcon className="h-4 w-4 inline mr-2" />
          Desde Bodega
        </button>
        <button
          type="button"
          onClick={() => setSearchMode("manual")}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            searchMode === "manual"
              ? "bg-[#0A3D91] text-white shadow-md"
              : "text-slate-600 hover:bg-slate-200"
          }`}
        >
          Manual
        </button>
      </div>

      {/* Modo: Buscar en Bodega */}
      {searchMode === "bodega" && (
        <div className="space-y-3">
          {/* ✅ SELECTOR DE BODEGA - FIX CSS WARNING: removed 'block' */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <BuildingStorefrontIcon className="h-4 w-4" />
              Selecciona la bodega
            </label>
            <select
              value={selectedWarehouse || ""}
              onChange={(e) => setSelectedWarehouse(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full px-4 py-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm"
            >
              <option value="">Selecciona una bodega</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} {w.code && `(${w.code})`}
                </option>
              ))}
            </select>
          </div>

          {/* Búsqueda de productos */}
          {selectedWarehouse && (
            <div className="relative">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar repuestos por marca, modelo, código..."
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm"
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0A3D91] border-t-transparent" />
                  </div>
                )}
              </div>

              {/* Dropdown de resultados */}
              {showResults && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowResults(false)}
                  />

                  <div className="absolute z-20 w-full mt-2 bg-white border-2 border-slate-300 rounded-xl shadow-xl max-h-80 overflow-y-auto">
                    {searchResults.length > 0 ? (
                      searchResults.map((item) => {
                        const stockTotal = typeof item.quantity === "number" 
                          ? item.quantity 
                          : parseInt(String(item.quantity || 0), 10);
                        const hasStock = stockTotal > 0;

                        const productName = getProductName(item.product_info);
                        const productCode = getProductCode(item.product_info);

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => hasStock && addFromBodega(item)}
                            disabled={!hasStock}
                            className={`w-full text-left p-3 border-b border-slate-200 last:border-b-0 transition-colors ${
                              hasStock
                                ? "hover:bg-blue-50 cursor-pointer"
                                : "bg-slate-50 cursor-not-allowed opacity-60"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              {item.product_info?.photo ? (
                                <img
                                  src={item.product_info.photo}
                                  alt={productName}
                                  className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-12 h-12 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0">
                                  <CubeIcon className="h-6 w-6 text-slate-400" />
                                </div>
                              )}

                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                  {productName}
                                </p>
                                {productCode && (
                                  <p className="text-xs text-slate-600">
                                    Código: {productCode}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  <span
                                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                      hasStock
                                        ? "bg-green-100 text-green-700"
                                        : "bg-red-100 text-red-700"
                                    }`}
                                  >
                                    Stock: {stockTotal}
                                  </span>
                                  {!hasStock && (
                                    <span className="text-xs text-red-600 flex items-center gap-1">
                                      <ExclamationTriangleIcon className="h-3 w-3" />
                                      Sin stock
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-slate-500 text-sm">
                        No se encontraron repuestos en esta bodega
                      </div>
                    )}
                  </div>
                </>
              )}

              <p className="text-xs text-slate-500 mt-2">
                Buscando solo <strong>REPUESTOS</strong> en la bodega seleccionada
              </p>
            </div>
          )}
        </div>
      )}

      {/* Modo: Agregar Manual */}
      {searchMode === "manual" && (
        <div className="rounded-xl border-2 border-dashed border-slate-300 p-4 space-y-3 bg-slate-50">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="font-medium">Agregar repuesto manualmente</span>
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              value={manualQuantity}
              onChange={(e) => setManualQuantity(parseInt(e.target.value) || 1)}
              className="w-16 px-2 py-2 rounded-lg border-2 border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm text-center"
              placeholder="Cant."
            />

            <input
              type="text"
              value={manualDescription}
              onChange={(e) => setManualDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
              placeholder="Descripción del repuesto..."
              className="flex-1 px-3 py-2 rounded-lg border-2 border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm"
            />

            <button
              type="button"
              onClick={addManual}
              className="px-4 py-2 rounded-lg bg-[#0A3D91] text-white hover:bg-[#083777] inline-flex items-center gap-2 transition-colors"
            >
              <PlusIcon className="h-5 w-5" />
              Agregar
            </button>
          </div>

          <p className="text-xs text-amber-600 flex items-center gap-1">
            <ExclamationTriangleIcon className="h-3 w-3" />
            Los repuestos manuales no afectan el stock de bodega
          </p>
        </div>
      )}
    </div>
  );
}