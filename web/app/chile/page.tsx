import { Fragment } from 'react'
import Link from 'next/link'
import PageShell from '@/components/PageShell'
import { Globe, Star, MapPinned, Upload, CheckCircle2, Circle, Database } from 'lucide-react'
import { CHILE_COMUNAS, CHILE_PRIORITY_COMUNAS, CHILE_REGIONS, groupByRegion } from '@/lib/chile-zones'
import { pool } from '@/lib/db'

interface CoverageRow {
  sii_comuna_code: string
  roles: number
  name: string | null
}

async function getSiiCoverage(): Promise<CoverageRow[]> {
  if (!process.env.DATABASE_URL) return []
  try {
    const res = await pool.query(
      `SELECT r.sii_comuna_code, count(*) AS roles, c.name
       FROM sii_roles_cl r
       LEFT JOIN chile_comunas c ON c.sii_comuna_code = r.sii_comuna_code
       GROUP BY r.sii_comuna_code, c.name
       ORDER BY roles DESC`
    )
    return res.rows.map((r) => ({ sii_comuna_code: r.sii_comuna_code, roles: Number(r.roles), name: r.name }))
  } catch (e) {
    // Fallback sin JOIN si chile_comunas no tiene sii_code
    try {
      const res2 = await pool.query(
        `SELECT sii_comuna_code, count(*) AS roles
         FROM sii_roles_cl
         GROUP BY sii_comuna_code
         ORDER BY roles DESC`
      )
      return res2.rows.map((r) => ({ sii_comuna_code: r.sii_comuna_code, roles: Number(r.roles), name: null }))
    } catch { return [] }
  }
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export default async function ChilePage() {
  const grouped = groupByRegion()
  const coverage = await getSiiCoverage()

  const totalRoles = coverage.reduce((s, r) => s + r.roles, 0)
  const comunasConSii = new Set(coverage.map((r) => r.sii_comuna_code))
  const rolesByComunaCode = Object.fromEntries(coverage.map((r) => [r.sii_comuna_code, r.roles]))
  // Nombres de comunas que tienen SII (desde el JOIN con chile_comunas)
  const nombreConSii = new Set(coverage.map((r) => r.name).filter(Boolean) as string[])

  return (
    <PageShell
      title="Chile"
      subtitle={`${CHILE_COMUNAS.length} comunas · ${CHILE_PRIORITY_COMUNAS.length} prioritarias · ${comunasConSii.size} con datos SII`}
      action={
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="flex items-center gap-1.5 text-xs font-medium bg-[var(--c-card)] border border-[var(--c-border-card)] hover:border-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Upload size={12} />
            Subir SII
          </Link>
          <Link
            href="/chile/street"
            className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <MapPinned size={12} />
            Visor catastral
          </Link>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-[11px] text-slate-500 mb-1">Comunas cubiertas</p>
          <p className="text-lg font-bold text-slate-200">{CHILE_COMUNAS.length}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">RM completa + vacaciones</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-[11px] text-slate-500 mb-1">Prioritarias scraping</p>
          <p className="text-lg font-bold text-slate-200">{CHILE_PRIORITY_COMUNAS.length}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">Barrio alto RM + veraneo</p>
        </div>
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <p className="text-[11px] text-slate-500 mb-1">Roles SII en BD</p>
          <p className="text-lg font-bold text-emerald-400">{formatNum(totalRoles)}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">{comunasConSii.size} comunas · catastral.cl S2-2025</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-[11px] text-slate-500 mb-1">Regiones</p>
          <p className="text-lg font-bold text-slate-200">{CHILE_REGIONS.length}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">RM · Valparaíso · Araucanía</p>
        </div>
      </div>

      {/* Top comunas por roles */}
      {coverage.length > 0 && (
        <div className="mb-5 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database size={12} className="text-emerald-400" />
            <p className="text-xs font-semibold text-slate-400">Comunas con más roles en BD</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {coverage.slice(0, 15).map((r) => (
              <Link
                key={r.sii_comuna_code}
                href={`/chile/catastro`}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-900/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50 transition-colors"
              >
                <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                {r.sii_comuna_code}
                <span className="text-[10px] text-emerald-600">{formatNum(r.roles)}</span>
              </Link>
            ))}
            {coverage.length > 15 && (
              <span className="text-xs text-slate-600 px-2.5 py-1.5">+{coverage.length - 15} más</span>
            )}
          </div>
        </div>
      )}

      {/* Priority comunas quick access */}
      <div className="mb-5 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
        <p className="text-xs font-semibold text-slate-400 mb-3">Comunas prioritarias — acceso rápido</p>
        <div className="flex flex-wrap gap-2">
          {CHILE_PRIORITY_COMUNAS.map((c) => {
            const hasSii = nombreConSii.has(c.name)
            const roles = coverage.find(r => r.name === c.name)?.roles
            return (
              <Link
                key={c.name}
                href={`/chile/catastro`}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  hasSii
                    ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50'
                    : 'border-[var(--c-border-card)] bg-[var(--c-surface)] text-slate-400 hover:text-slate-200'
                }`}
              >
                {hasSii
                  ? <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                  : <Circle size={11} className="text-slate-600 flex-shrink-0" />
                }
                {c.name}
                {roles && <span className="text-[10px] opacity-60">{formatNum(roles)}</span>}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Full comunas table */}
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border-card)] bg-[var(--c-surface)]">
              <th className="text-left px-5 py-3 text-[11px] text-slate-500 font-medium">Comuna</th>
              <th className="text-left px-5 py-3 text-[11px] text-slate-500 font-medium">Provincia</th>
              <th className="text-left px-5 py-3 text-[11px] text-slate-500 font-medium">Localidades</th>
              <th className="text-left px-5 py-3 text-[11px] text-slate-500 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {CHILE_REGIONS.map((region) => (
              <Fragment key={region}>
                <tr className="bg-[var(--c-hover)]">
                  <td colSpan={4} className="px-5 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    {region} · {grouped[region].length} comunas
                  </td>
                </tr>
                {grouped[region].map((c, i) => {
                  const hasSii = nombreConSii.has(c.name)
                  const roles = coverage.find(r => r.name === c.name)?.roles
                  return (
                    <tr
                      key={c.name}
                      className={`border-b border-[var(--c-border)] ${i % 2 === 0 ? '' : 'bg-[var(--c-card)]/50'}`}
                    >
                      <td className="px-5 py-2.5 text-slate-200 font-medium">{c.name}</td>
                      <td className="px-5 py-2.5 text-slate-500 text-xs">{c.provincia}</td>
                      <td className="px-5 py-2.5 text-slate-600 text-xs">
                        {c.localidades?.join(', ') ?? '—'}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {hasSii && (
                            <span className="flex items-center gap-1 text-[10px] bg-emerald-950/40 border border-emerald-900/50 text-emerald-400 px-1.5 py-0.5 rounded">
                              <CheckCircle2 size={9} />
                              SII {roles ? formatNum(roles) : ''}
                            </span>
                          )}
                          {c.priority && (
                            <span className="flex items-center gap-1 text-[10px] bg-[var(--c-active)] text-amber-300 px-1.5 py-0.5 rounded">
                              <Star size={9} />
                              Prioritaria
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <Globe size={12} className="text-slate-700" />
        <span>
          Taxonomía en <code className="font-mono">web/lib/chile-zones.ts</code> · Datos SII: catastral.cl S2-2025 · {formatNum(totalRoles)} roles totales
        </span>
      </div>
    </PageShell>
  )
}
