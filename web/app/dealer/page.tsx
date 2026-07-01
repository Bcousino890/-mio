import PageShell from '@/components/PageShell'
import DealerNetPanel from '@/components/admin/DealerNetPanel'
import DuenoLookup from '@/components/chile/DuenoLookup'

export default function DealerPage() {
  return (
    <PageShell
      title="Dealer"
      subtitle="DealerNet · credenciales, búsqueda por RUT y Buscador Múltiple (dirección/rol)"
    >
      <div className="space-y-4">
        <DealerNetPanel />
        <DuenoLookup />
      </div>
    </PageShell>
  )
}
