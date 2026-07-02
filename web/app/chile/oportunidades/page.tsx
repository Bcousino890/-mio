import PageShell from '@/components/PageShell'
import { TrendingUp, ExternalLink, TrendingDown } from 'lucide-react'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface OpportunityRow {
  id: string
  source_url: string
  title: string | null
  operation: string
  price: number
  square_meters: number
  price_sqm: number
  median_sqm: number
  discount_ratio: number
  comuna_name: string | null
  address: string | null
  bedrooms: number | null
  bathrooms: number | null
  days_on_market: number
}

async function getOpportunities(): Promise<OpportunityRow[]> {
  if (!process.env.DATABASE_URL) return []
  try {
    // Mediana $/m² por (comuna, operación) sobre anuncios activos, y anuncios
    // con precio/m² ≥15% bajo esa mediana — el mismo criterio que
    // mv_opportunities usa para Madrid (0010), aplicado a listings_cl.
    const { rows } = await pool.query(`
      WITH medians AS (
        SELECT comuna_id, operation,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY price::numeric / square_meters) AS median_sqm,
               count(*) AS n
        FROM listings_cl
        WHERE is_active AND price > 0 AND square_meters > 0 AND comuna_id IS NOT NULL
        GROUP BY comuna_id, operation
        HAVING count(*) >= 5
      )
      SELECT l.id, l.source_url, l.title, l.operation, l.price, l.square_meters,
             round(l.price::numeric / l.square_meters) AS price_sqm,
             round(m.median_sqm) AS median_sqm,
             round((1 - (l.price::numeric / l.square_meters) / m.median_sqm)::numeric, 3) AS discount_ratio,
             c.name AS comuna_name,
             l.address, l.bedrooms, l.bathrooms,
             round(EXTRACT(EPOCH FROM (now() - l.first_seen_at)) / 86400.0) AS days_on_market
      FROM listings_cl l
      JOIN medians m ON m.comuna_id = l.comuna_id AND m.operation = l.operation
      LEFT JOIN chile_comunas c ON c.id = l.comuna_id
      WHERE l.is_active AND l.price > 0 AND l.square_meters > 0
        AND (l.price::numeric / l.square_meters) < m.median_sqm * 0.85
      ORDER BY discount_ratio DESC
      LIMIT 100
    `)
    return rows as OpportunityRow[]
  } catch {
    return []
  }
}

function fmtCLP(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`
  return `$${Number(n).toLocaleString('es-CL')}`
}

export default async function OportunidadesChilePage() {
  const opportunities = await getOpportunities()

  return (
    <PageShell
      title="Oportunidades Chile"
      subtitle="Anuncios con precio/m² ≥15% bajo la mediana de su comuna"
      badge="RADAR"
    >
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Descuento mínimo', value: '≥15%', sub: 'vs mediana comuna' },
          { label: 'Oportunidades activas', value: String(opportunities.length), sub: 'con mediana confiable (≥5 anuncios)' },
          { label: 'Mayor descuento', value: opportunities[0] ? `${Math.round(Number(opportunities[0].discount_ratio) * 100)}%` : '—', sub: opportunities[0]?.comuna_name ?? '' },
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
          <p className="text-slate-500 text-sm font-medium">Sin oportunidades detectadas</p>
          <p className="text-slate-700 text-xs mt-1">
            Se necesitan ≥5 anuncios activos por comuna y operación en listings_cl para calcular la mediana $/m².
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border-card)]">
                {['Propiedad', 'Comuna', 'Precio', '$/m²', 'Mediana comuna', 'Descuento', 'TOM', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr key={o.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)]">
                  <td className="px-4 py-3 max-w-[240px]">
                    <p className="text-slate-200 text-xs font-medium truncate">{o.title ?? o.address ?? '—'}</p>
                    <p className="text-slate-600 text-[11px]">
                      {o.square_meters} m²
                      {o.bedrooms != null && ` · ${o.bedrooms}D`}
                      {o.bathrooms != null && ` · ${o.bathrooms}B`}
                      {' · '}
                      <span className={o.operation === 'rent' ? 'text-violet-400' : 'text-blue-400'}>
                        {o.operation === 'rent' ? 'arriendo' : 'venta'}
                      </span>
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{o.comuna_name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-200">{fmtCLP(Number(o.price))}</td>
                  <td className="px-4 py-3 text-xs text-slate-300">{fmtCLP(Number(o.price_sqm))}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtCLP(Number(o.median_sqm))}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300">
                      <TrendingDown size={10} />
                      {Math.round(Number(o.discount_ratio) * 100)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{Number(o.days_on_market)}d</td>
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
