import PageShell from '@/components/PageShell'
import { TrendingUp, TrendingDown, ExternalLink, User } from 'lucide-react'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface OppRow {
  listing_id: string
  portal: string
  source_url: string
  operation: string
  price: number
  square_meters: number
  price_sqm: number
  zone_median_sqm: number
  discount_ratio: number
  advertiser_type: string
  zone_name: string | null
  bedrooms: number | null
  bathrooms: number | null
  days_on_market: number
  price_drops: number
}

async function getOpportunities(): Promise<OppRow[]> {
  if (!process.env.DATABASE_URL) return []
  try {
    const { rows } = await pool.query(`
      SELECT listing_id, portal, source_url, operation, price, square_meters,
             price_sqm, zone_median_sqm, discount_ratio, advertiser_type,
             zone_name, bedrooms, bathrooms, days_on_market, price_drops
      FROM mv_opportunities
      ORDER BY discount_ratio DESC
      LIMIT 100
    `)
    return rows as OppRow[]
  } catch {
    return []
  }
}

function fmtEur(n: number): string {
  return `${Math.round(Number(n)).toLocaleString('es-ES')} €`
}

export default async function OportunidadesPage() {
  const opportunities = await getOpportunities()

  return (
    <PageShell
      title="Oportunidades de inversión"
      subtitle="Anuncios con precio/m² ≥15% por debajo de la mediana de su zona"
      badge="RADAR"
    >
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Descuento mínimo', value: '≥15%', sub: 'vs mediana zona (mv_market_area)' },
          { label: 'Oportunidades activas', value: String(opportunities.length), sub: 'orden: mayor descuento primero' },
          { label: 'Señales de motivación', value: '3', sub: 'bajadas · TOM alto · particular' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className="text-xl font-bold text-blue-400">{value}</p>
            <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {opportunities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--c-border-strong)] bg-[var(--c-card)] p-12 text-center">
          <TrendingUp size={32} className="mx-auto text-slate-700 mb-3" />
          <p className="text-slate-500 text-sm font-medium">mv_opportunities sin datos</p>
          <p className="text-slate-700 text-xs mt-1">
            Se llena cuando hay anuncios + mediana en mv_market_area + refresh de vistas (Configuración).
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border-card)]">
                {['Zona', 'Precio', '€/m²', 'Mediana zona', 'Descuento', 'Señales', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr key={o.listing_id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)]">
                  <td className="px-4 py-3">
                    <p className="text-slate-200 text-xs font-medium">{o.zone_name ?? '—'}</p>
                    <p className="text-slate-600 text-[11px]">
                      {o.square_meters} m²
                      {o.bedrooms != null && ` · ${o.bedrooms}D`}
                      {o.bathrooms != null && ` · ${o.bathrooms}B`}
                      {' · '}
                      <span className={o.operation === 'rent' ? 'text-violet-400' : 'text-blue-400'}>
                        {o.operation === 'rent' ? 'alquiler' : 'venta'}
                      </span>
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-200">{fmtEur(o.price)}</td>
                  <td className="px-4 py-3 text-xs text-slate-300">{fmtEur(o.price_sqm)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtEur(o.zone_median_sqm)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300">
                      <TrendingDown size={10} />
                      {Math.round(Number(o.discount_ratio) * 100)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {Number(o.price_drops) > 0 && (
                        <span className="text-[10px] bg-red-950/40 text-red-300 px-1.5 py-0.5 rounded">
                          {o.price_drops} bajada{Number(o.price_drops) !== 1 ? 's' : ''}
                        </span>
                      )}
                      {Number(o.days_on_market) > 90 && (
                        <span className="text-[10px] bg-amber-950/40 text-amber-300 px-1.5 py-0.5 rounded">
                          {Math.round(Number(o.days_on_market))}d en mercado
                        </span>
                      )}
                      {o.advertiser_type === 'particular' && (
                        <span className="text-[10px] bg-purple-950/40 text-purple-300 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <User size={8} /> particular
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a href={o.source_url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-300 inline-block">
                      <ExternalLink size={12} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
