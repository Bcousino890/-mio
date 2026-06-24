import PageShell from '@/components/PageShell'
import DuenoLookup from '@/components/chile/DuenoLookup'

export default function DuenosPage() {
  return (
    <PageShell
      title="Dueños"
      subtitle="Buscar propietario por nombre · obtener RUT · teléfonos y contactos"
    >
      <DuenoLookup />
    </PageShell>
  )
}
