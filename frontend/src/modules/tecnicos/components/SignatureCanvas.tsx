// src/modules/tecnicos/components/SignatureCanvas.tsx
/**
 * Canvas de firma digital con soporte touch y mouse.
 * - Captura firma como base64
 * - Botón de limpiar
 * - Responsive: 300px en móvil, 200px en desktop
 * - Touch-friendly con grosor de trazo aumentado
 */

import * as React from "react";
import { TrashIcon } from "@heroicons/react/24/outline";

interface SignatureCanvasProps {
  /** Callback cuando la firma cambia (base64 string o null) */
  onChange: (signature: string | null) => void;
  /** Firma inicial (base64) para modo edición */
  initialSignature?: string | null;
  /** Ancho del canvas (default: auto) */
  width?: number;
  /** Alto del canvas (default: responsive) */
  height?: number;
  /** Color del trazo (default: #000000) */
  strokeColor?: string;
  /** Grosor del trazo (default: 2.5) */
  lineWidth?: number;
  /** Etiqueta del campo */
  label?: string;
  /** Placeholder cuando está vacío */
  placeholder?: string;
}

export default function SignatureCanvas({
  onChange,
  initialSignature = null,
  width,
  height,
  strokeColor = "#000000",
  lineWidth = 2.5,
  label,
  placeholder = "Firmar aquí",
}: SignatureCanvasProps): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [hasSignature, setHasSignature] = React.useState(false);
  const [canvasSize, setCanvasSize] = React.useState({ width: 600, height: 200 });

  // Detectar tamaño responsive
  React.useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const isMobile = window.innerWidth < 768;
      
      setCanvasSize({
        width: width || Math.max(containerWidth, 300),
        height: height || (isMobile ? 300 : 200),
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [height, width]);

  // Cargar firma inicial
  React.useEffect(() => {
    if (!initialSignature || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setHasSignature(true);
    };
    img.src = initialSignature;
  }, [initialSignature, canvasSize]);

  // Obtener coordenadas normalizadas
  const getCoordinates = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // Inicio de dibujo
  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();
    const coords = getCoordinates(e);
    if (!coords || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
  };

  // Dibujar
  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();
    if (!isDrawing) return;

    const coords = getCoordinates(e);
    if (!coords || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  // Fin de dibujo
  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setHasSignature(true);

    if (canvasRef.current) {
      const base64 = canvasRef.current.toDataURL("image/png");
      onChange(base64);
    }
  };

  // Limpiar canvas
  const clear = () => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasSignature(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}

      <div 
        ref={containerRef}
        className="relative rounded-xl border-2 border-slate-300 bg-white overflow-hidden"
      >
        {/* Placeholder */}
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-slate-400 text-sm md:text-base font-medium">
              {placeholder}
            </span>
          </div>
        )}

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="w-full touch-none cursor-crosshair"
          style={{ 
            height: `${canvasSize.height}px`,
            maxHeight: '300px',
          }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          aria-label={label || "Canvas de firma"}
        />
      </div>

      {/* Botón limpiar */}
      {hasSignature && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-400 text-sm font-medium transition-all duration-200"
        >
          <TrashIcon className="h-5 w-5" />
          Limpiar firma
        </button>
      )}
    </div>
  );
}