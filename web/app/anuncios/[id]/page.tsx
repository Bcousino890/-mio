'use client'

import { useState, use } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { mockListings } from '@/lib/mock-listings'
import {
  ArrowLeft, MapPin, Bookmark, Calculator, FileText, UserSearch,
  ChevronRight, Building2, User,
  TrendingDown, ChevronLeft, CheckCircle, XCircle,
  Phone, MessageCircle, Bed, Bath,
  Armchair, ArrowUpDown, BellRing, Car, ChefHat, Flame,
  Sun, TreePalm, Waves, Wind, Home, Star, ExternalLink,
} from 'lucide-react'

const PriceChart = dynamic(() => import('@/components/PriceChart'), { ssr: false })
const DetailMap = dynamic(() => import('@/components/map/DetailMap'), { ssr: false })

function fmt(n: number) { return n.toLocaleString('es-ES') }

function cleanTitle(title: string) {
  return title
    .replace(/^(?:alquiler|venta)\s+de\s+\w+\s+en\s+/i, '')
    .trim()
}

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

// Map Idealista feature text → lucide icon
type IconComponent = React.ComponentType<{ size?: number; className?: string }>
const FEATURE_ICON_MAP: Array<{ pattern: RegExp; icon: IconComponent; label: string }> = [
  { pattern: /balc[oó]n/i,              icon: Home,       label: 'Balcón' },
  { pattern: /terraza/i,                icon: TreePalm,   label: 'Terraza' },
  { pattern: /ascensor/i,               icon: ArrowUpDown,label: 'Ascensor' },
  { pattern: /aire acondicionado/i,     icon: Wind,       label: 'Aire A/C' },
  { pattern: /calefacci[oó]n/i,         icon: Flame,      label: 'Calefacción' },
  { pattern: /amueblad/i,               icon: Armchair,   label: 'Amueblado' },
  { pattern: /cocina equipada/i,        icon: ChefHat,    label: 'Cocina equipada' },
  { pattern: /piscina/i,               icon: Waves,       label: 'Piscina' },
  { pattern: /portero|conserjería/i,    icon: BellRing,   label: 'Portero' },
  { pattern: /garaje|parking/i,         icon: Car,        label: 'Garaje' },
  { pattern: /exterior/i,               icon: Sun,        label: 'Exterior' },
  { pattern: /buen estado|segunda mano/i,icon: Star,      label: 'Buen estado' },
]

function parseFeatureIcons(features: string[]) {
  const matched: { icon: IconComponent; label: string }[] = []
  const rest: string[] = []
  const usedIdx = new Set<number>()

  for (const f of features) {
    const hit = FEATURE_ICON_MAP.find((m) => m.pattern.test(f))
    if (hit && !matched.find((m) => m.label === hit.label)) {
      matched.push({ icon: hit.icon, label: hit.label })
      usedIdx.add(features.indexOf(f))
    } else if (!hit) {
      // Skip purely numeric rows (m², rooms, baths — already shown in stats)
      if (!/^\d+\s*(?:m²|habitaci|baño)/i.test(f)) rest.push(f)
    }
  }
  return { matched, rest }
}

// Escala de color del certificado energético (A verde → G rojo)
const ENERGY_COLORS: Record<string, string> = {
  A: '#00a651', B: '#50b848', C: '#bfd730', D: '#fff200',
  E: '#fcb814', F: '#f37021', G: '#ed1c24',
}
function EnergyLetter({ label, letter }: { label: string; letter?: string | null }) {
  const L = (letter ?? '').toUpperCase()
  const color = ENERGY_COLORS[L]
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-500 w-20">{label}</span>
      {color ? (
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded text-white text-xs font-bold"
          style={{ background: color }}
        >
          {L}
        </span>
      ) : (
        <span className="text-xs text-slate-600">No indicado</span>
      )}
    </div>
  )
}

type Tab = 'detalles' | 'fuentes' | 'historico'

export default function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('detalles')
  const [mediaTab, setMediaTab] = useState<'fotos' | 'planos' | 'video'>('fotos')
  const [photoIdx, setPhotoIdx] = useState(0)
  const [smartlinkSources, setSmartlinkSources] = useState(false)
  const [smartlinkHistory, setSmartlinkHistory] = useState(false)
  const [showFullDesc, setShowFullDesc] = useState(false)

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
    <div className="flex flex-col h-full bg-[var(--c-bg)] overflow-hidden">
      {/* ── Top bar ── */}
      <header className="flex-none flex items-center gap-3 px-4 py-3 border-b border-[var(--c-border)] bg-[var(--c-bg)]">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft size={14} />
          Anuncios
        </button>
        <ChevronRight size={12} className="text-slate-700" />
        <span className="text-xs text-slate-400 truncate max-w-xs">{cleanTitle(l.title)}</span>
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
              {/* Media tabs */}
              {(l.floor_plans?.length || l.videos?.length) ? (
                <div className="flex gap-1 mb-1">
                  {(['fotos', ...(l.floor_plans?.length ? ['planos'] : []), ...(l.videos?.length ? ['video'] : [])] as const).map((mt) => (
                    <button
                      key={mt}
                      onClick={() => { setMediaTab(mt as 'fotos' | 'planos' | 'video'); setPhotoIdx(0) }}
                      className={`px-3 py-1 text-xs font-medium rounded-lg border transition-all capitalize ${
                        mediaTab === mt
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'border-[var(--c-border-card)] text-slate-500 hover:text-slate-300'
                      }`}
                      style={mediaTab !== mt ? { background: 'var(--c-surface)' } : undefined}
                    >
                      {mt === 'video' ? 'Vídeo' : mt.charAt(0).toUpperCase() + mt.slice(1)}
                      {mt === 'fotos' && l.photos.length > 0 && (
                        <span className="ml-1 text-[10px] opacity-60">{l.photos.length}</span>
                      )}
                      {mt === 'planos' && l.floor_plans && (
                        <span className="ml-1 text-[10px] opacity-60">{l.floor_plans.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Main media viewer */}
              <div className="relative rounded-2xl overflow-hidden bg-[var(--c-card)] aspect-[4/3] group">
                {mediaTab === 'video' && l.videos?.length ? (
                  <iframe
                    src={l.videos[0]}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : mediaTab === 'planos' && l.floor_plans?.length ? (
                  <img
                    src={l.floor_plans[photoIdx] ?? l.floor_plans[0]}
                    alt="Plano"
                    className="w-full h-full object-contain p-4"
                  />
                ) : l.photos.length > 0 ? (
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
                {/* Prev/next for fotos & planos */}
                {mediaTab !== 'video' && (() => {
                  const arr = mediaTab === 'planos' ? (l.floor_plans ?? []) : l.photos
                  return arr.length > 1 ? (
                    <>
                      <button
                        onClick={() => setPhotoIdx((i) => (i === 0 ? arr.length - 1 : i - 1))}
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        onClick={() => setPhotoIdx((i) => (i === arr.length - 1 ? 0 : i + 1))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ChevronRight size={16} />
                      </button>
                      <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-0.5 rounded-full">
                        {photoIdx + 1} / {arr.length}
                      </div>
                    </>
                  ) : null
                })()}
              </div>

              {/* Thumbnails */}
              {mediaTab === 'fotos' && l.photos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
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
              {mediaTab === 'planos' && (l.floor_plans?.length ?? 0) > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {l.floor_plans!.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setPhotoIdx(i)}
                      className={`w-16 h-11 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                        i === photoIdx ? 'border-blue-500' : 'border-transparent opacity-60 hover:opacity-90'
                      }`}
                    >
                      <img src={p} alt="" className="w-full h-full object-contain" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Info sidebar */}
            <div className="col-span-2 space-y-3">
              {/* Price card */}
              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-4">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <p className="text-2xl font-bold text-slate-100 tracking-tight">
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
                  <div className="flex items-start gap-2 mt-3 p-2.5 bg-[var(--c-surface)] rounded-xl">
                    <div className="w-8 h-8 rounded-lg bg-[var(--c-active)] flex items-center justify-center flex-shrink-0">
                      <MapPin size={14} className="text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-300">{l.exact_address}</p>
                      <p className="text-[11px] text-emerald-400 mt-0.5">Dirección exacta ✓</p>
                    </div>
                  </div>
                )}

                {l.source_url && l.source_url !== '#' && (
                  <a
                    href={l.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 mt-3 w-full py-2 rounded-xl bg-[var(--c-surface)] border border-[var(--c-border-card)] text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Ver en {l.portal.charAt(0).toUpperCase() + l.portal.slice(1)}
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>

              {/* Action buttons */}
              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-4">
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { icon: UserSearch, label: 'Buscar contacto', color: 'text-white',     bg: 'bg-blue-600',      primary: true },
                    { icon: Bookmark,   label: 'Guardar',         color: 'text-blue-400',   bg: 'bg-blue-950/50'   },
                    { icon: Calculator, label: 'Valorar',         color: 'text-violet-400', bg: 'bg-violet-950/50' },
                    { icon: FileText,   label: 'Crear nota',      color: 'text-amber-400',  bg: 'bg-amber-950/50'  },
                  ].map(({ icon: Icon, label, color, bg, primary }) => (
                    <button
                      key={label}
                      className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl hover:bg-[var(--c-surface)] transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center ${primary ? 'shadow-lg shadow-blue-600/30' : ''}`}>
                        <Icon size={16} className={color} />
                      </div>
                      <span className="text-[11px] text-slate-500 font-medium text-center leading-tight">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick stats */}
              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-4">
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
          <div className="border-b border-[var(--c-border)]">
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
                    <span className="ml-1.5 text-[10px] bg-[var(--c-active)] text-blue-400 px-1.5 py-0.5 rounded-full">
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
            <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Características</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Tipo de operación', value: l.operation === 'sale' ? 'Venta' : 'Alquiler' },
                    { label: 'Inmueble', value: (() => {
                      const f = l.features?.find((ft) => /piso|ático|atico|estudio|dúplex|duplex|chalet|loft|apartamento/i.test(ft))
                      const m = (l.title + ' ' + (f ?? '')).match(/piso|ático|atico|estudio|dúplex|duplex|chalet|loft|apartamento/i)
                      return m ? m[0].charAt(0).toUpperCase() + m[0].slice(1).replace('atico', 'ático').replace('duplex', 'dúplex') : 'Piso'
                    })() },
                    { label: 'Superficie construida', value: `${l.square_meters} m²` },
                    { label: 'Habitaciones', value: l.bedrooms > 0 ? `${l.bedrooms}` : 'Estudio' },
                    { label: 'Baños', value: `${l.bathrooms}` },
                    { label: 'Planta', value: l.floor ?? 'No especificada' },
                    ...(l.deposit_months ? [{ label: 'Fianza', value: `${l.deposit_months} ${l.deposit_months === 1 ? 'mes' : 'meses'}` }] : []),
                    { label: 'Zona', value: l.distrito ? `${l.zone_name} · ${l.distrito}` : l.zone_name },
                    { label: 'Dirección', value: l.exact_address ?? l.sources[0]?.address ?? 'No disponible' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-slate-600">{label}</span>
                      <span className="text-xs text-slate-300 font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
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

            {/* Certificado energético + Estadísticas del anuncio */}
            {(l.energy_cert || l.stats) && (
              <div className="grid grid-cols-2 gap-4">
                {l.energy_cert && (
                  <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Certificado energético</h3>
                    <div className="flex items-center gap-6">
                      <div className="space-y-2.5">
                        <EnergyLetter label="Consumo" letter={l.energy_cert.consumption} />
                        <EnergyLetter label="Emisiones" letter={l.energy_cert.emissions} />
                      </div>
                      {l.energy_cert.image && (
                        <img
                          src={l.energy_cert.image}
                          alt="Etiqueta de calificación energética"
                          className="h-24 w-auto rounded-lg border border-[var(--c-border-card)] bg-white p-1"
                        />
                      )}
                    </div>
                  </div>
                )}

                {l.stats && (
                  <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Estadísticas del anuncio</h3>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Visitas', value: l.stats.views },
                        { label: 'Contactos', value: l.stats.email_contacts },
                        { label: 'Favoritos', value: l.stats.favorites },
                      ].map(({ label, value }) => (
                        <div key={label} className="text-center">
                          <p className="text-2xl font-bold text-slate-200">{value ?? '—'}</p>
                          <p className="text-[10px] text-slate-600 uppercase tracking-wide mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mapa de ubicación */}
            <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--c-border)]">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Ubicación</h3>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <MapPin size={12} className="text-blue-400" />
                  {l.exact_address ?? l.zone_name}
                </span>
              </div>
              <div className="h-72">
                <DetailMap
                  latitude={l.latitude}
                  longitude={l.longitude}
                  exact={!!l.exact_address}
                />
              </div>
            </div>

            {/* Características del anuncio — iconos + pills */}
            {l.features && l.features.length > 0 && (() => {
              const { matched, rest } = parseFeatureIcons(l.features)
              return (
                <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Características</h3>
                  {matched.length > 0 && (
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 mb-4">
                      {matched.map(({ icon: Icon, label }) => (
                        <div key={label} className="flex flex-col items-center gap-1.5 text-center">
                          <span className="w-10 h-10 rounded-xl bg-[var(--c-surface)] border border-[var(--c-border-card)] flex items-center justify-center text-blue-400">
                            <Icon size={16} />
                          </span>
                          <span className="text-[10px] text-slate-400 leading-tight">{label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {rest.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {rest.map((f, i) => (
                        <span key={i} className="text-[11px] text-slate-400 bg-[var(--c-surface)] border border-[var(--c-border-card)] px-2.5 py-1 rounded-lg">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Descripción (scrapeada) */}
            {l.description && (
              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Descripción</h3>
                <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-line">
                  {showFullDesc || l.description.length <= 400
                    ? l.description
                    : l.description.slice(0, 400) + '…'}
                </p>
                {l.description.length > 400 && (
                  <button
                    onClick={() => setShowFullDesc((v) => !v)}
                    className="mt-2 text-xs text-blue-400 hover:text-blue-300 font-medium"
                  >
                    {showFullDesc ? 'Ver menos ↑' : 'Ver descripción completa ↓'}
                  </button>
                )}
              </div>
            )}
            </div>
          )}

          {/* FUENTES — tabla Comercializando */}
          {tab === 'fuentes' && (
            <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl overflow-hidden">
              {/* Cabecera: título + toggle Venta/Alquiler + Smartlink */}
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--c-border)]">
                <div className="flex items-center gap-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Comercializando</h3>
                  <span className="text-[11px] text-slate-600 bg-[var(--c-surface)] px-2 py-0.5 rounded-full">
                    {l.sources.length} fuentes
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Incluir tabla de fuentes en el Smartlink</span>
                  <button
                    onClick={() => setSmartlinkSources((v) => !v)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${smartlinkSources ? 'bg-blue-600' : 'bg-[var(--c-border-card)]'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${smartlinkSources ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>

              {/* Tabla con scroll horizontal */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[920px]">
                  <thead>
                    <tr className="text-[10px] text-slate-600 uppercase tracking-wide border-b border-[var(--c-border)]">
                      <th className="font-medium px-5 py-2.5">Fuente</th>
                      <th className="font-medium px-3 py-2.5">Referencia</th>
                      <th className="font-medium px-3 py-2.5">Teléfono</th>
                      <th className="font-medium px-3 py-2.5 text-right">Precio</th>
                      <th className="font-medium px-3 py-2.5">Estado</th>
                      <th className="font-medium px-3 py-2.5">Dirección</th>
                      <th className="font-medium px-3 py-2.5 text-center"><Bed size={12} className="inline" /></th>
                      <th className="font-medium px-3 py-2.5 text-center"><Bath size={12} className="inline" /></th>
                      <th className="font-medium px-3 py-2.5 text-right">Área</th>
                      <th className="font-medium px-3 py-2.5 text-center">Particular</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--c-border)]">
                    {l.sources.map((src) => {
                      const st = STATUS_CONFIG[src.status]
                      return (
                        <tr key={src.id} className="hover:bg-[var(--c-hover)] transition-colors">
                          {/* Fuente */}
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                                src.is_particular ? 'bg-amber-950/60' : 'bg-slate-800'
                              }`}>
                                {src.is_particular
                                  ? <User size={13} className="text-amber-400" />
                                  : <Building2 size={13} className="text-slate-400" />}
                              </div>
                              <div className="min-w-0">
                                <a
                                  href={src.url} target="_blank" rel="noopener noreferrer"
                                  className="text-xs font-semibold text-blue-400 hover:text-blue-300 truncate flex items-center gap-1"
                                >
                                  {src.name}
                                </a>
                                <p className="text-[10px] text-slate-600">{src.portal}</p>
                              </div>
                            </div>
                          </td>
                          {/* Referencia */}
                          <td className="px-3 py-3">
                            <span className="text-[11px] text-slate-400 font-mono">{src.reference}</span>
                          </td>
                          {/* Teléfono */}
                          <td className="px-3 py-3">
                            {src.phone ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-300 whitespace-nowrap">{src.phone}</span>
                                <a href={`tel:${src.phone.replace(/\s/g, '')}`} className="w-5 h-5 rounded-full bg-blue-950/60 flex items-center justify-center text-blue-400 hover:bg-blue-900/60">
                                  <Phone size={10} />
                                </a>
                                <a href={`https://wa.me/${src.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="w-5 h-5 rounded-full bg-emerald-950/60 flex items-center justify-center text-emerald-400 hover:bg-emerald-900/60">
                                  <MessageCircle size={10} />
                                </a>
                                {src.phone_contacts ? (
                                  <span className="text-[10px] text-slate-600">+{src.phone_contacts}</span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-slate-700 text-xs">—</span>
                            )}
                          </td>
                          {/* Precio */}
                          <td className="px-3 py-3 text-right">
                            <span className="text-xs font-bold text-slate-200 whitespace-nowrap">{fmt(src.price)} €</span>
                          </td>
                          {/* Estado */}
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${st.className}`}>
                              {st.label}
                            </span>
                          </td>
                          {/* Dirección */}
                          <td className="px-3 py-3">
                            <span className="text-[11px] text-slate-400 truncate block max-w-[140px]">{src.address}</span>
                          </td>
                          {/* Hab */}
                          <td className="px-3 py-3 text-center text-xs text-slate-400">{src.bedrooms && src.bedrooms > 0 ? src.bedrooms : '—'}</td>
                          {/* Baños */}
                          <td className="px-3 py-3 text-center text-xs text-slate-400">{src.bathrooms ?? '—'}</td>
                          {/* Área */}
                          <td className="px-3 py-3 text-right text-xs text-slate-400 whitespace-nowrap">{src.built_area ? `${src.built_area} m²` : '—'}</td>
                          {/* Particular */}
                          <td className="px-3 py-3 text-center">
                            <span className={`text-[11px] font-medium ${src.is_particular ? 'text-amber-400' : 'text-slate-500'}`}>
                              {src.is_particular ? 'Sí' : 'No'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* HISTÓRICO */}
          {tab === 'historico' && (
            <div className="space-y-4">
              {/* Histórico horizontal (estilo Casafari) */}
              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Histórico de la propiedad</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">Incluir historial en el Smartlink</span>
                    <button
                      onClick={() => setSmartlinkHistory((v) => !v)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${smartlinkHistory ? 'bg-blue-600' : 'bg-[var(--c-border-card)]'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${smartlinkHistory ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-600 uppercase tracking-wide mb-2 px-1">
                  <span>Más reciente</span>
                  <span>Más antiguo</span>
                </div>

                <div className="overflow-x-auto">
                  <div className="relative flex gap-3 pt-5 pb-1 min-w-min">
                    {/* Línea horizontal */}
                    <div className="absolute left-2 right-2 top-[26px] h-px bg-[var(--c-border-card)]" />
                    {[...l.priceHistory].reverse().map((ev, i, arr) => {
                      const cfg = EVENT_CONFIG[ev.event] ?? EVENT_CONFIG.listed
                      const prev = arr[i + 1]
                      const delta = prev ? ev.price - prev.price : 0
                      return (
                        <div key={i} className="relative flex-shrink-0 w-40">
                          {/* Punto sobre la línea */}
                          <div className={`absolute left-1/2 -translate-x-1/2 -top-[2px] w-3 h-3 rounded-full ${cfg.dot} ring-4 ring-[#0d1117]`} />
                          <div className="mt-5 bg-[var(--c-bg-deep)] border border-[var(--c-border)] rounded-xl p-3">
                            <p className="text-[10px] text-slate-600 mb-1.5">
                              {new Date(ev.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            <span className={`inline-block text-[10px] font-semibold ${cfg.color} mb-2`}>{cfg.label}</span>
                            <p className="text-sm font-bold text-slate-200">{fmt(ev.price)} €</p>
                            {delta !== 0 && (
                              <p className={`text-[11px] font-medium mt-0.5 ${delta < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {delta < 0 ? '' : '+'}{fmt(delta)} €
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Price chart */}
              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
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
              <div className="bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-5">Línea de tiempo</h3>
                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--c-border-card)]" />
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
