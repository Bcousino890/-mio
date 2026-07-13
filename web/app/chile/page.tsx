import { Fragment } from 'react'
import Link from 'next/link'
import PageShell from '@/components/PageShell'
import { Globe, Star, MapPinned, Upload, CheckCircle2, Database, Activity } from 'lucide-react'
import { pool } from '@/lib/db'
import { UNIT_ADDR_MATCH, unitBaseAddressExpr } from '@/lib/sii-edificio-sql'

// Render dinámico (el build de Docker no tiene DATABASE_URL: prerender ISR
// dejaría la página vacía tras cada deploy) + caché en memoria de 1 hora:
// el desglose por comuna recorre los ~9,6M de roles de sii_roles_cl con un
// regexp por fila habitacional, demasiado caro para cada request.
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 60 * 60 * 1000
let resumenCache: { at: number; rows: ComunaResumen[] } | null = null

// Departamento = rol habitacional cuya dirección lleva sufijo de depto tras
// la numeración ("PEUMO 1190 DP 502"). Solo tokens de depto: BD/EST/LC tienen
// su propio destino SII (bodega/estacionamiento/local).
const DEPTO_ADDR_MATCH = '^.*?[0-9]+[[:space:]]+(DP|DPTO|DEPTO|DEP)([[:space:]]|$)'

interface ComunaResumen {
  name: string
  region: string
  provincia: string
  priority: boolean
  sii_comuna_code: string | null
  roles: number
  casas: number
  departamentos: number
  edificios: number
  sitios: number
  bodegas: number
  estacionamientos: number
  oficinas: number
  comercio: number
  agricolas: number
  otros: number
}

async function getComunasResumen(): Promise<ComunaResumen[]> {
  if (!process.env.DATABASE_URL) return []
  if (resumenCache && Date.now() - resumenCache.at < CACHE_TTL_MS && resumenCache.rows.length > 0) {
    return resumenCache.rows
  }
  try {
    const res = await pool.query(
      `SELECT cc.name, cc.region, cc.provincia, cc.priority, cc.sii_comuna_code,
              COALESCE(s.total, 0)            AS roles,
              COALESCE(s.casas, 0)            AS casas,
              COALESCE(s.departamentos, 0)    AS departamentos,
              COALESCE(s.edificios, 0)        AS edificios,
              COALESCE(s.sitios, 0)           AS sitios,
              COALESCE(s.bodegas, 0)          AS bodegas,
              COALESCE(s.estacionamientos, 0) AS estacionamientos,
              COALESCE(s.oficinas, 0)         AS oficinas,
              COALESCE(s.comercio, 0)         AS comercio,
              COALESCE(s.agricolas, 0)        AS agricolas
       FROM chile_comunas cc
       LEFT JOIN (
         SELECT sii_comuna_code,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'H'
                                   AND direccion ~ '${DEPTO_ADDR_MATCH}')::int AS departamentos,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'H'
                                   AND (direccion IS NULL OR direccion !~ '${DEPTO_ADDR_MATCH}'))::int AS casas,
                COUNT(DISTINCT ${unitBaseAddressExpr('direccion')})
                  FILTER (WHERE direccion ~ '${UNIT_ADDR_MATCH}')::int AS edificios,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'W')::int AS sitios,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'L')::int AS bodegas,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'Z')::int AS estacionamientos,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'O')::int AS oficinas,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'C')::int AS comercio,
                COUNT(*) FILTER (WHERE serie = 'agricola')::int AS agricolas
         FROM sii_roles_cl
         GROUP BY sii_comuna_code
       ) s ON s.sii_comuna_code = cc.sii_comuna_code
       ORDER BY cc.region, roles DESC, cc.name`
    )
    const rows = res.rows.map((r) => {
      const roles = Number(r.roles)
      const buckets = ['casas', 'departamentos', 'sitios', 'bodegas', 'estacionamientos', 'oficinas', 'comercio'] as const
      const clasificados = buckets.reduce((s, k) => s + Number(r[k]), 0)
      return {
        name: r.name,
        region: r.region,
        provincia: r.provincia,
        priority: r.priority,
        sii_comuna_code: r.sii_comuna_code,
        roles,
        casas: Number(r.casas),
        departamentos: Number(r.departamentos),
        edificios: Number(r.edificios),
        sitios: Number(r.sitios),
        bodegas: Number(r.bodegas),
        estacionamientos: Number(r.estacionamientos),
        oficinas: Number(r.oficinas),
        comercio: Number(r.comercio),
        agricolas: Number(r.agricolas),
        otros: Math.max(0, roles - clasificados),
      }
    })
    resumenCache = { at: Date.now(), rows }
    return rows
  } catch {
    return []
  }
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}K`
  return String(n)
}

function fmt(n: number): string {
  return n > 0 ? n.toLocaleString('es-CL') : '—'
}

export default async function ChilePage() {
  const comunas = await getComunasResumen()

  const conDatos = comunas.filter((c) => c.roles > 0)
  const totalRoles = conDatos.reduce((s, c) => s + c.roles, 0)
  const totalEdificios = conDatos.reduce((s, c) => s + c.edificios, 0)
  const regiones = Array.from(new Set(comunas.map((c) => c.region)))
  // Regiones ordenadas por volumen de datos (las con más roles primero)
  const rolesPorRegion = Object.fromEntries(
    regiones.map((r) => [r, comunas.filter((c) => c.region === r).reduce((s, c) => s + c.roles, 0)])
  )
  regiones.sort((a, b) => rolesPorRegion[b] - rolesPorRegion[a])

  const topComunas = [...conDatos].sort((a, b) => b.roles - a.roles).slice(0, 15)
  const catastroHref = (c: ComunaResumen) =>
    c.roles > 0 && c.sii_comuna_code ? `/chile/catastro?zona=${c.sii_comuna_code}` : '/chile/catastro'

  return (
    <PageShell
      title="Chile"
      subtitle={`${comunas.length} comunas · ${conDatos.length} con datos SII · ${formatNum(totalRoles)} roles`}
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
            href="/chile/sii-mapasui"
            className="flex items-center gap-1.5 text-xs font-medium bg-[var(--c-card)] border border-[var(--c-border-card)] hover:border-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Activity size={12} />
            Scrape SII
          </Link>
          <Link
            href="/chile/catastro"
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
          <p className="text-[11px] text-slate-500 mb-1">Comunas de Chile</p>
          <p className="text-lg font-bold text-slate-200">{comunas.length}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">{regiones.length} regiones</p>
        </div>
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <p className="text-[11px] text-slate-500 mb-1">Con datos SII</p>
          <p className="text-lg font-bold text-emerald-400">{conDatos.length}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">catastral.cl S2-2025</p>
        </div>
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <p className="text-[11px] text-slate-500 mb-1">Roles SII en BD</p>
          <p className="text-lg font-bold text-emerald-400">{formatNum(totalRoles)}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">predios con avalúo fiscal</p>
        </div>
        <div className="rounded-xl border border-blue-900/50 bg-blue-950/20 p-4">
          <p className="text-[11px] text-slate-500 mb-1">Edificios / condominios</p>
          <p className="text-lg font-bold text-blue-400">{formatNum(totalEdificios)}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">conjuntos agrupados por dirección</p>
        </div>
      </div>

      {/* Top comunas por roles */}
      {topComunas.length > 0 && (
        <div className="mb-5 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database size={12} className="text-emerald-400" />
            <p className="text-xs font-semibold text-slate-400">Comunas con más roles en BD</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {topComunas.map((c) => (
              <Link
                key={c.name}
                href={catastroHref(c)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-900/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50 transition-colors"
              >
                <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                {c.name}
                <span className="text-[10px] text-emerald-600">{formatNum(c.roles)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Full comunas table with per-type breakdown */}
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <thead>
            <tr className="border-b border-[var(--c-border-card)] bg-[var(--c-surface)]">
              <th className="text-left px-4 py-3 text-[11px] text-slate-500 font-medium">Comuna</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Roles</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Casas</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Deptos</th>
              <th className="text-right px-3 py-3 text-[11px] text-blue-400 font-medium">Edif./Cond.</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Sitios</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Bodegas</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Estac.</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Oficinas</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Comercio</th>
              <th className="text-right px-3 py-3 text-[11px] text-slate-500 font-medium">Agrícolas</th>
              <th className="text-right px-4 py-3 text-[11px] text-slate-500 font-medium">Otros</th>
            </tr>
          </thead>
          <tbody>
            {regiones.map((region) => {
              const filas = comunas.filter((c) => c.region === region)
              const conDatosRegion = filas.filter((c) => c.roles > 0).length
              return (
                <Fragment key={region}>
                  <tr className="bg-[var(--c-hover)]">
                    <td colSpan={12} className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      {region} · {filas.length} comunas · {conDatosRegion} con datos · {formatNum(rolesPorRegion[region])} roles
                    </td>
                  </tr>
                  {filas.map((c, i) => (
                    <tr
                      key={c.name}
                      className={`border-b border-[var(--c-border)] ${i % 2 === 0 ? '' : 'bg-[var(--c-card)]/50'} ${c.roles === 0 ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-2">
                        <Link href={catastroHref(c)} className="flex items-center gap-1.5 text-slate-200 font-medium hover:text-blue-400 transition-colors">
                          {c.roles > 0
                            ? <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                            : <span className="w-[11px] flex-shrink-0" />}
                          {c.name}
                          {c.priority && <Star size={9} className="text-amber-300 flex-shrink-0" />}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-emerald-300 whitespace-nowrap">{fmt(c.roles)}</td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{fmt(c.casas)}</td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{fmt(c.departamentos)}</td>
                      <td className="px-3 py-2 text-right text-blue-400 whitespace-nowrap">{fmt(c.edificios)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{fmt(c.sitios)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{fmt(c.bodegas)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{fmt(c.estacionamientos)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{fmt(c.oficinas)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{fmt(c.comercio)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{fmt(c.agricolas)}</td>
                      <td className="px-4 py-2 text-right text-slate-600 whitespace-nowrap">{fmt(c.otros)}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <Globe size={12} className="text-slate-700" />
        <span>
          Casas/Deptos = destino SII habitacional (depto si la dirección lleva sufijo DP) · Edif./Cond. = conjuntos agrupados
          por dirección · Sitios = eriazos (W) · Agrícolas = serie agrícola · Datos: catastral.cl S2-2025 · se recalcula cada hora
        </span>
      </div>
    </PageShell>
  )
}
