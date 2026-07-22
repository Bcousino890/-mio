'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Globe, Phone, ExternalLink, Package, History, Timer, ShieldCheck, GitCompareArrows } from 'lucide-react'

type InventoryItem = {
  property_cl_id: string
  operation: string | null
  property_type: string | null
  canonical_price: number | null
  square_meters: number | null
  bedrooms: number | null
  bathrooms: number | null
  location_confidence: string
  comuna_name: string | null
  shared_corredora_count: number
  shared: boolean
  own_price: number | null
  own_external_id: string | null
  own_source_url: string | null
  own_is_active: boolean
  seller_reference: string | null
}

type Ficha = {
  id: string
  advertiser_id: string | null
  name: string | null
  phones: string[] | null
  web_propia_url: string | null
  crm_platform: string
  active_listings_count: number
  total_listings_seen: number
  comunas_operated: string[] | null
  avg_days_on_market: number | null
  exclusivity_ratio: number | null
  inventory: InventoryItem[]
  inventory_count: number
  shared_count: number
}

const CRM_LABELS: Record<string, string> = { convecta: 'Convecta', ofinet: 'Ofinet', other: 'Otro CRM', unknown: 'Sin detectar' }
const CRM_COLORS: Record<string, string> = {
  convecta: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  ofinet: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  other: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  unknown: 'bg-slate-700/40 text-slate-500 border-slate-700/40',
}

function clp(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}
function pct(v: number | null): string { return v == null ? '—' : `${Math.round(v * 100)}%` }
function days(v: number | null): string { return v == null ? '—' : `${Math.round(v)} días` }

const AVATAR_COLORS = ['bg-purple-600', 'bg-cyan-600', 'bg-amber-600', 'bg-emerald-600', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600']
function initials(name: string | null): string {
  if (!name) return '?'
  const p = name.trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}
function avatarColor(name: string | null): string {
  const s = name ?? ''; let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function Stat({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={`p-1.5 rounded-md ${accent}`}>{icon}</span>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

type InvFilter = 'all' | 'shared' | 'exclusive'

export default function CorredoraFichaClient({ id }: { id: string }) {
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [invFilter, setInvFilter] = useState<InvFilter>('all')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/chile/corredoras/${id}`)
      .then(r => r.json())
      .then(data => { if (data.success) setFicha(data.data); else setError(data.error || 'No encontrada') })
      .catch(e => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }, [id])

  const inventory = useMemo(() => {
    if (!ficha) return []
    if (invFilter === 'shared') return ficha.inventory.filter(i => i.shared)
    if (invFilter === 'exclusive') return ficha.inventory.filter(i => !i.shared)
    return ficha.inventory
  }, [ficha, invFilter])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 lg:p-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/chile/corredoras" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-400 mb-4">
          <ArrowLeft size={14} /> Volver a corredoras
        </Link>

        {loading && <div className="text-slate-400 p-8 text-center">Cargando…</div>}
        {error && <div className="text-red-300 bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-sm">{error}</div>}

        {ficha && (
          <>
            {/* Header */}
            <div className="flex items-start gap-4 mb-5">
              <div className={`w-14 h-14 rounded-2xl ${avatarColor(ficha.name)} flex items-center justify-center text-lg font-bold text-white shrink-0`}>
                {initials(ficha.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-slate-100 capitalize">{ficha.name || '(sin nombre)'}</h1>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CRM_COLORS[ficha.crm_platform] ?? CRM_COLORS.unknown}`}>
                    {CRM_LABELS[ficha.crm_platform] ?? ficha.crm_platform}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-400">
                  {ficha.advertiser_id && <span>ML seller: <code className="bg-slate-800 px-1 rounded">{ficha.advertiser_id}</code></span>}
                  {ficha.web_propia_url && (
                    <a href={ficha.web_propia_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
                      <Globe size={12} /> {ficha.web_propia_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  )}
                  {(ficha.phones ?? []).map(p => (
                    <a key={p} href={`tel:${p}`} className="inline-flex items-center gap-1 hover:text-slate-200"><Phone size={11} /> {p}</a>
                  ))}
                </div>
                {(ficha.comunas_operated ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(ficha.comunas_operated ?? []).map(cm => (
                      <span key={cm} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400">{cm}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Métricas */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Stat icon={<Package size={14} />} label="Stock activo" value={String(ficha.active_listings_count)} accent="bg-blue-500/15 text-blue-400" />
              <Stat icon={<History size={14} />} label="Histórico" value={String(ficha.total_listings_seen)} hint="anuncios vistos" accent="bg-slate-600/40 text-slate-300" />
              <Stat icon={<Timer size={14} />} label="Rotación" value={days(ficha.avg_days_on_market)} hint="promedio en mercado" accent="bg-teal-500/15 text-teal-400" />
              <Stat icon={<ShieldCheck size={14} />} label="Exclusividad" value={pct(ficha.exclusivity_ratio)} hint="solo ella publica" accent="bg-emerald-500/15 text-emerald-400" />
              <Stat icon={<GitCompareArrows size={14} />} label="En canje" value={String(ficha.shared_count)} hint="comparte con otra" accent="bg-amber-500/15 text-amber-400" />
            </div>

            {/* Inventario */}
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-slate-300">
                Inventario · {ficha.inventory_count} {ficha.inventory_count === 1 ? 'propiedad' : 'propiedades'}
              </h2>
              <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-0.5">
                {([['all', 'Todas'], ['shared', 'En canje'], ['exclusive', 'Exclusivas']] as [InvFilter, string][]).map(([k, lbl]) => (
                  <button key={k} onClick={() => setInvFilter(k)}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${invFilter === k ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700 bg-slate-800/80">
                      <th className="px-4 py-2.5 font-semibold">Propiedad</th>
                      <th className="px-3 py-2.5 font-semibold">Comuna</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Precio (su anuncio)</th>
                      <th className="px-3 py-2.5 font-semibold">Ref. interna</th>
                      <th className="px-3 py-2.5 font-semibold">Exclusividad</th>
                      <th className="px-3 py-2.5 font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Sin propiedades en esta vista</td></tr>
                    )}
                    {inventory.map(it => (
                      <tr key={it.property_cl_id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30">
                        <td className="px-4 py-3">
                          <span className="text-slate-100">{(it.bedrooms ?? '?')} dorm · {(it.square_meters ?? '?')} m² · {it.property_type ?? 'casa'}</span>
                          {!it.own_is_active && <span className="ml-2 text-[10px] text-slate-500">(dada de baja)</span>}
                        </td>
                        <td className="px-3 py-3 text-slate-400">{it.comuna_name || '—'}</td>
                        <td className="px-3 py-3 text-right text-slate-200 font-medium">{clp(it.own_price)}</td>
                        <td className="px-3 py-3 text-slate-400 text-xs font-mono">{it.seller_reference || '—'}</td>
                        <td className="px-3 py-3">
                          {it.shared ? (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              <GitCompareArrows size={10} /> en canje ({it.shared_corredora_count})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              <ShieldCheck size={10} /> exclusiva
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {it.own_source_url && (
                            <a href={it.own_source_url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-cyan-400 inline-flex" title="Ver anuncio original">
                              <ExternalLink size={14} />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
