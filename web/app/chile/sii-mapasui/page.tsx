import PageShell from '@/components/PageShell'
import SiiMapasuiStats from '@/components/chile/SiiMapasuiStats'

export default function SiiMapasuiPage() {
  return (
    <PageShell
      title="SII mapasui — predios (scraping)"
      subtitle="Avance de la ingesta en sii_mapasui_predios_cl · procedencia no oficial · progreso en vivo"
    >
      <SiiMapasuiStats />
    </PageShell>
  )
}
