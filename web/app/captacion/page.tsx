import PageShell from '@/components/PageShell'
import { Users, AlertTriangle } from 'lucide-react'

export default function CaptacionPage() {
  return (
    <PageShell
      title="Captación"
      subtitle="Leads de particulares · exclusivas rotas · señales de motivación"
    >
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-[#1e2130] bg-[#0f1117] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-purple-400" />
            <p className="text-sm font-medium text-slate-300">Particulares activos</p>
          </div>
          <p className="text-2xl font-bold text-slate-100">—</p>
          <p className="text-xs text-slate-600 mt-1">Vista: v_leads_particulares</p>
        </div>
        <div className="rounded-xl border border-[#1e2130] bg-[#0f1117] p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-400" />
            <p className="text-sm font-medium text-slate-300">Exclusivas rotas</p>
          </div>
          <p className="text-2xl font-bold text-slate-100">—</p>
          <p className="text-xs text-slate-600 mt-1">Vista: mv_broken_exclusives</p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-[#2d3447] bg-[#0f1117] p-12 text-center">
        <Users size={32} className="mx-auto text-slate-700 mb-3" />
        <p className="text-slate-500 text-sm font-medium">Sin leads todavía</p>
        <p className="text-slate-700 text-xs mt-1">
          Aparecerán al importar particulares y scrapear agencias.
        </p>
      </div>
    </PageShell>
  )
}
