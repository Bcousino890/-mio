import PageShell from '@/components/PageShell'
import { Globe } from 'lucide-react'

export default function ChilePage() {
  return (
    <PageShell
      title="Chile"
      subtitle="Mercado inmobiliario · Chile"
    >
      <div className="rounded-xl border border-dashed border-[var(--c-border-strong)] bg-[var(--c-card)] p-12 text-center">
        <Globe size={32} className="mx-auto text-slate-700 mb-3" />
        <p className="text-slate-500 text-sm font-medium">Sección en construcción</p>
        <p className="text-slate-700 text-xs mt-1">
          Próximamente: datos de mercado y anuncios para Chile.
        </p>
      </div>
    </PageShell>
  )
}
