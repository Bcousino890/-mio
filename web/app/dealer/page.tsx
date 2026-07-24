import PageShell from '@/components/PageShell'
import DealerNetPanel from '@/components/admin/DealerNetPanel'
import DuenoLookup from '@/components/chile/DuenoLookup'
import DealerQueryHistory from '@/components/chile/DealerQueryHistory'

export default function DealerPage() {
  return (
    <PageShell
      title="Dealer"
      subtitle="DealerNet · credenciales, búsqueda por RUT y Buscador Múltiple (dirección/rol)"
    >
      <div className="space-y-4">
        <DealerNetPanel />
        <DuenoLookup />
        <DealerQueryHistory />
      </div>
    </PageShell>
  )
}
