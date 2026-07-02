import PageShell from '@/components/PageShell'
import IngestPanel from '@/components/admin/IngestPanel'
import GeocodeRolesPanel from '@/components/admin/GeocodeRolesPanel'
import ProxyConfigPanel from '@/components/admin/ProxyConfigPanel'
import RefreshViewsPanel from '@/components/admin/RefreshViewsPanel'

export default function SettingsPage() {
  return (
    <PageShell title="Configuración" subtitle="Importar datos · proxies · vistas de mercado">
      <div className="space-y-4">
        <IngestPanel />
        <ProxyConfigPanel />
        <GeocodeRolesPanel />
        <RefreshViewsPanel />
      </div>
    </PageShell>
  )
}
