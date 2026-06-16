import PageShell from '@/components/PageShell'
import { Building2, SlidersHorizontal } from 'lucide-react'

export default function AnunciosPage() {
  return (
    <PageShell
      title="Anuncios"
      subtitle="Mercado completo deduplicado · portales + agencias + particulares"
      action={
        <button className="flex items-center gap-2 text-sm text-slate-400 border border-[#2d3447] px-3 py-1.5 rounded-lg hover:bg-[#1a1f2e] transition-all">
          <SlidersHorizontal size={14} />
          Filtros
        </button>
      }
    >
      {/* Filter bar placeholder */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {['Zona', 'Operación', 'Precio', '€/m²', 'Tipo', 'Particular/Agencia'].map((f) => (
          <button
            key={f}
            className="text-xs text-slate-500 border border-[#2d3447] px-3 py-1.5 rounded-full hover:bg-[#1a1f2e] hover:text-slate-300 transition-all"
          >
            {f}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-[#2d3447] bg-[#0f1117] p-12 text-center">
        <Building2 size={32} className="mx-auto text-slate-700 mb-3" />
        <p className="text-slate-500 text-sm font-medium">Sin anuncios aún</p>
        <p className="text-slate-700 text-xs mt-1">
          Pendiente: importar legacy + scraper Idealista zonas de prueba.
        </p>
      </div>
    </PageShell>
  )
}
