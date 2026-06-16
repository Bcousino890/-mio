import PageShell from '@/components/PageShell'
import { TrendingUp } from 'lucide-react'

export default function OportunidadesPage() {
  return (
    <PageShell
      title="Oportunidades de inversión"
      subtitle="Anuncios con precio/m² ≥15% por debajo de la mediana de su zona"
      badge="RADAR"
    >
      {/* Legend */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Descuento mínimo', value: '≥15%', sub: 'vs mediana zona' },
          { label: 'Zonas activas', value: '5', sub: 'Salamanca · Almagro · Ibiza · Pozuelo · Moraleja' },
          { label: 'Señales de motivación', value: '3', sub: 'bajadas · TOM alto · particular' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-xl border border-[#1e2130] bg-[#0f1117] p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className="text-xl font-bold text-blue-400">{value}</p>
            <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-[#2d3447] bg-[#0f1117] p-12 text-center">
        <TrendingUp size={32} className="mx-auto text-slate-700 mb-3" />
        <p className="text-slate-500 text-sm font-medium">mv_opportunities vacía</p>
        <p className="text-slate-700 text-xs mt-1">
          Se llenará cuando haya anuncios + mediana calculada en mv_market_area.
        </p>
      </div>
    </PageShell>
  )
}
