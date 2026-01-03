// src/modules/tecnicos/components/PhotoCapture.tsx
/**
 * Componente para captura/gestión de fotos con metadata completa.
 * - Captura desde cámara o galería
 * - Notas por foto
 * - Tipo de foto (BEFORE/DURING/AFTER)
 * - Checkbox para incluir en PDF
 * - Campo de orden
 */

import * as React from "react";
import {
  CameraIcon,
  TrashIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";

export interface PhotoData {
  file?: File;
  preview: string;
  photo_type: "BEFORE" | "DURING" | "AFTER";
  notes: string;
  include_in_report: boolean;
  order: number;
}

interface PhotoCaptureProps {
  /** Callback cuando cambian los datos de la foto */
  onChange: (photo: PhotoData | null) => void;
  /** Datos iniciales de la foto */
  initialPhoto?: PhotoData | null;
  /** Etiqueta del campo */
  label?: string;
  /** Orden por defecto */
  defaultOrder?: number;
}

const PHOTO_TYPE_LABELS: Record<string, string> = {
  BEFORE: "Antes",
  DURING: "Durante",
  AFTER: "Después",
};

export default function PhotoCapture({
  onChange,
  initialPhoto = null,
  label = "Fotografía",
  defaultOrder = 0,
}: PhotoCaptureProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  
  const [photoData, setPhotoData] = React.useState<PhotoData | null>(
    initialPhoto || null
  );

  // Actualizar estado interno cuando cambia el inicial
  React.useEffect(() => {
    setPhotoData(initialPhoto);
  }, [initialPhoto]);

  // Notificar cambios al padre
  const updatePhotoData = (updates: Partial<PhotoData> | null) => {
    if (updates === null) {
      setPhotoData(null);
      onChange(null);
      return;
    }

    const updated = photoData
      ? { ...photoData, ...updates }
      : {
          preview: "",
          photo_type: "DURING" as const,
          notes: "",
          include_in_report: true,
          order: defaultOrder,
          ...updates,
        };

    setPhotoData(updated);
    onChange(updated);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validar que sea imagen
    if (!file.type.startsWith("image/")) {
      alert("Por favor selecciona un archivo de imagen válido.");
      return;
    }

    // Crear preview
    const reader = new FileReader();
    reader.onload = () => {
      updatePhotoData({
        file,
        preview: reader.result as string,
        photo_type: photoData?.photo_type || "DURING",
        notes: photoData?.notes || "",
        include_in_report: photoData?.include_in_report ?? true,
        order: photoData?.order ?? defaultOrder,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemove = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    updatePhotoData(null);
  };

  const triggerFileInput = () => {
    inputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      {label && (
        <label className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}

      {/* Preview + Controles */}
      {photoData?.preview ? (
        <div className="space-y-4">
          {/* Imagen preview */}
          <div className="relative rounded-xl border-2 border-slate-300 overflow-hidden bg-slate-50">
            <img
              src={photoData.preview}
              alt="Preview"
              className="w-full h-auto max-h-80 object-contain"
            />

            {/* Botón eliminar */}
            <button
              type="button"
              onClick={handleRemove}
              className="absolute top-2 right-2 p-2 rounded-lg bg-red-500 text-white hover:bg-red-600 shadow-lg"
              title="Eliminar foto"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Tipo de foto */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Tipo de fotografía
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["BEFORE", "DURING", "AFTER"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => updatePhotoData({ photo_type: type })}
                  className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition ${
                    photoData.photo_type === type
                      ? "border-[#0A3D91] bg-[#0A3D91] text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-[#0A3D91]"
                  }`}
                >
                  {PHOTO_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Notas/Observaciones
            </label>
            <textarea
              value={photoData.notes}
              onChange={(e) => updatePhotoData({ notes: e.target.value })}
              placeholder="Describe qué se observa en la foto..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm resize-none"
            />
          </div>

          {/* Incluir en reporte + Orden */}
          <div className="flex items-center gap-4">
            {/* Checkbox incluir en PDF */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={photoData.include_in_report}
                onChange={(e) =>
                  updatePhotoData({ include_in_report: e.target.checked })
                }
                className="w-4 h-4 rounded border-slate-300 text-[#0A3D91] focus:ring-[#0A3D91]"
              />
              <span className="text-sm text-slate-700">
                Incluir en el PDF
              </span>
            </label>

            {/* Campo orden */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-700">Orden:</label>
              <input
                type="number"
                min="0"
                value={photoData.order}
                onChange={(e) =>
                  updatePhotoData({ order: parseInt(e.target.value) || 0 })
                }
                className="w-20 px-2 py-1 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#0A3D91] focus:border-transparent text-sm text-center"
              />
            </div>
          </div>
        </div>
      ) : (
        /* Botón capturar/seleccionar */
        <button
          type="button"
          onClick={triggerFileInput}
          className="w-full py-12 rounded-xl border-2 border-dashed border-slate-300 hover:border-[#0A3D91] hover:bg-slate-50 transition flex flex-col items-center justify-center gap-3 text-slate-600 hover:text-[#0A3D91]"
        >
          <div className="flex items-center gap-2">
            <CameraIcon className="h-8 w-8" />
            <PhotoIcon className="h-8 w-8" />
          </div>
          <span className="text-sm font-medium">Tomar/Seleccionar foto</span>
          <span className="text-xs text-slate-500">
            Toca para usar la cámara o seleccionar de galería
          </span>
        </button>
      )}

      {/* Input file oculto */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-label={label}
      />
    </div>
  );
}