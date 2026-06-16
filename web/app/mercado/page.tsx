import PageShell from '@/components/PageShell'
import { BarChart3 } from 'lucide-react'

export default function MercadoPage() {
  return (
    <PageShell
      title="Análisis de mercado"
      subtitle="€/m² mediano · stock · time-on-market · absorción por zona"
    >
      <div className="grid grid-cols-3 gap-4 mb-6">
        {['Barrio Salamanca', 'Almagro', 'Ibiza', 'Pozuelo', 'La Moraleja'].map((zona) => (
          <div key={zona} className="rounded-xl border border-[#1e2130] bg-[#0f1117] p-4">
            <p className="text-xs text-slate-500 mb-1">{zona}</p>
            <p className="text-lg font-bold text-slate-500">— €/m²</p>
            <p className="text-[11px] text-slate-700 mt-0.5">0 anuncios activos</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-[#2d3447] bg-[#0f1117] p-12 text-center">
        <BarChart3 size={32} className="mx-auto text-slate-700 mb-3" />
        <p className="text-slate-500 text-sm font-medium">mv_market_area vacía</p>
        <p className="text-slate-700 text-xs mt-1">
          Heatmap y gráficas de €/m² disponibles cuando haya anuncios scraped.
        </p>
      </div>
    </PageShell>
  )
}
