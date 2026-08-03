import PageShell from '@/components/PageShell'
import IngestPanel from '@/components/admin/IngestPanel'
import GeocodeRolesPanel from '@/components/admin/GeocodeRolesPanel'
import ProxyConfigPanel from '@/components/admin/ProxyConfigPanel'
import EvomiProxyConfigPanel from '@/components/admin/EvomiProxyConfigPanel'
import RefreshViewsPanel from '@/components/admin/RefreshViewsPanel'
import OpenRouterConfigPanel from '@/components/admin/OpenRouterConfigPanel'
import SmartbcConfigPanel from '@/components/admin/SmartbcConfigPanel'
import WhatsappVerificadorPanel from '@/components/admin/WhatsappVerificadorPanel'

export default function SettingsPage() {
  return (
    <PageShell title="Configuración" subtitle="Integraciones · importar datos · proxies · IA · vistas de mercado">
      <div className="space-y-4">
        <SmartbcConfigPanel />
        <WhatsappVerificadorPanel />
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
