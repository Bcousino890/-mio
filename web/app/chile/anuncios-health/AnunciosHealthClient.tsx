'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Building2, Home, Store, Images, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock, Stethoscope,
} from 'lucide-react'

type Totals = {
  listings_total: number; listings_active: number; listings_with_code: number; listings_agency_web: number
  property_cl_total: number; property_cl_en_canje: number; corredoras_total: number
  corredora_webs_enabled: number; media_assets_total: number; last_seen_at: string | null
}
type Target = {
  comuna: string; operation: string; property_type: string; interval_hours: number
  force_refetch: boolean
  last_run_at: string | null; last_success_at: string | null
  last_listing_count: number | null; portal_reported_count: number | null
  notes: string | null
  last_failure_at: string | null; consecutive_failures: number
  live_portal_total: number | null; live_probed_at: string | null
  cadencia: string
}
type Via = {
  via: 'directo' | 'evomi'; ok: boolean; http_status?: number; elapsed_ms: number
  has_nordic_blob?: boolean; portal_total?: number | null; error?: string; veredicto: string
}
type Diagnostico = {
  success: boolean; proxy_configurado: boolean
  proxy_host: string | null; proxy_user: string | null
  vias: Via[]; veredicto: string
}
type Pulse = { change_type: string; count: number }
type Health = {
  success: boolean; generated_at: string; totals: Totals
  targets: Target[]; activity_24h: Pulse[]
  activity_1h?: Pulse[]
  activity_timeline?: { hora: string; change_type: string; count: number }[]
  live_probed?: boolean
}

function ago(iso: string | null): string {
  if (!iso) return 'nunca'
  // El reloj del servidor puede ir unos ms por delante del navegador: sin este
  // clamp, una lectura recién generada se mostraba como "hace -1s".
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `hace ${s}s`
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`
  return `hace ${Math.floor(s / 86400)}d`
}

// Cadencias del refresco en vivo. La lectura barata solo toca la BD; la sonda al
// portal es una petición real a Portal Inmobiliario por objetivo, así que va muy
// espaciada — a 30s serían ~240 peticiones/hora desde la IP de la VPS, que es lo
// que ya provocó un 403 en producción.
const POLL_MS = 10_000
const PROBE_MS = 5 * 60_000

const CHANGE_LABEL: Record<string, string> = {
  new: 'altas', delisted: 'bajas', reactivated: 'reactivados',
  price_change: 'cambios de precio', updated: 'actualizados', agency_change: 'cambio de corredora',
}
const CHANGE_CLS: Record<string, string> = {
  new: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  delisted: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
  reactivated: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
  price_change: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
}

const CAD: Record<string, { t: string; cls: string; icon: React.ReactNode }> = {
  'al-dia': { t: 'al día', cls: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30', icon: <CheckCircle2 size={12} /> },
  'atrasado': { t: 'atrasado', cls: 'text-amber-300 bg-amber-500/15 border-amber-500/30', icon: <AlertTriangle size={12} /> },
  // Un objetivo que no consigue ni leer una página. Antes este caso se pintaba
  // "al día" en verde (el intento fallido actualizaba last_run_at), que era el
  // peor de los mundos: el panel tranquilizaba justo cuando había que mirar.
  'fallando': { t: 'fallando', cls: 'text-rose-300 bg-rose-500/15 border-rose-500/30', icon: <XCircle size={12} /> },
  'nunca': { t: 'sin correr', cls: 'text-slate-400 bg-slate-600/30 border-slate-600/40', icon: <Clock size={12} /> },
}

function Tile({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/70 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={`p-1.5 rounded-md ${accent}`}>{icon}</span>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-100 leading-none">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  )
}

export default function AnunciosHealthClient() {
  const [data, setData] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [rerunMsg, setRerunMsg] = useState<string | null>(null)
  const [diag, setDiag] = useState<Diagnostico | null>(null)
  const [diagLoading, setDiagLoading] = useState(false)

  // `withProbe=false` = lectura barata (solo BD). Conserva el último total del
  // portal conocido por objetivo, para que la columna "Portal declara" no
  // parpadee a "—" entre sondas.
  const load = useCallback((withProbe = true) => {
    fetch(`/api/chile/anuncios-health${withProbe ? '' : '?live=0'}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) { setError(d.error || 'Error'); return }
        setError(null)
        setData(prev => {
          if (!prev || d.live_probed) return d
          const previo = new Map(prev.targets.map(t => [`${t.comuna}|${t.operation}|${t.property_type}`, t]))
          return {
            ...d,
            targets: d.targets.map((t: Target) => {
              const p = previo.get(`${t.comuna}|${t.operation}|${t.property_type}`)
              return t.live_portal_total == null && p
                ? { ...t, live_portal_total: p.live_portal_total, live_probed_at: p.live_probed_at }
                : t
            }),
          }
        })
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }, [])

  const rerun = useCallback((refetch = false) => {
    setRerunning(true); setRerunMsg(null)
    fetch(`/api/chile/anuncios-health${refetch ? '?refetch=1' : ''}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => setRerunMsg(d.success ? d.message : (d.error || 'Error')))
      .catch(e => setRerunMsg(e instanceof Error ? e.message : 'Error'))
      .finally(() => { setRerunning(false); load() })
  }, [load])

  // Sonda a Portal Inmobiliario por las dos vías (directa y Evomi). Es la que
  // responde "¿por qué no entra nada?" sin entrar por SSH al VPS.
  const diagnosticar = useCallback(() => {
    setDiagLoading(true); setDiag(null)
    fetch('/api/chile/anuncios-health/probe')
      .then(r => r.json())
      .then(setDiag)
      .catch(e => setDiag({
        success: false, proxy_configurado: false, proxy_host: null, proxy_user: null, vias: [],
        veredicto: e instanceof Error ? e.message : 'Error',
      }))
      .finally(() => setDiagLoading(false))
  }, [])

  useEffect(() => {
    load(true)
    const barato = setInterval(() => load(false), POLL_MS)   // BD: en vivo, cada 10s
    const sonda = setInterval(() => load(true), PROBE_MS)    // portal: cada 5 min
    return () => { clearInterval(barato); clearInterval(sonda) }
  }, [load])

  // Reloj propio: hace avanzar los "hace Ns" aunque no haya llegado dato nuevo,
  // que es lo que hace que el panel se vea vivo y no congelado.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const t = data?.totals
  const fresh = t?.last_seen_at ? ago(t.last_seen_at) : 'sin datos'
  const scraping = t ? t.listings_total > 0 : false

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 lg:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/15 text-cyan-400"><Activity size={20} /></div>
            <div>
              <h1 className="text-xl font-bold text-slate-100 leading-none flex items-center gap-2">
                Salud del scraping · Anuncios CL
                <span className="inline-flex items-center gap-1 text-[10px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  title={`Se actualiza solo cada ${POLL_MS / 1000}s. El total del portal se re-consulta cada ${PROBE_MS / 60000} min (es una petición real a Portal Inmobiliario).`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> en vivo
                </span>
              </h1>
              <p className="text-[11px] text-slate-500 mt-1">Se actualiza solo cada {POLL_MS / 1000}s · última lectura {data ? ago(data.generated_at) : '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => rerun(false)} disabled={rerunning}
              className="inline-flex items-center gap-1.5 text-xs text-white bg-cyan-600 border border-cyan-600 px-3 py-2 rounded-lg hover:bg-cyan-500 disabled:opacity-50">
              <RefreshCw size={13} className={rerunning ? 'animate-spin' : ''} /> {rerunning ? 'Encolando…' : 'Forzar re-barrido'}
            </button>
            <button onClick={() => { if (confirm('Re-scrapear TODA la ficha (fotos, características, permalink) de los avisos ya guardados. Corre en el próximo ciclo y toma un rato. ¿Continuar?')) rerun(true) }} disabled={rerunning}
              className="inline-flex items-center gap-1.5 text-xs text-white bg-amber-600 border border-amber-600 px-3 py-2 rounded-lg hover:bg-amber-500 disabled:opacity-50">
              <RefreshCw size={13} className={rerunning ? 'animate-spin' : ''} /> Re-scrapear todo
            </button>
            <button onClick={diagnosticar} disabled={diagLoading}
              title="Pide una página real a Portal Inmobiliario por las dos vías (directa y proxy Evomi) y dice cuál falla"
              className="inline-flex items-center gap-1.5 text-xs text-slate-200 bg-slate-800 border border-slate-600 px-3 py-2 rounded-lg hover:border-slate-500 disabled:opacity-50">
              <Stethoscope size={13} className={diagLoading ? 'animate-pulse' : ''} /> {diagLoading ? 'Probando…' : 'Diagnosticar red'}
            </button>
            <button onClick={() => load(true)} title="Vuelve a consultar el total real en Portal Inmobiliario ahora mismo"
              className="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg hover:border-slate-600">
              <RefreshCw size={13} /> Refrescar
            </button>
          </div>
        </div>
        {rerunMsg && <div className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 mb-3">{rerunMsg}</div>}

        {diag && (() => {
          const evomi = diag.vias.find(v => v.via === 'evomi')
          const cls = evomi?.ok
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          return (
            <div className={`rounded-xl border px-4 py-3 mb-3 text-sm ${cls}`}>
              <div className="flex items-start gap-2">
                <Stethoscope size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold mb-1">Diagnóstico de red</div>
                  <div className="text-[13px] mb-2">{diag.veredicto}</div>
                  <div className="space-y-1">
                    {diag.vias.map(v => (
                      <div key={v.via} className="text-[11px] font-mono text-slate-300 break-words">
                        <span className={v.ok ? 'text-emerald-400' : 'text-rose-400'}>{v.ok ? '✓' : '✗'}</span>{' '}
                        <span className="uppercase">{v.via === 'evomi' ? 'evomi (lo que usa el barrido)' : 'directo desde la VPS'}</span>{' '}
                        · {v.veredicto}
                        {v.http_status ? ` · HTTP ${v.http_status}` : ''}
                        {v.portal_total != null ? ` · total ${v.portal_total.toLocaleString('es-CL')}` : ''}
                        {` · ${v.elapsed_ms} ms`}
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-2">
                    Proxy: {diag.proxy_configurado ? `${diag.proxy_host} · usuario ${diag.proxy_user}` : 'sin credenciales en el VPS'}
                    {' — '}se configura en Configuración → Proxy (Evomi CL).
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {error && <div className="text-red-300 bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-sm mb-4">{error}</div>}
        {loading && !data && <div className="text-slate-400 p-8 text-center">Cargando…</div>}

        {t && (
          <>
            {/* Semáforo general. "Tiene datos" mira el histórico acumulado, así
                que se queda verde para siempre aunque el barrido lleve días
                parado — por eso manda lo que está BLOQUEADO ahora mismo. */}
            {(() => {
              const bloqueados = data.targets.filter(x => (x.consecutive_failures ?? 0) > 0)
              if (bloqueados.length > 0) {
                return (
                  <div className="rounded-xl border px-4 py-3 mb-4 flex items-start gap-3 text-sm bg-rose-500/10 border-rose-500/30 text-rose-200">
                    <XCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold">
                        El barrido está bloqueado en {bloqueados.length} de {data.targets.length} objetivos
                      </span>
                      <span className="text-slate-400"> · no consiguen leer ni una página · último anuncio visto {fresh}</span>
                      <div className="text-[12px] text-rose-200/80 mt-1">
                        No consumen cadencia: se reintentan solos cada 15 min hasta destrabarse.
                        Pulsa <span className="font-semibold">Diagnosticar red</span> para ver si el problema es el proxy o el portal.
                      </div>
                    </div>
                  </div>
                )
              }
              return (
                <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center gap-3 text-sm ${
                  scraping ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>
                  {scraping ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                  <div>
                    <span className="font-semibold">{scraping ? 'El pipeline tiene datos' : 'Aún sin anuncios ingresados'}</span>
                    <span className="text-slate-400"> · último anuncio visto {fresh} · {t.corredoras_total} corredoras · {t.property_cl_total} propiedades canónicas</span>
                  </div>
                </div>
              )
            })()}

            {/* Tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Tile icon={<Building2 size={16} />} label="Anuncios crudos" value={t.listings_total.toLocaleString('es-CL')}
                hint={`${t.listings_active.toLocaleString('es-CL')} activos · ${t.listings_with_code.toLocaleString('es-CL')} con property_code`} accent="bg-blue-500/15 text-blue-400" />
              <Tile icon={<Home size={16} />} label="Propiedades canónicas" value={t.property_cl_total.toLocaleString('es-CL')}
                hint={`${t.property_cl_en_canje} en canje (multi-corredora)`} accent="bg-amber-500/15 text-amber-400" />
              <Tile icon={<Store size={16} />} label="Corredoras" value={t.corredoras_total.toLocaleString('es-CL')}
                hint={`${t.listings_agency_web} anuncios de web propia · ${t.corredora_webs_enabled} webs activas`} accent="bg-purple-500/15 text-purple-400" />
              <Tile icon={<Images size={16} />} label="Fotos en bucket" value={t.media_assets_total.toLocaleString('es-CL')}
                hint="dedup por contenido" accent="bg-teal-500/15 text-teal-400" />
            </div>

            {/* Objetivos de barrido */}
            <h2 className="text-sm font-semibold text-slate-300 mb-2">Objetivos de barrido activos</h2>
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden mb-5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700 bg-slate-800/80">
                      <th className="px-4 py-2.5 font-semibold">Comuna</th>
                      <th className="px-3 py-2.5 font-semibold">Operación</th>
                      <th className="px-3 py-2.5 font-semibold">Cadencia</th>
                      <th className="px-3 py-2.5 font-semibold">Último barrido</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Vistos</th>
                      <th className="px-3 py-2.5 font-semibold text-right">
                        Portal declara <span className="inline-flex items-center gap-0.5 text-emerald-400 normal-case font-normal" title="Consultado en tiempo real en cada carga del panel"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> en vivo</span>
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right">Cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.targets.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Sin objetivos activos</td></tr>
                    )}
                    {data.targets.map((tg, i) => {
                      const cad = CAD[tg.cadencia] ?? CAD['nunca']
                      // Prioriza el total EN VIVO (consultado ahora); si el probe falló,
                      // cae al histórico guardado en la BD (con aviso de que es viejo).
                      const declared = tg.live_portal_total ?? tg.portal_reported_count
                      const isLive = tg.live_portal_total != null
                      const cov = tg.last_listing_count != null && declared
                        ? Math.round((tg.last_listing_count / declared) * 100) : null
                      return (
                        <tr key={i} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30">
                          <td className="px-4 py-2.5 text-slate-100 capitalize">
                            {tg.comuna}
                            {tg.force_refetch && (
                              <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30" title="Re-scrapeando toda la ficha (fotos/características/permalink) de los avisos ya guardados">
                                <RefreshCw size={9} className="animate-spin" /> re-scrapeando
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 capitalize">{tg.operation === 'rent' ? 'arriendo' : 'venta'}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${cad.cls}`}>{cad.icon} {cad.t}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-400">
                            {ago(tg.last_run_at)}
                            {tg.notes && (
                              <div className={`text-[10px] mt-0.5 max-w-[22rem] truncate ${(tg.consecutive_failures ?? 0) > 0 ? 'text-rose-400/90' : 'text-amber-400/90'}`} title={tg.notes}>
                                {tg.notes}
                              </div>
                            )}
                            {(tg.consecutive_failures ?? 0) > 0 && (
                              <div className="text-[10px] text-rose-300/80 mt-0.5">
                                {tg.consecutive_failures} intento{tg.consecutive_failures === 1 ? '' : 's'} bloqueado{tg.consecutive_failures === 1 ? '' : 's'} · último {ago(tg.last_failure_at)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-200 font-medium">{tg.last_listing_count ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={isLive ? 'text-slate-200 font-medium' : 'text-slate-500'} title={isLive ? `Consultado hace ${ago(tg.live_probed_at)}` : 'Sonda en vivo falló; mostrando el último valor guardado'}>
                              {declared?.toLocaleString('es-CL') ?? '—'}
                            </span>
                            {!isLive && declared != null && <span className="ml-1 text-[10px] text-amber-400">(viejo)</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {cov == null ? <span className="text-slate-600">—</span>
                              : <span className={cov >= 90 ? 'text-emerald-300' : cov >= 50 ? 'text-amber-300' : 'text-rose-300'}>{cov}%</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actividad: última hora vs 24h. El contraste es lo que importa —
                un acumulado de 24h no distingue un pico ya corregido de algo que
                sigue pasando ahora mismo. */}
            <h2 className="text-sm font-semibold text-slate-300 mb-2">Actividad</h2>
            {(() => {
              const h1 = new Map((data.activity_1h ?? []).map(a => [a.change_type, a.count]))
              const tipos = data.activity_24h.map(a => a.change_type)
              if (tipos.length === 0) {
                return <div className="text-slate-500 text-sm bg-slate-800/40 border border-slate-700/60 rounded-xl px-4 py-3">Sin cambios registrados en las últimas 24 h.</div>
              }
              return (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700 bg-slate-800/80">
                        <th className="px-4 py-2.5 font-semibold">Tipo de cambio</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Última hora</th>
                        <th className="px-3 py-2.5 font-semibold text-right">Últimas 24 h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.activity_24h.map((a) => {
                        const ahora = h1.get(a.change_type) ?? 0
                        return (
                          <tr key={a.change_type} className="border-b border-slate-700/50 last:border-0">
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${CHANGE_CLS[a.change_type] ?? 'text-slate-300 border-slate-600 bg-slate-700/30'}`}>
                                {CHANGE_LABEL[a.change_type] ?? a.change_type}
                              </span>
                            </td>
                            <td className={`px-3 py-2.5 text-right font-semibold ${ahora > 0 ? 'text-slate-100' : 'text-slate-600'}`}>{ahora}</td>
                            <td className="px-3 py-2.5 text-right text-slate-400">{a.count.toLocaleString('es-CL')}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-slate-500 px-4 py-2.5 border-t border-slate-700/60">
                    La columna de 24 h es acumulada: incluye lo corregido. Para saber si algo sigue
                    ocurriendo, mira la última hora.
                  </p>
                </div>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
