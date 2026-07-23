'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Building2, Home, Store, Images, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock,
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
  live_portal_total: number | null; live_probed_at: string | null
  cadencia: string
}
type Health = {
  success: boolean; generated_at: string; totals: Totals
  targets: Target[]; activity_24h: { change_type: string; count: number }[]
}

function ago(iso: string | null): string {
  if (!iso) return 'nunca'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `hace ${s}s`
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`
  return `hace ${Math.floor(s / 86400)}d`
}

const CAD: Record<string, { t: string; cls: string; icon: React.ReactNode }> = {
  'al-dia': { t: 'al día', cls: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30', icon: <CheckCircle2 size={12} /> },
  'atrasado': { t: 'atrasado', cls: 'text-amber-300 bg-amber-500/15 border-amber-500/30', icon: <AlertTriangle size={12} /> },
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

  const load = useCallback(() => {
    fetch('/api/chile/anuncios-health')
      .then(r => r.json())
      .then(d => { if (d.success) { setData(d); setError(null) } else setError(d.error || 'Error') })
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

  useEffect(() => {
    load()
    const id = setInterval(load, 30000) // auto-refresco cada 30s
    return () => clearInterval(id)
  }, [load])

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
              <h1 className="text-xl font-bold text-slate-100 leading-none">Salud del scraping · Anuncios CL</h1>
              <p className="text-[11px] text-slate-500 mt-1">Estado del pipeline en vivo · última lectura {data ? ago(data.generated_at) : '—'}</p>
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
            <button onClick={load} className="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg hover:border-slate-600">
              <RefreshCw size={13} /> Refrescar
            </button>
          </div>
        </div>
        {rerunMsg && <div className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 mb-3">{rerunMsg}</div>}

        {error && <div className="text-red-300 bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-sm mb-4">{error}</div>}
        {loading && !data && <div className="text-slate-400 p-8 text-center">Cargando…</div>}

        {t && (
          <>
            {/* Semáforo general */}
            <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center gap-3 text-sm ${
              scraping ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>
              {scraping ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <div>
                <span className="font-semibold">{scraping ? 'El pipeline tiene datos' : 'Aún sin anuncios ingresados'}</span>
                <span className="text-slate-400"> · último anuncio visto {fresh} · {t.corredoras_total} corredoras · {t.property_cl_total} propiedades canónicas</span>
              </div>
            </div>

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
                          <td className="px-3 py-2.5 text-slate-400">{ago(tg.last_run_at)}</td>
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

            {/* Actividad 24h */}
            <h2 className="text-sm font-semibold text-slate-300 mb-2">Actividad últimas 24 h</h2>
            {data.activity_24h.length === 0 ? (
              <div className="text-slate-500 text-sm bg-slate-800/40 border border-slate-700/60 rounded-xl px-4 py-3">Sin cambios registrados en las últimas 24 h.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.activity_24h.map((a) => (
                  <span key={a.change_type} className="inline-flex items-center gap-2 text-xs bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-300">
                    <span className="capitalize">{a.change_type}</span>
                    <span className="font-bold text-slate-100">{a.count}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
