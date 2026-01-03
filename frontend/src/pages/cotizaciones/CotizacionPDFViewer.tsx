//cotizacion-pdf-viewer.tsx
import CotizacionViewerShell from "./pdf/CotizacionViewerShell";
import CotizacionStandardTemplate from "./pdf/templates/CotizacionStandardTemplate";

export default function CotizacionPDFViewer() {
  return (
    <CotizacionViewerShell
      backTo="/cotizaciones"
      titlePrefix="Cotización"
      renderWeb={(ctx) => <CotizacionStandardTemplate ctx={ctx} />}
    />
  );
}
