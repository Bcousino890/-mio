'use client'

import { useState, use } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { mockListings } from '@/lib/mock-listings'
import {
  ArrowLeft, MapPin, Bookmark, Calculator, FileText,
  ChevronRight, ChevronDown, ExternalLink, Building2, User,
  TrendingDown, ChevronLeft, CheckCircle, XCircle,
} from 'lucide-react'

const PriceChart = dynamic(() => import('@/components/PriceChart'), { ssr: false })

function fmt(n: number) { return n.toLocaleString('es-ES') }

function timeSince(dateStr: string) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Hace 1 día'
  if (days < 30) return `Hace ${days} días`
  const months = Math.floor(days / 30)
  return `Hace ${months} ${months === 1 ? 'mes' : 'meses'}`
}

const STATUS_CONFIG = {
  active:    { label: 'Venta activa',  icon: CheckCircle, className: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/40' },
  withdrawn: { label: 'Retirado',      icon: XCircle,     className: 'text-red-400 bg-red-950/60 border-red-800/40' },
  sold:      { label: 'Vendido',       icon: CheckCircle, className: 'text-blue-400 bg-blue-950/60 border-blue-800/40' },
}

const EVENT_CONFIG: Record<string, { color: string; dot: string; label: string }> = {
  listed:         { color: 'text-blue-400',   dot: 'bg-blue-500',    label: 'Publicado' },
  price_drop:     { color: 'text-emerald-400',dot: 'bg-emerald-500', label: 'Bajada de precio' },
  price_increase: { color: 'text-red-400',    dot: 'bg-red-500',     label: 'Subida de precio' },
  relisted:       { color: 'text-violet-400', dot: 'bg-violet-500',  label: 'Republicado' },
  withdrawn:      { color: 'text-slate-400',  dot: 'bg-slate-500',   label: 'Retirado' },
}

type Tab = 'detalles' | 'fuentes' | 'historico'

export default function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('detalles')
  const [photoIdx, setPhotoIdx] = useState(0)
  const [expandedSource, setExpandedSource] = useState<string | null>(null)

  const listing = mockListings.find((l) => l.id === resolvedParams.id)

  if (!listing) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600">
        <p className="text-lg font-semibold mb-2">Propiedad no encontrada</p>
        <button onClick={() => router.back()} className="text-blue-400 text-sm underline">← Volver</button>
      </div>
    )
  }

  const l = listing
  const priceDropPct = l.priceHistory.length > 1
    ? Math.round(((l.priceHistory[0].price - l.price) / l.priceHistory[0].price) * 100)
    : 0

  return (
    <div className="flex flex-col h-full bg-[#08090e] overflow-hidden">
      {/* ── Top bar ── */}
      <header className="flex-none flex items-center gap-3 px-4 py-3 border-b border-[#1a1f2e] bg-[#08090e]">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft size={14} />
          Anuncios
        </button>
        <ChevronRight size={12} className="text-slate-700" />
        <span className="text-xs text-slate-400 truncate max-w-xs">{l.title}</span>
        <div className="ml-auto flex items-center gap-2">
          {l.rc_status !== 'none' && (
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
              l.rc_status === 'rc20'
                ? 'bg-violet-950/60 border-violet-800/40 text-violet-400'
                : 'bg-blue-950/60 border-blue-800/40 text-blue-400'
            }`}>
              {l.rc_status.toUpperCase()}
            </span>
          )}
        </div>
      </header>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-5 space-y-5">

          {/* ── Photo gallery + info ── */}
          <div className="grid grid-cols-5 gap-4">

            {/* Gallery */}
            <div className="col-span-3 space-y-2">
              <div className="relative rounded-2xl overflow-hidden bg-[#0d1117] aspect-[4/3] group">
                {l.photos.length > 0 ? (
                  <img
                    src={l.photos[photoIdx]}
                    alt={l.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-700">
                    <Building2 size={40} />
                  </div>
                )}
                {l.photos.length > 1 && (
                  <>
                    <button
                      onClick={() => setPhotoIdx((i) => (i === 0 ? l.photos.length - 1 : i - 1))}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => setPhotoIdx((i) => (i === l.photos.length - 1 ? 0 : i + 1))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ChevronRight size={16} />
                    </button>
                    <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-0.5 rounded-full">
                      {photoIdx + 1} / {l.photos.length}
                    </div>
                  </>
                )}
              </div>

              {/* Thumbnails */}
              {l.photos.length > 1 && (
                <div className="flex gap-2">
                  {l.photos.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setPhotoIdx(i)}
                      className={`w-16 h-11 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                        i === photoIdx ? 'border-blue-500' : 'border-transparent opacity-60 hover:opacity-90'
                      }`}
                    >
                      <img src={p} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Info sidebar */}
            <div className="col-span-2 space-y-3">
              {/* Price card */}
              <div className="bg-[#0d1117] border border-[#1e2130] rounded-2xl p-4">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <p className="text-2xl font-bold text-white tracking-tight">
                      {fmt(l.price)} {l.operation === 'sale' ? '€' : '€/mes'}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">{fmt(l.price_sqm)} €/m²</p>
                  </div>
                  {priceDropPct > 0 && (
                    <div className="flex items-center gap-1 bg-emerald-950/60 border border-emerald-800/40 text-emerald-400 text-xs font-semibold px-2 py-1 rounded-lg">
                      <TrendingDown size={12} />
                      -{priceDropPct}%
                    </div>
                  )}
                </div>

                {l.exact_address && (
                  <div className="flex items-start gap-2 mt-3 p-2.5 bg-[#151b2b] rounded-xl">
                    <div className="w-8 h-8 rounded-lg bg-[#1e2a45] flex items-center justify-center flex-shrink-0">
                      <MapPin size={14} className="text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-300">{l.exact_address}</p>
                      <p className="text-[11px] text-blue-400 mt-0.5 cursor-pointer hover:text-blue-300">Cambiar dirección ↻</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="bg-[#0d1117] border border-[#1e2130] rounded-2xl p-4">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: Bookmark,   label: 'Guardar',  color: 'text-blue-400',   bg: 'bg-blue-950/50'   },
                    { icon: Calculator, label: 'Valorar',  color: 'text-violet-400', bg: 'bg-violet-950/50' },
                    { icon: FileText,   label: 'Nota',     color: 'text-amber-400',  bg: 'bg-amber-950/50'  },
                  ].map(({ icon: Icon, label, color, bg }) => (
                    <button
                      key={label}
                      className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl hover:bg-[#151b2b] transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center`}>
                        <Icon size={16} className={color} />
                      </div>
                      <span className="text-[11px] text-slate-500 font-medium">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick stats */}
              <div className="bg-[#0d1117] border border-[#1e2130] rounded-2xl p-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Superficie', value: `${l.square_meters} m²` },
                    { label: 'Habitaciones', value: l.bedrooms > 0 ? `${l.bedrooms} hab.` : 'Estudio' },
                    { label: 'Baños', value: `${l.bathrooms}` },
                    { label: 'Planta', value: l.floor ?? '—' },
                    { label: 'En mercado', value: l.days_on_market === 0 ? 'Hoy' : `${l.days_on_market} días` },
                    { label: 'Fuentes', value: `${l.listing_count} portal${l.listing_count > 1 ? 'es' : ''}` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-0.5">{label}</p>
                      <p className="text-sm text-slate-300 font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="border-b border-[#1a1f2e]">
            <div className="flex gap-1">
              {(['detalles', 'fuentes', 'historico'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-all ${
                    tab === t
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-600 hover:text-slate-400'
                  }`}
                >
                  {t === 'historico' ? 'Histórico' : t.charAt(0).toUpperCase() + t.slice(1)}
                  {t === 'fuentes' && (
                    <span className="ml-1.5 text-[10px] bg-[#1e2a45] text-blue-400 px-1.5 py-0.5 rounded-full">
                      {l.sources.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── Tab content ── */}

          {/* DETALLES */}
          {tab === 'detalles' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#0d1117] border border-[#1e2130] rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Características</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Tipo de operación', value: l.operation === 'sale' ? 'Venta' : 'Alquiler' },
                    { label: 'Superficie construida', value: `${l.square_meters} m²` },
                    { label: 'Habitaciones', value: l.bedrooms > 0 ? `${l.bedrooms}` : 'Estudio' },
                    { label: 'Baños', value: `${l.bathrooms}` },
                    { label: 'Planta', value: l.floor ?? 'No especificada' },
                    { label: 'Zona', value: l.zone_name },
                    { label: 'Dirección', value: l.exact_address ?? 'No disponible' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-600">{label}</span>
                      <span className="text-xs text-slate-300 font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#0d1117] border border-[#1e2130] rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Análisis de mercado</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Precio / m²', value: `${fmt(l.price_sqm)} €/m²` },
                    { label: 'Precio publicación', value: `${fmt(l.priceHistory[0]?.price ?? l.price)} €` },
                    { label: 'Precio actual', value: `${fmt(l.price)} €` },
                    { label: 'Variación total', value: priceDropPct > 0 ? `-${priceDropPct}%` : '—', colored: priceDropPct > 0 },
                    { label: 'Días en mercado', value: `${l.days_on_market}` },
                    { label: 'Nº bajadas de precio', value: `${l.price_drops}` },
                    { label: 'RC Status', value: l.rc_status === 'none' ? 'Sin RC' : l.rc_status.toUpperCase() },
                  ].map(({ label, value, colored }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-600">{label}</span>
                      <span className={`text-xs font-medium ${colored ? 'text-emerald-400' : 'text-slate-300'}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FUENTES */}
          {tab === 'fuentes' && (
            <div className="bg-[#0d1117] border border-[#1e2130] rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#1a1f2e]">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Comercializando</h3>
              </div>
              <div className="divide-y divide-[#1a1f2e]">
                {l.sources.map((src) => {
                  const st = STATUS_CONFIG[src.status]
                  const StatusIcon = st.icon
                  const isExpanded = expandedSource === src.id

                  return (
                    <div key={src.id}>
                      <button
                        onClick={() => setExpandedSource(isExpanded ? null : src.id)}
                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#0f1520] transition-colors text-left"
                      >
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                          src.type === 'particular' ? 'bg-amber-950/60' : 'bg-slate-800'
                        }`}>
                          {src.type === 'particular'
                            ? <User size={16} className="text-amber-400" />
                            : <Building2 size={16} className="text-slate-400" />
                          }
                        </div>

                        {/* Name & type */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-slate-600 mb-0.5">
                            {src.type === 'particular' ? 'Particular' : 'Agencia'}
                          </p>
                          <p className="text-sm font-semibold text-slate-200 truncate">{src.name}</p>
                          <p className="text-[11px] text-slate-600 mt-0.5">{src.portal} · {timeSince(src.listed_at)}</p>
                        </div>

                        {/* Price */}
                        <div className="text-right flex-shrink-0 mr-3">
                          <p className="text-sm font-bold text-slate-200">{fmt(src.price)} €</p>
                          <p className="text-[10px] text-slate-600">precio anunciado</p>
                        </div>

                        {/* Status */}
                        <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 ${st.className}`}>
                          <StatusIcon size={11} />
                          {st.label}
                        </div>

                        {/* Expand arrow */}
                        <ChevronDown
                          size={14}
                          className={`text-slate-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="bg-[#060810] border-t border-[#1a1f2e] px-5 py-3 flex items-center justify-between">
                          <div className="flex gap-6 text-xs">
                            <div>
                              <p className="text-slate-600 mb-0.5">Portal</p>
                              <p className="text-slate-300 font-medium">{src.portal}</p>
                            </div>
                            <div>
                              <p className="text-slate-600 mb-0.5">Publicado</p>
                              <p className="text-slate-300 font-medium">{new Date(src.listed_at).toLocaleDateString('es-ES')}</p>
                            </div>
                            <div>
                              <p className="text-slate-600 mb-0.5">Precio</p>
                              <p className="text-slate-300 font-medium">{fmt(src.price)} €</p>
                            </div>
                          </div>
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Ver anuncio <ExternalLink size={11} />
                          </a>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* HISTÓRICO */}
          {tab === 'historico' && (
            <div className="space-y-4">
              {/* Price chart */}
              <div className="bg-[#0d1117] border border-[#1e2130] rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Evolución del precio</h3>
                  {priceDropPct > 0 && (
                    <span className="text-xs text-emerald-400 font-semibold">
                      -{priceDropPct}% desde publicación
                    </span>
                  )}
                </div>
                <PriceChart data={l.priceHistory} operation={l.operation} />
              </div>

              {/* Timeline */}
              <div className="bg-[#0d1117] border border-[#1e2130] rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-5">Línea de tiempo</h3>
                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#1e2130]" />
                  <div className="space-y-5">
                    {[...l.priceHistory].reverse().map((ev, i) => {
                      const cfg = EVENT_CONFIG[ev.event] ?? EVENT_CONFIG.listed
                      const prev = [...l.priceHistory].reverse()[i + 1]
                      const delta = prev ? ev.price - prev.price : 0

                      return (
                        <div key={i} className="flex gap-4 relative">
                          <div className={`w-3.5 h-3.5 rounded-full ${cfg.dot} flex-shrink-0 mt-0.5 ring-4 ring-[#0d1117]`} />
                          <div className="flex-1 pb-1">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</p>
                                <p className="text-[11px] text-slate-600 mt-0.5">
                                  {new Date(ev.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-slate-200">{fmt(ev.price)} €</p>
                                {delta !== 0 && (
                                  <p className={`text-[11px] font-medium mt-0.5 ${delta < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {delta < 0 ? '' : '+'}{fmt(delta)} €
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bottom spacer */}
          <div className="h-4" />
        </div>
      </div>
    </div>
  )
}
