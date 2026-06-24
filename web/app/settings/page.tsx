import PageShell from '@/components/PageShell'
import { Settings } from 'lucide-react'
import IngestPanel from '@/components/admin/IngestPanel'
import GeocodeRolesPanel from '@/components/admin/GeocodeRolesPanel'

export default function SettingsPage() {
  return (
    <PageShell title="Configuración" subtitle="Importar datos · zonas · cron">
      <div className="space-y-4">
        <IngestPanel />
        <GeocodeRolesPanel />

        <div className="rounded-xl border border-dashed border-[var(--c-border-strong)] bg-[var(--c-card)] p-12 text-center">
          <Settings size={32} className="mx-auto text-slate-700 mb-3" />
          <p className="text-slate-500 text-sm font-medium">Pendiente</p>
          <p className="text-slate-700 text-xs mt-1">Configuración de proxies Geonode, cron jobs y zonas.</p>
        </div>
      </div>
    </PageShell>
  )
}
