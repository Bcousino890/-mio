import PageShell from '@/components/PageShell'
import { BarChart3, RefreshCw } from 'lucide-react'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface MarketRow {
  zone_name: string | null
  zone_level: string | null
  operation: string
  active_count: number
  median_price: number | null
  median_price_sqm: number | null
  median_days_on_market: number | null
  particular_count: number
  computed_at: string | null
}

async function getMarket(): Promise<MarketRow[]> {
  if (!process.env.DATABASE_URL) return []
  try {
    const { rows } = await pool.query(`
      SELECT zone_name, zone_level, operation, active_count, median_price,
             median_price_sqm, median_days_on_market, particular_count, computed_at
      FROM mv_market_area
      WHERE active_count > 0
      ORDER BY operation, active_count DESC
      LIMIT 100
    `)
    return rows as MarketRow[]
  } catch {
    return []
  }
}

function fmtEur(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(Number(n)).toLocaleString('es-ES')} €`
}

export default async function MercadoPage() {
  const rows = await getMarket()
  const sale = rows.filter((r) => r.operation === 'sale')
  const rent = rows.filter((r) => r.operation === 'rent')
  const computedAt = rows[0]?.computed_at ? new Date(rows[0].computed_at) : null

  const renderTable = (data: MarketRow[], title: string, unit: string) => (
    <div className="mb-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">{title}</p>
      {data.length === 0 ? (
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-6 text-center text-xs text-slate-600">
          Sin datos de {title.toLowerCase()} en mv_market_area.
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border-card)]">
                {['Zona', 'Stock activo', `Mediana ${unit}`, 'Mediana €/m²', 'TOM mediano', 'Particulares'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={`${r.zone_name}-${i}`} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)]">
                  <td className="px-5 py-3">
                    <p className="text-slate-200 text-xs font-medium">{r.zone_name ?? 'Sin zona'}</p>
                    {r.zone_level && <p className="text-[10px] text-slate-600">{r.zone_level}</p>}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-300">{Number(r.active_count).toLocaleString('es-ES')}</td>
                  <td className="px-5 py-3 text-xs font-semibold text-slate-200">{fmtEur(r.median_price)}</td>
                  <td className="px-5 py-3 text-xs text-blue-300">{fmtEur(r.median_price_sqm)}</td>
                  <td className="px-5 py-3 text-xs text-slate-400">
                    {r.median_days_on_market != null ? `${Math.round(Number(r.median_days_on_market))} días` : '—'}
                  </td>
                  <td className="px-5 py-3 text-xs text-purple-300">{Number(r.particular_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <PageShell
      title="Análisis de mercado"
      subtitle="€/m² mediano · stock · time-on-market · por zona (mv_market_area)"
    >
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--c-border-strong)] bg-[var(--c-card)] p-12 text-center">
          <BarChart3 size={32} className="mx-auto text-slate-700 mb-3" />
          <p className="text-slate-500 text-sm font-medium">mv_market_area sin datos</p>
          <p className="text-slate-700 text-xs mt-1">
            Se llena con anuncios scrapeados + un refresh de vistas (Configuración → «Refrescar vistas de mercado»).
          </p>
        </div>
      ) : (
        <>
          {renderTable(sale, 'Venta', '€')}
          {renderTable(rent, 'Alquiler', '€/mes')}
          {computedAt && (
            <p className="text-[11px] text-slate-600 flex items-center gap-1.5">
              <RefreshCw size={11} />
              Calculado: {computedAt.toLocaleString('es-ES')} — refrescable desde Configuración.
            </p>
          )}
        </>
      )}
    </PageShell>
  )
}
