import PageShell from '@/components/PageShell'
import TgrDuenoStats from '@/components/chile/TgrDuenoStats'

export default function TgrDuenoPage() {
  return (
    <PageShell
      title="TGR DUEÑO"
      subtitle="Certificado de deuda TGR · Región Metropolitana · progreso en vivo"
    >
      <TgrDuenoStats />
    </PageShell>
  )
}
