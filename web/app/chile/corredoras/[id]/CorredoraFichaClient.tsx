'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Globe, Phone, Store, ExternalLink } from 'lucide-react'

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

function clp(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}
function pct(v: number | null): string { return v == null ? '—' : `${Math.round(v * 100)}%` }
function days(v: number | null): string { return v == null ? '—' : `${Math.round(v)} días` }

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

export default function CorredoraFichaClient({ id }: { id: string }) {
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/chile/corredoras/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setFicha(data.data)
        else setError(data.error || 'No encontrada')
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }, [id])

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
            <div className="flex items-start gap-3 mb-5">
              <Store className="text-amber-400 mt-1" size={24} />
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-slate-100 capitalize">{ficha.name || '(sin nombre)'}</h1>
                <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-400">
                  <span>CRM: <span className="text-slate-200">{CRM_LABELS[ficha.crm_platform] ?? ficha.crm_platform}</span></span>
                  {ficha.advertiser_id && <span>ML seller: <code className="bg-slate-800 px-1 rounded">{ficha.advertiser_id}</code></span>}
                  {ficha.web_propia_url && (
                    <a href={ficha.web_propia_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
                      <Globe size={12} /> {ficha.web_propia_url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {(ficha.phones ?? []).map(p => (
                    <span key={p} className="inline-flex items-center gap-1"><Phone size={11} /> {p}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Métricas */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Stat label="Stock activo" value={String(ficha.active_listings_count)} />
              <Stat label="Histórico" value={String(ficha.total_listings_seen)} hint="anuncios vistos" />
              <Stat label="Rotación" value={days(ficha.avg_days_on_market)} hint="promedio en mercado" />
              <Stat label="Exclusividad" value={pct(ficha.exclusivity_ratio)} hint="solo ella publica" />
              <Stat label="En canje" value={String(ficha.shared_count)} hint="comparte con otra" />
            </div>

            {/* Inventario */}
            <h2 className="text-sm font-semibold text-slate-300 mb-2">
              Inventario · {ficha.inventory_count} {ficha.inventory_count === 1 ? 'propiedad' : 'propiedades'}
            </h2>
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700">
                      <th className="px-4 py-2.5 font-semibold">Propiedad</th>
                      <th className="px-3 py-2.5 font-semibold">Comuna</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Precio (su anuncio)</th>
                      <th className="px-3 py-2.5 font-semibold">Ref. interna</th>
                      <th className="px-3 py-2.5 font-semibold">Exclusividad</th>
                      <th className="px-3 py-2.5 font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ficha.inventory.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Sin inventario registrado</td></tr>
                    )}
                    {ficha.inventory.map(it => (
                      <tr key={it.property_cl_id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30">
                        <td className="px-4 py-3">
                          <span className="text-slate-100">
                            {(it.bedrooms ?? '?')} dorm · {(it.square_meters ?? '?')} m² · {it.property_type ?? 'casa'}
                          </span>
                          {!it.own_is_active && <span className="ml-2 text-[10px] text-slate-500">(dada de baja)</span>}
                        </td>
                        <td className="px-3 py-3 text-slate-400">{it.comuna_name || '—'}</td>
                        <td className="px-3 py-3 text-right text-slate-200">{clp(it.own_price)}</td>
                        <td className="px-3 py-3 text-slate-400 text-xs">{it.seller_reference || '—'}</td>
                        <td className="px-3 py-3">
                          {it.shared ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/40">
                              en canje ({it.shared_corredora_count})
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
                              exclusiva
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {it.own_source_url && (
                            <a href={it.own_source_url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-cyan-400 inline-flex">
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
