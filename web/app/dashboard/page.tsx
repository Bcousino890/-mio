import PageShell from '@/components/PageShell'
import { Building2, TrendingDown, Users, AlertCircle } from 'lucide-react'

const stats = [
  { label: 'Anuncios activos', value: '—', icon: Building2, color: 'text-blue-400' },
  { label: 'Bajadas de precio hoy', value: '—', icon: TrendingDown, color: 'text-green-400' },
  { label: 'Leads particulares', value: '—', icon: Users, color: 'text-purple-400' },
  { label: 'Oportunidades inversión', value: '—', icon: AlertCircle, color: 'text-amber-400' },
]

export default function DashboardPage() {
  return (
    <PageShell
      title="Dashboard"
      subtitle="Visión general del mercado · Madrid"
    >
      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-xl border border-[#1e2130] bg-[#0f1117] p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500">{label}</p>
              <Icon size={16} className={color} />
            </div>
            <p className="text-2xl font-bold text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      {/* Empty state — DB sin datos aún */}
      <div className="rounded-xl border border-dashed border-[#2d3447] bg-[#0f1117] p-12 text-center">
        <Building2 size={32} className="mx-auto text-slate-700 mb-3" />
        <p className="text-slate-500 text-sm font-medium">Base de datos vacía</p>
        <p className="text-slate-700 text-xs mt-1">
          Importa los 2.500 particulares del VPS antiguo o ejecuta el primer scrape para ver datos aquí.
        </p>
      </div>
    </PageShell>
  )
}
