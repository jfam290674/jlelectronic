//cotizacion-equipos-pdf-viewer.tsx
import CotizacionViewerShell from "./pdf/CotizacionViewerShell";
import CotizacionEquiposTemplate from "./pdf/templates/CotizacionEquiposTemplate";

export default function CotizacionEquiposPDFViewer() {
  return (
    <CotizacionViewerShell
      backTo="/cotizaciones"
      titlePrefix="Cotización (Equipos)"
      renderWeb={(ctx) => <CotizacionEquiposTemplate {...ctx} />}
    />
  );
}
