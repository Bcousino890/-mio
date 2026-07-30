import { Fragment } from 'react'
import Link from 'next/link'
import PageShell from '@/components/PageShell'
import { Globe, Star, MapPinned, Upload, CheckCircle2, Database, Activity, Loader2 } from 'lucide-react'
import {
  readComunasResumen,
  refreshComunasResumenEnSegundoPlano,
  resumenObsoleto,
  type ComunaResumen,
} from '@/lib/sii-comuna-resumen'

// Render dinámico: el build de Docker no tiene DATABASE_URL, así que un
// prerender ISR dejaría la página vacía tras cada deploy.
//
// El desglose por comuna NO se calcula aquí. Recorrerlo son ~9,6M de roles de
// sii_roles_cl con varios regex POSIX por fila y un COUNT(DISTINCT) sobre
// direcciones normalizadas: minutos, no milisegundos. Hacerlo dentro del
// request era exactamente la causa del timeout de 30 s de esta página (y de
// que se comiera el pool de 10 conexiones que usa el resto del CRM). Ahora se
// lee ya calculado de sii_resumen_comuna_cl y, si está obsoleto, se dispara el
// recálculo por detrás sin esperarlo (web/lib/sii-comuna-resumen.ts).
export const dynamic = 'force-dynamic'

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}K`
  return String(n)
}

function fmt(n: number): string {
  return n > 0 ? n.toLocaleString('es-CL') : '—'
}

export default async function ChilePage() {
  const { rows: comunas, computedAt, calculando } = await readComunasResumen()

  // Si el resumen está obsoleto (o no existe todavía) se lanza el recálculo y
  // NO se espera: la página se sirve al instante con lo que haya en la tabla.
  if (resumenObsoleto(computedAt)) refreshComunasResumenEnSegundoPlano()

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
      {/* Primer cálculo tras el deploy: la tabla precalculada aún está vacía.
          Se avisa en vez de mostrar ceros silenciosos, que parecerían un fallo. */}
      {calculando && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-xs text-amber-300">
          <Loader2 size={13} className="animate-spin flex-shrink-0" />
          <span>
            Calculando el desglose del catastro por comuna (primer cálculo tras el deploy, unos minutos sobre 9,6M de
            roles). Recarga en un rato: los conteos aparecerán solos.
          </span>
        </div>
      )}

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
          por dirección · Sitios = eriazos (W) · Agrícolas = serie agrícola · Datos: catastral.cl S2-2025
          {computedAt
            ? ` · desglose calculado el ${computedAt.toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`
            : ''}
        </span>
      </div>
    </PageShell>
  )
}
