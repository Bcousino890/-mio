import PageShell from '@/components/PageShell'
import IngestPanel from '@/components/admin/IngestPanel'
import GeocodeRolesPanel from '@/components/admin/GeocodeRolesPanel'
import ProxyConfigPanel from '@/components/admin/ProxyConfigPanel'
import EvomiProxyConfigPanel from '@/components/admin/EvomiProxyConfigPanel'
import RefreshViewsPanel from '@/components/admin/RefreshViewsPanel'
import OpenRouterConfigPanel from '@/components/admin/OpenRouterConfigPanel'

export default function SettingsPage() {
  return (
    <PageShell title="Configuración" subtitle="Importar datos · proxies · IA · vistas de mercado">
      <div className="space-y-4">
        <OpenRouterConfigPanel />
        <IngestPanel />
        <EvomiProxyConfigPanel />
        <ProxyConfigPanel />
        <GeocodeRolesPanel />
        <RefreshViewsPanel />
      </div>
    </PageShell>
  )
}
