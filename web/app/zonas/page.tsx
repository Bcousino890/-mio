import PageShell from '@/components/PageShell'
import { MapPin, CheckCircle2, Clock, PlayCircle, XCircle } from 'lucide-react'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Zonas de arranque definidas en el plan maestro — se muestran como referencia
// cuando la cola scrape_jobs todavía está vacía.
const ZONAS_PLAN = [
  { name: 'Barrio Salamanca', slug: 'madrid/barrio-de-salamanca' },
  { name: 'Almagro (Chamberí)', slug: 'madrid/chamberi/almagro' },
  { name: 'Ibiza (Retiro)', slug: 'madrid/retiro/ibiza' },
  { name: 'Pozuelo de Alarcón', slug: 'pozuelo-de-alarcon-madrid' },
  { name: 'La Moraleja (Alcobendas)', slug: 'alcobendas/la-moraleja' },
]

interface JobRow {
  zone_name: string | null
  portal: string
  operation: string
  state: string
  attempts: number
  last_error: string | null
  updated_at: string
}

interface RunRow {
  zone_name: string | null
  portal: string | null
  operation: string | null
  started_at: string
  finished_at: string | null
  listings_seen: number
  inserted: number
  updated: number
  status: string
}

async function getScrapeState(): Promise<{ jobs: JobRow[]; runs: RunRow[] }> {
  if (!process.env.DATABASE_URL) return { jobs: [], runs: [] }
  try {
    const [jobsRes, runsRes] = await Promise.all([
      pool.query(`
        SELECT z.name AS zone_name, j.portal, j.operation, j.state, j.attempts, j.last_error, j.updated_at
        FROM scrape_jobs j LEFT JOIN zones z ON z.id = j.zone_id
        ORDER BY j.updated_at DESC LIMIT 50
      `),
      pool.query(`
        SELECT z.name AS zone_name, r.portal, r.operation, r.started_at, r.finished_at,
               r.listings_seen, r.inserted, r.updated, r.status
        FROM scrape_runs r LEFT JOIN zones z ON z.id = r.zone_id
        ORDER BY r.started_at DESC LIMIT 20
      `),
    ])
    return { jobs: jobsRes.rows, runs: runsRes.rows }
  } catch {
    return { jobs: [], runs: [] }
  }
}

const STATE_META: Record<string, { icon: typeof Clock; cls: string; label: string }> = {
  queued: { icon: Clock, cls: 'text-slate-500', label: 'En cola' },
  running: { icon: PlayCircle, cls: 'text-blue-400', label: 'Corriendo' },
  done: { icon: CheckCircle2, cls: 'text-emerald-400', label: 'Completado' },
  error: { icon: XCircle, cls: 'text-red-400', label: 'Error' },
}

export default async function ZonasPage() {
  const { jobs, runs } = await getScrapeState()

  return (
    <PageShell
      title="Zonas & Scraping"
      subtitle={jobs.length > 0 ? `${jobs.length} jobs en la cola scrape_jobs` : 'Cola scrape_jobs vacía · 5 zonas planificadas'}
    >
      {jobs.length === 0 ? (
        <>
          <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border-card)]">
                  {['Zona planificada', 'Slug Idealista', 'Estado'].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-xs text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ZONAS_PLAN.map((z) => (
                  <tr key={z.slug} className="border-b border-[var(--c-border)]">
                    <td className="px-5 py-3 text-slate-200 font-medium">{z.name}</td>
                    <td className="px-5 py-3 text-slate-500 font-mono text-xs">{z.slug}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Clock size={12} /> Sin jobs en cola
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <MapPin size={12} className="text-slate-700" />
            <span>
              Cuando el orquestador encole jobs en <code className="font-mono">scrape_jobs</code>, esta página mostrará su estado real.
            </span>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border-card)]">
                {['Zona', 'Portal', 'Operación', 'Estado', 'Intentos', 'Último error'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => {
                const meta = STATE_META[j.state] ?? STATE_META.queued
                const Icon = meta.icon
                return (
                  <tr key={i} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)]">
                    <td className="px-5 py-3 text-slate-200 text-xs font-medium">{j.zone_name ?? '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">{j.portal}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">{j.operation === 'rent' ? 'alquiler' : 'venta'}</td>
                    <td className="px-5 py-3">
                      <span className={`flex items-center gap-1.5 text-xs ${meta.cls}`}>
                        <Icon size={12} /> {meta.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{j.attempts}</td>
                    <td className="px-5 py-3 text-[11px] text-red-400/70 max-w-[200px] truncate">{j.last_error ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {runs.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Últimas ejecuciones</p>
          <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border-card)]">
                  {['Zona', 'Portal', 'Inicio', 'Vistos', 'Nuevos', 'Actualizados', 'Estado'].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-xs text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--c-border)]">
                    <td className="px-5 py-3 text-xs text-slate-300">{r.zone_name ?? '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{r.portal ?? '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{new Date(r.started_at).toLocaleString('es-ES')}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">{r.listings_seen}</td>
                    <td className="px-5 py-3 text-xs text-emerald-400">{r.inserted}</td>
                    <td className="px-5 py-3 text-xs text-blue-400">{r.updated}</td>
                    <td className="px-5 py-3 text-xs">
                      <span className={r.status === 'success' ? 'text-emerald-400' : r.status === 'error' ? 'text-red-400' : 'text-amber-400'}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageShell>
  )
}
