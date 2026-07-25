'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  Search, X, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight,
  BedDouble, Bath, Ruler, MapPin, Users, ShieldCheck, GitCompareArrows, ExternalLink,
  Home, ImageOff, TrendingDown, CalendarClock, Building2, BadgeCheck, Trophy, Images, Video, Plus, RefreshCw,
  Maximize2, Minimize2, Link2, Unlink, Check, Move, AlertTriangle,
} from 'lucide-react'

const DetailMap = dynamic(() => import('@/components/map/DetailMap'), { ssr: false })

type Listing = {
  listing_id: string
  external_id: string
  advertiser_name: string | null
  crm_platform: string | null
  web_propia_url: string | null
  price: number | null
  currency: string | null
  source_url: string | null
  is_active: boolean
  // El aviso fue movido a mano entre fichas (unión/separación manual, 0078):
  // el dedup automático ya no lo reagrupa por su cuenta.
  manual_property_lock?: boolean
  seller_reference: string | null
  photos: string[]
  description: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  features: string[]
  has_video: boolean
  video_modal_url: string | null
  stored_video: string | null
}
type Property = {
  id: string
  ref_code: string | null
  operation: string | null
  property_type: string | null
  canonical_price: number | null
  canonical_price_uf: string | null
  square_meters: number | null
  price_sqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  comuna_name: string | null
  location_confidence: string
  listing_count: number
  corredora_count: number
  cover_photo: string | null
  days_on_market: number | null
  listings: Listing[]
  manual_latitude: number | null
  manual_longitude: number | null
  // Sello de la última unión/separación manual (0078) — distingue un grupo
  // curado por el equipo de uno propuesto por el score del dedup.
  manual_merge_at: string | null
}
type Stats = { total: number; multi_corredora: number; confirmed: number; median_price: number | null }

type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'corredoras' | 'sqm'
const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Más recientes', price_asc: 'Precio: menor a mayor', price_desc: 'Precio: mayor a menor',
  corredoras: 'Más corredoras (en canje)', sqm: '$/m² menor',
}
const CRM_LABELS: Record<string, string> = { convecta: 'Convecta', ofinet: 'Ofinet', other: 'Otro CRM', unknown: '—' }
const PRIORITY_COMUNAS = ['Las Condes', 'Vitacura', 'Lo Barnechea', 'Providencia', 'Ñuñoa', 'La Reina', 'Colina', 'Peñalolén']
const PAGE_SIZE = 24

const clp = (v: number | null) => v == null ? '—' : v.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
const clpShort = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}MM`
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`
  return clp(v)
}

// Precio TAL COMO LO PUBLICA el portal: en el barrio alto casi todo se publica
// en UF, y mostrar la conversión al peso exacto ($571.827.060) daba una
// precisión falsa con pinta de dato de debug. Se muestra "UF 14.000" (lo que
// realmente dice el aviso) y el equivalente en CLP redondeado como referencia.
const priceMain = (p: Property) =>
  p.canonical_price_uf != null
    ? `UF ${Math.round(Number(p.canonical_price_uf)).toLocaleString('es-CL')}`
    : clp(p.canonical_price)
const priceAlt = (p: Property) =>
  p.canonical_price_uf != null && p.canonical_price ? `≈ ${clpShort(p.canonical_price)}` : null

const CONF: Record<string, { t: string; dot: string; badge: string }> = {
  confirmed: { t: 'Ubicación confirmada', dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  candidate: { t: 'Ubicación probable', dot: 'bg-blue-400', badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  pin_suspect: { t: 'Pin sospechoso', dot: 'bg-rose-400', badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  // "none" = todavía no se triangulό contra el Rol SII — NO significa que no
  // haya coordenadas (el aviso casi siempre trae pin propio, ver DetailMap).
  // "Sin ubicar" confundía al equipo (el mapa de abajo sí muestra pin).
  none: { t: 'Sin confirmar (SII)', dot: 'bg-slate-500', badge: 'bg-slate-600/30 text-slate-400 border-slate-600/40' },
}

// "En mercado": 300 días es difícil de leer de un vistazo — a partir de 30
// días se expresa en meses (igual que el helper `timeSince` de la ficha ES,
// ver app/anuncios/[id]/page.tsx).
function marketTime(days: number | null): string {
  if (days == null) return '—'
  if (days < 30) return `${days} día${days === 1 ? '' : 's'}`
  const months = Math.round(days / 30)
  return `${months} ${months === 1 ? 'mes' : 'meses'}`
}

// Rango de precios entre corredoras (el insight de "en canje").
function priceSpread(p: Property) {
  const prices = p.listings.map(l => l.price).filter((x): x is number => x != null && x > 0)
  if (prices.length === 0) return null
  const min = Math.min(...prices), max = Math.max(...prices)
  return { min, max, spread: max - min, spreadPct: min > 0 ? (max - min) / min : 0, count: prices.length }
}

// ─── Card ───────────────────────────────────────────────────────────────────
// Además de abrir la ficha, la tarjeta es el gesto de MATCHING MANUAL: se
// arrastra una sobre otra para unirlas (o se seleccionan varias con el modo
// "Unir"). El dedup automático nunca acierta el 100%; el equipo mirando las
// fotos sí, y esa decisión pesa más que el score (ver 0078).
type CardHandlers = {
  onOpen: (p: Property) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (p: Property) => void
  dragId: string | null
  isDropTarget: boolean
  onDragStartCard: (id: string) => void
  onDragEndCard: () => void
  onDragOverCard: (id: string | null) => void
  onDropOnCard: (targetId: string) => void
}

function PropertyCardCl({
  p, onOpen, selectMode, selected, onToggleSelect,
  dragId, isDropTarget, onDragStartCard, onDragEndCard, onDragOverCard, onDropOnCard,
}: { p: Property } & CardHandlers) {
  const [imgError, setImgError] = useState(false)
  // Si la portada cambia (re-scrape que trajo otra foto), reintentar la carga:
  // sin esto, un error previo dejaba el placeholder pegado con la foto nueva.
  useEffect(() => { setImgError(false) }, [p.cover_photo])
  const conf = CONF[p.location_confidence] ?? CONF.none
  const sp = priceSpread(p)
  const multi = p.corredora_count > 1
  const isDragging = dragId === p.id
  const canDrop = dragId != null && dragId !== p.id

  const activate = () => (selectMode ? onToggleSelect(p) : onOpen(p))

  return (
    // <div role="button"> en vez de <button>: un <button draggable> no arrastra
    // de forma fiable en todos los navegadores (el botón se queda con el gesto).
    <div
      role="button" tabIndex={0}
      onClick={activate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() } }}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); onDragStartCard(p.id) }}
      onDragEnd={onDragEndCard}
      onDragOver={e => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOverCard(p.id) } }}
      onDragLeave={() => { if (isDropTarget) onDragOverCard(null) }}
      onDrop={e => { if (!canDrop) return; e.preventDefault(); onDropOnCard(p.id) }}
      className={`text-left bg-slate-800/70 border rounded-xl overflow-hidden cursor-pointer transition-all duration-200 group
        ${isDragging ? 'opacity-40 scale-95' : ''}
        ${isDropTarget ? 'border-emerald-400 ring-2 ring-emerald-400/60 shadow-xl shadow-emerald-900/30'
          : selected ? 'border-amber-400 ring-2 ring-amber-400/60'
          : 'border-slate-700 hover:border-amber-500/50 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5'}`}>
      <div className="relative aspect-[4/3] bg-slate-900 overflow-hidden">
        {isDropTarget && (
          <div className="absolute inset-0 z-20 bg-emerald-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center text-emerald-200 pointer-events-none">
            <Link2 size={24} /><span className="text-xs font-semibold mt-1">Soltar para unir</span>
          </div>
        )}
        {selectMode && (
          <span className={`absolute z-10 top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center backdrop-blur-sm
            ${selected ? 'bg-amber-500 border-amber-400 text-white' : 'bg-black/50 border-white/60 text-transparent'}`}>
            <Check size={14} />
          </span>
        )}
        {p.cover_photo && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.cover_photo} alt="" onError={() => setImgError(true)} loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600"><ImageOff size={28} /></div>
        )}
        <div className={`absolute inset-x-0 top-0 p-2 flex items-start justify-between gap-1 ${selectMode ? 'pl-9' : ''}`}>
          <div className="flex flex-col items-start gap-1">
            {multi && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-600/90 text-white backdrop-blur-sm shadow">
                <GitCompareArrows size={10} /> {p.corredora_count} corredoras
              </span>
            )}
            {p.manual_merge_at && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-600/90 text-white backdrop-blur-sm shadow"
                title="Agrupada a mano por el equipo — el dedup automático ya no la reagrupa">
                <Link2 size={10} /> unida a mano
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-black/55 text-slate-200 backdrop-blur-sm" title={conf.t}>
            <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} /> {p.location_confidence === 'confirmed' ? 'Rol SII' : 'sin confirmar'}
          </span>
        </div>
        <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-slate-200 backdrop-blur-sm capitalize">
          {p.operation === 'rent' ? 'Arriendo' : 'Venta'}
        </span>
      </div>
      <div className="p-3">
        {p.ref_code && <div className="text-[10px] font-mono text-amber-400/80 mb-0.5">{p.ref_code}</div>}
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-lg font-bold text-slate-100">{priceMain(p)}</div>
          {p.price_sqm ? <div className="text-[11px] text-slate-500 shrink-0">{clpShort(p.price_sqm)}/m²</div> : null}
        </div>
        {priceAlt(p) && <div className="text-[11px] text-slate-500">{priceAlt(p)}</div>}
        {multi && sp && sp.spread > 0 && (
          <div className="text-[11px] text-amber-400/90 mt-0.5">rango {clpShort(sp.min)}–{clpShort(sp.max)} · {Math.round(sp.spreadPct * 100)}% dif.</div>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
          {p.bedrooms != null && <span className="inline-flex items-center gap-1"><BedDouble size={13} /> {p.bedrooms}</span>}
          {p.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath size={13} /> {p.bathrooms}</span>}
          {p.square_meters != null && <span className="inline-flex items-center gap-1"><Ruler size={13} /> {p.square_meters} m²</span>}
        </div>
        <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-400 truncate">
          <MapPin size={12} className="text-slate-500 shrink-0" /> {p.comuna_name || 'Sin comuna'}
          {p.days_on_market != null && <><span className="text-slate-600">·</span><span className="inline-flex items-center gap-1"><CalendarClock size={11} /> {marketTime(p.days_on_market)}</span></>}
        </div>
      </div>
    </div>
  )
}

// Celda del grid de características de la ficha (estilo bcousinoprop).
function FieldCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-slate-800 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 mb-1">
        <span className="text-slate-500">{icon}</span> {label}
      </div>
      <div className="text-sm font-semibold text-slate-100 truncate">{value}</div>
    </div>
  )
}

// Miniatura del aviso de una corredora (con fallback si no hay foto o falla).
function CorredoraThumb({ src }: { src?: string }) {
  const [err, setErr] = useState(false)
  // Reintentar cuando el aviso trae una miniatura distinta tras re-scrapear.
  useEffect(() => { setErr(false) }, [src])
  return (
    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center text-slate-600">
      {src && !err ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" onError={() => setErr(true)} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <ImageOff size={20} />
      )}
    </div>
  )
}

// ─── Diálogo de unión manual ────────────────────────────────────────────────
// Confirma el match manual antes de tocar la BD y deja elegir QUÉ ficha
// sobrevive (la que conserva su ref_code, su pin corregido y su historial): al
// arrastrar, por defecto gana la de destino; al seleccionar varias, la que más
// avisos tiene — mismo criterio determinista que usa el clustering.
function MergeDialog({ properties, defaultSurvivorId, onCancel, onMerged }: {
  properties: Property[]
  defaultSurvivorId?: string
  onCancel: () => void
  onMerged: (survivorId: string, message: string) => void
}) {
  const fallbackSurvivor = useMemo(() => (
    [...properties].sort((a, b) => (b.listing_count ?? 0) - (a.listing_count ?? 0))[0]?.id
  ), [properties])
  const [survivorId, setSurvivorId] = useState<string>(defaultSurvivorId ?? fallbackSurvivor ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalListings = properties.reduce((n, p) => n + (p.listing_count ?? p.listings.length), 0)
  // Señal de "ojo con esto": unir fichas de comunas distintas casi siempre es
  // un error de selección, no un match real.
  const comunas = new Set(properties.map(p => p.comuna_name).filter(Boolean))
  const operations = new Set(properties.map(p => p.operation))

  const doMerge = useCallback(async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/chile/property-cl/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: properties.map(p => p.id), survivor_id: survivorId }),
      })
      const data = await res.json()
      if (!data.success) { setError(data.error ?? 'No se pudo unir'); return }
      onMerged(data.survivor_id, `${properties.length} fichas unidas en ${data.survivor_ref_code ?? 'una sola'} · ${data.moved_listings} aviso${data.moved_listings === 1 ? '' : 's'} movido${data.moved_listings === 1 ? '' : 's'}`)
    } catch {
      setError('Error de red al unir')
    } finally {
      setSaving(false)
    }
  }, [properties, survivorId, onMerged])

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 className="text-lg font-bold text-slate-100 inline-flex items-center gap-2"><Link2 size={18} className="text-emerald-400" /> Unir en una sola propiedad</h2>
            <p className="text-xs text-slate-400 mt-1">
              {properties.length} fichas · {totalListings} aviso{totalListings === 1 ? '' : 's'} quedarán bajo la ficha que elijas.
              Se puede deshacer después separando el aviso desde la ficha.
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-full bg-slate-700/60 text-slate-300 hover:bg-slate-700"><X size={16} /></button>
        </div>

        {(comunas.size > 1 || operations.size > 1) && (
          <div className="mx-5 mb-3 flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              {comunas.size > 1 && <>Las fichas son de comunas distintas ({[...comunas].join(', ')}). </>}
              {operations.size > 1 && <>Hay venta y arriendo mezclados. </>}
              Revisa que sea de verdad el mismo inmueble.
            </span>
          </div>
        )}

        <div className="px-5 pb-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Ficha que se conserva</div>
          {properties.map(p => {
            const isSurvivor = p.id === survivorId
            return (
              <label key={p.id}
                className={`flex items-center gap-3 rounded-xl p-2.5 border cursor-pointer transition-colors ${isSurvivor ? 'bg-emerald-500/5 border-emerald-500/40' : 'bg-slate-900/50 border-slate-700 hover:border-slate-600'}`}>
                <input type="radio" name="survivor" checked={isSurvivor} onChange={() => setSurvivorId(p.id)}
                  className="w-4 h-4 accent-emerald-500 shrink-0" />
                <CorredoraThumb src={p.cover_photo ?? undefined} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-amber-400/90">{p.ref_code ?? '—'}</span>
                    <span className="text-sm font-semibold text-slate-100">{priceMain(p)}</span>
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-0.5">
                    {p.comuna_name || 'Sin comuna'} · {p.square_meters ?? '—'} m² · {p.bedrooms ?? '—'} dorm.
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {p.listing_count} aviso{p.listing_count === 1 ? '' : 's'} · {p.corredora_count} corredora{p.corredora_count === 1 ? '' : 's'}
                    {isSurvivor && <span className="text-emerald-400"> · conserva ref. y pin</span>}
                  </div>
                </div>
              </label>
            )
          })}
        </div>

        {error && <div className="mx-5 mb-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button onClick={onCancel} className="text-sm px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-700/60">Cancelar</button>
          <button onClick={doMerge} disabled={saving || !survivorId}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50">
            <Link2 size={15} /> {saving ? 'Uniendo…' : `Unir ${properties.length} fichas`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal / ficha interna ──────────────────────────────────────────────────
function PropertyModal({ p, onClose, onRefetched, onSplit }: {
  p: Property; onClose: () => void; onRefetched: (p: Property) => void; onSplit: (message: string) => void
}) {
  const sortedListings = useMemo(() => [...p.listings].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)), [p])
  const cheapest = sortedListings.find(l => l.price != null)?.listing_id
  // Aviso cuya ubicación declarada se muestra/corrige en el mapa de la ficha
  // (el primero de los listings con lat/lng) — su source_url es el que se
  // manda al guardar el pin manual, para poder crear/actualizar la captación.
  const geo = useMemo(() => p.listings.find(l => l.latitude != null && l.longitude != null), [p])

  // Cada corredora trae su propio set de fotos del mismo inmueble — mezclarlas
  // en una sola galería confundía cuál foto era de qué aviso (y de paso hacía
  // "Ver original"/"Re-scrapear" ambiguos sobre cuál aviso actuar). Ahora son
  // fichas clicables por corredora: una pestaña por listing con fotos, cada
  // una con su propia galería.
  const photoListings = useMemo(() => sortedListings.filter(l => (l.photos?.length ?? 0) > 0), [sortedListings])
  const [activeListingId, setActiveListingId] = useState<string | null>(() => photoListings[0]?.listing_id ?? null)
  useEffect(() => {
    setActiveListingId(prev => photoListings.some(l => l.listing_id === prev) ? prev : (photoListings[0]?.listing_id ?? null))
  }, [photoListings])
  const activeListing = photoListings.find(l => l.listing_id === activeListingId) ?? photoListings[0]
  const gallery = useMemo(() => {
    if (activeListing?.photos?.length) return activeListing.photos
    return p.cover_photo ? [p.cover_photo] : []
  }, [activeListing, p.cover_photo])
  const [idx, setIdx] = useState(0)
  // Fotos que fallaron al cargar, rastreadas POR URL. Antes era un único
  // booleano `imgError` que solo se reseteaba al cambiar de corredora
  // (activeListingId). Al "Re-scrapear" la MISMA corredora, el listing_id no
  // cambia, así que el flag quedaba pegado en true y la galería seguía
  // mostrando el placeholder aunque ya hubieran llegado fotos nuevas y válidas
  // ("dice actualizado pero no cargan las fotos"). Con un Set por URL, cada
  // foto nueva se intenta cargar de cero y solo se marca fallida la que de
  // verdad no carga.
  const [failedSrc, setFailedSrc] = useState<Set<string>>(() => new Set())
  const markFailed = useCallback((src: string) => setFailedSrc(prev => {
    const next = new Set(prev); next.add(src); return next
  }), [])
  // Al cambiar de corredora (pestaña), volver a la primera foto.
  useEffect(() => { setIdx(0) }, [activeListingId])
  const conf = CONF[p.location_confidence] ?? CONF.none
  const sp = priceSpread(p)

  // Pin manual (corrección del equipo): "el pin que puse yo" — un segundo pin
  // aparte del declarado por el anuncio, para comparar y corregir a mano
  // cuando el corredor lo puso mal. Se guarda en property_cl.manual_latitude/
  // longitude (0077) vía PATCH /api/chile/property-cl.
  const [manualPin, setManualPin] = useState<{ latitude: number; longitude: number } | null>(
    p.manual_latitude != null && p.manual_longitude != null
      ? { latitude: p.manual_latitude, longitude: p.manual_longitude }
      : null
  )
  const [manualPinDirty, setManualPinDirty] = useState(false)
  const [savingPin, setSavingPin] = useState(false)
  // Feedback del rol SII resuelto bajo el pin + su guardado en captación
  // (best-effort, ver PATCH /api/chile/property-cl). `captacionId` habilita el
  // link a /chile/captacion?id=<id> para abrir esa captación puntual.
  const [captacionMsg, setCaptacionMsg] = useState<{ ok: boolean; text: string; captacionId?: string } | null>(null)
  // Mapa en overlay de pantalla completa ("agrandar") — el recuadro chico de
  // la ficha no alcanza para ubicar bien un pin en una zona densa.
  const [mapExpanded, setMapExpanded] = useState(false)

  const addManualPin = useCallback((baseLat: number, baseLng: number) => {
    // Offset pequeño para que el pin nuevo no quede exactamente encima del
    // declarado (si no, no se ve que hay dos hasta que se arrastra).
    setManualPin({ latitude: baseLat + 0.0004, longitude: baseLng + 0.0004 })
    setManualPinDirty(true)
  }, [])

  const saveManualPin = useCallback(async () => {
    if (!manualPin) return
    setSavingPin(true)
    setCaptacionMsg(null)
    try {
      const res = await fetch('/api/chile/property-cl', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: p.id, latitude: manualPin.latitude, longitude: manualPin.longitude,
          source_url: geo?.source_url ?? undefined,
        }),
      })
      const data = await res.json()
      setManualPinDirty(false)
      if (data.captacion?.sii_rol) {
        setCaptacionMsg({ ok: true, text: `✓ Rol SII ${data.captacion.sii_rol} guardado en Captación`, captacionId: data.captacion.id })
      } else if (data.captacion_error) {
        setCaptacionMsg({ ok: false, text: data.captacion_error })
      }
    } finally {
      setSavingPin(false)
    }
  }, [manualPin, p.id, geo?.source_url])

  const removeManualPin = useCallback(async () => {
    setSavingPin(true)
    try {
      await fetch('/api/chile/property-cl', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, latitude: null, longitude: null }),
      })
      setManualPin(null)
      setManualPinDirty(false)
    } finally {
      setSavingPin(false)
    }
  }, [p.id])
  // Re-scrapea el aviso de la corredora activa (la pestaña seleccionada en la
  // galería) bajo demanda, en vez de esperar el próximo barrido programado de
  // esa comuna, y refresca la propiedad completa para que fotos/precio queden
  // al día en la ficha.
  const [refetching, setRefetching] = useState(false)
  const [refetchMsg, setRefetchMsg] = useState<string | null>(null)
  const doRefetch = useCallback(async () => {
    if (!activeListing || refetching) return
    setRefetching(true)
    setRefetchMsg(null)
    try {
      const res = await fetch('/api/chile/listings-cl/refetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeListing.listing_id }),
      })
      const data = await res.json()
      if (data.success) {
        setRefetchMsg('Aviso actualizado ✓')
        const refreshed = await fetch(`/api/chile/property-cl?id=${encodeURIComponent(p.id)}`).then(r => r.json())
        if (refreshed.success && refreshed.data) onRefetched(refreshed.data)
      } else {
        setRefetchMsg(data.error ?? 'Error al re-scrapear')
      }
    } catch {
      setRefetchMsg('Error al re-scrapear')
    } finally {
      setRefetching(false)
      setTimeout(() => setRefetchMsg(null), 4000)
    }
  }, [activeListing, refetching, p.id, onRefetched])

  // Separar un aviso de este grupo (matching manual inverso, 0078): el aviso no
  // se borra, se muda a una ficha propia y el par queda como "rechazado por un
  // humano" para que el dedup automático no lo vuelva a juntar. Es el "deshacer"
  // tanto de una unión manual como de un agrupamiento del score que estaba mal.
  const [splittingId, setSplittingId] = useState<string | null>(null)
  const [splitError, setSplitError] = useState<string | null>(null)
  const doSplit = useCallback(async (listingId: string) => {
    if (p.listings.length < 2 || splittingId) return
    if (!window.confirm('¿Separar este aviso en una ficha propia? El aviso no se borra: pasa a ser una propiedad aparte y el dedup automático no volverá a unirlos.')) return
    setSplittingId(listingId)
    setSplitError(null)
    try {
      const res = await fetch('/api/chile/property-cl/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: p.id, listing_ids: [listingId] }),
      })
      const data = await res.json()
      if (!data.success) { setSplitError(data.error ?? 'No se pudo separar'); return }
      const refreshed = await fetch(`/api/chile/property-cl?id=${encodeURIComponent(p.id)}`).then(r => r.json())
      if (refreshed.success && refreshed.data) onRefetched(refreshed.data)
      onSplit(`Aviso separado en la ficha ${data.new_ref_code ?? 'nueva'}`)
    } catch {
      setSplitError('Error de red al separar')
    } finally {
      setSplittingId(null)
    }
  }, [p.id, p.listings.length, splittingId, onRefetched, onSplit])

  // Si la galería cambió (re-scrape con más/menos fotos) y el índice quedó fuera
  // de rango, volver a una foto válida en vez de apuntar a un hueco.
  useEffect(() => { setIdx(i => (i < gallery.length ? i : 0)) }, [gallery.length])
  const prev = useCallback(() => setIdx(i => (i - 1 + gallery.length) % gallery.length), [gallery.length])
  const next = useCallback(() => setIdx(i => (i + 1) % gallery.length), [gallery.length])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Con el mapa agrandado, Escape solo lo achica (no cierra toda la ficha) y
      // las flechas no cambian de foto: el foco del usuario está en el mapa.
      if (mapExpanded) {
        if (e.key === 'Escape') setMapExpanded(false)
        return
      }
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    // Bloquea el scroll del fondo mientras el modal está abierto: sin esto, con
    // el backdrop-blur sobre la grilla de imágenes el navegador re-pinta todo el
    // fondo en cada scroll y la página se siente "pegada".
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, prev, next, mapExpanded])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-[fadeIn_.12s_ease-out]" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Galería */}
        <div className="relative aspect-[16/9] bg-slate-900 rounded-t-2xl overflow-hidden">
          {gallery[idx] && !failedSrc.has(gallery[idx]) ? (
            // key={src}: remonta el <img> al cambiar de foto/actualizar la
            // galería, forzando un nuevo intento de carga (onError es por-imagen).
            // eslint-disable-next-line @next/next/no-img-element
            <img key={gallery[idx]} src={gallery[idx]} alt="" onError={() => markFailed(gallery[idx])} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600"><ImageOff size={40} /></div>
          )}
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <button onClick={doRefetch} disabled={refetching || !activeListing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-blue-600/90 text-white hover:bg-blue-600 disabled:opacity-50 backdrop-blur-sm shadow">
              <RefreshCw size={13} className={refetching ? 'animate-spin' : ''} /> {refetching ? 'Re-scrapeando…' : 'Re-scrapear'}
            </button>
            {activeListing?.source_url && (
              <a href={activeListing.source_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm shadow">
                <ExternalLink size={13} /> Ver original
              </a>
            )}
          </div>
          {refetchMsg && (
            <span className="absolute top-12 left-3 text-[11px] px-2 py-1 rounded-full bg-black/70 text-emerald-300 shadow">{refetchMsg}</span>
          )}
          <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"><X size={18} /></button>
          {gallery.length > 1 && (
            <>
              <button onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"><ChevronLeft size={20} /></button>
              <button onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"><ChevronRight size={20} /></button>
              <span className="absolute bottom-2 right-2 text-[11px] px-2 py-0.5 rounded-full bg-black/60 text-white">{idx + 1} / {gallery.length}</span>
            </>
          )}
        </div>
        {/* Fichas por corredora — cada una con su propia galería, sin mezclar fotos */}
        {photoListings.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 pt-2.5 bg-slate-900/40">
            {photoListings.map(l => (
              <button key={l.listing_id} onClick={() => setActiveListingId(l.listing_id)}
                className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full border transition-colors capitalize ${l.listing_id === activeListing?.listing_id ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'}`}>
                {l.advertiser_name || 'Corredora'} · {l.photos.length}
              </button>
            ))}
          </div>
        )}
        {/* Thumbnails */}
        {gallery.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 py-2 bg-slate-900/40">
            {gallery.map((g, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={g} alt="" onClick={() => setIdx(i)} loading="lazy"
                className={`h-12 w-16 object-cover rounded cursor-pointer shrink-0 border-2 transition-colors ${i === idx ? 'border-amber-500' : 'border-transparent opacity-60 hover:opacity-100'}`} />
            ))}
          </div>
        )}

        <div className="p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              {p.ref_code && <div className="text-[11px] font-mono font-semibold text-amber-400 mb-1">{p.ref_code}</div>}
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">{p.operation === 'rent' ? 'Precio arriendo' : 'Precio venta'}</div>
              <div className="text-2xl font-bold text-slate-100">{priceMain(p)}</div>
              <div className="text-xs text-slate-500">
                {[priceAlt(p), p.price_sqm ? `${clpShort(p.price_sqm)}/m²` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border ${conf.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} /> {conf.t}
            </span>
          </div>

          {/* Ficha — grid de características (estilo bcousinoprop) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px mt-4 rounded-xl overflow-hidden bg-slate-700/50 border border-slate-700">
            <FieldCell icon={<Home size={13} />} label="Tipo" value={<span className="capitalize">{p.property_type ?? 'Casa'}</span>} />
            <FieldCell icon={<Building2 size={13} />} label="Operación" value={p.operation === 'rent' ? 'Arriendo' : 'Venta'} />
            <FieldCell icon={<BedDouble size={13} />} label="Dormitorios" value={p.bedrooms != null ? String(p.bedrooms) : '—'} />
            <FieldCell icon={<Bath size={13} />} label="Baños" value={p.bathrooms != null ? String(p.bathrooms) : '—'} />
            <FieldCell icon={<Ruler size={13} />} label="Superficie" value={p.square_meters != null ? `${p.square_meters} m²` : '—'} />
            <FieldCell icon={<TrendingDown size={13} />} label="Precio / m²" value={p.price_sqm ? `${clpShort(p.price_sqm)}/m²` : '—'} />
            <FieldCell icon={<MapPin size={13} />} label="Comuna" value={p.comuna_name || '—'} />
            <FieldCell icon={<CalendarClock size={13} />} label="En mercado" value={marketTime(p.days_on_market)} />
          </div>

          {(() => {
            // "Ficha canónica": tomamos de los avisos el más completo para
            // descripción / dirección / características (todos son el mismo
            // inmueble; distintas corredoras traen textos distintos).
            const withDesc = p.listings.filter(l => l.description)
            const primary = withDesc.sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0] ?? p.listings[0]
            const address = p.listings.map(l => l.address).find(Boolean) ?? null
            const feats = Array.from(new Set(p.listings.flatMap(l => l.features ?? [])))
            return (
              <>
                {/* Ubicación */}
                {(address || geo) && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-300 inline-flex items-center gap-1.5"><MapPin size={15} className="text-amber-400" /> Ubicación</h3>
                      {geo && !manualPin && (
                        <button onClick={() => addManualPin(geo.latitude!, geo.longitude!)}
                          className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">
                          <Plus size={12} /> Agregar pin
                        </button>
                      )}
                      {manualPin && (
                        <div className="flex items-center gap-2">
                          {manualPinDirty && (
                            <button onClick={saveManualPin} disabled={savingPin}
                              className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                              {savingPin ? 'Guardando…' : 'Guardar ubicación'}
                            </button>
                          )}
                          <button onClick={removeManualPin} disabled={savingPin}
                            className="text-xs text-slate-500 hover:text-rose-400 disabled:opacity-50">Quitar</button>
                        </div>
                      )}
                    </div>
                    {captacionMsg && (
                      captacionMsg.captacionId ? (
                        <a href={`/chile/captacion?id=${captacionMsg.captacionId}`} target="_blank" rel="noopener noreferrer"
                          className="text-xs mb-2 block text-emerald-400 hover:text-emerald-300 hover:underline">
                          {captacionMsg.text} →
                        </a>
                      ) : (
                        <div className={`text-xs mb-2 ${captacionMsg.ok ? 'text-emerald-400' : 'text-slate-500'}`}>{captacionMsg.text}</div>
                      )
                    )}
                    {geo && (
                      // Pin SIEMPRE exacto: a diferencia de Idealista (España), que fuzzea
                      // la ubicación a propósito y solo se muestra precisa tras resolver el
                      // Catastro, Portal Inmobiliario (Chile) declara la coordenada real
                      // directamente (confirmado en Fase 0/research). `location_confidence`
                      // mide otra cosa — si ya se triangulό contra el Rol SII (Fase 7,
                      // pendiente) — y no debe gatear si el pin se ve preciso o difuso.
                      //
                      // Satélite (mismo tile de Google sin API key que /chile/catastro) +
                      // segundo pin manual arrastrable: "el pin que puse yo" — corrección
                      // del equipo, aparte del declarado por el anuncio, para comparar.
                      // Botón "agrandar": el recuadro chico no alcanza para ubicar
                      // un pin con precisión en zonas densas. Agrandamos el MISMO
                      // contenedor del ÚNICO mapa (no montamos un segundo DetailMap
                      // en el overlay: ese arrancaba con un tamaño transitorio y
                      // Leaflet lo dibujaba cortado — bug "solo agranda una parte").
                      // Al alternar las clases, el contenedor del mapa que ya está
                      // montado cambia de tamaño y su ResizeObserver interno redibuja
                      // Leaflet al tamaño nuevo, conservando el centro.
                      <div
                        className={mapExpanded
                          ? 'fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4 sm:p-8'
                          : 'relative h-56 rounded-xl overflow-hidden border border-slate-700 mb-2'}
                        onClick={mapExpanded ? () => setMapExpanded(false) : undefined}
                      >
                        <div
                          className={mapExpanded
                            ? 'relative w-full h-full max-w-6xl rounded-2xl overflow-hidden border border-slate-700'
                            : 'relative w-full h-full'}
                          onClick={mapExpanded ? (e) => e.stopPropagation() : undefined}
                        >
                          <DetailMap
                            latitude={geo.latitude!} longitude={geo.longitude!} exact
                            tileStyle="satellite"
                            secondPin={manualPin}
                            onSecondPinDrag={(pos) => { setManualPin(pos); setManualPinDirty(true) }}
                          />
                          <button onClick={(e) => { e.stopPropagation(); setMapExpanded((v) => !v) }}
                            title={mapExpanded ? 'Achicar mapa' : 'Agrandar mapa'}
                            className="absolute top-2 right-2 z-[1000] p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80">
                            {mapExpanded ? <Minimize2 size={16} /> : <Maximize2 size={14} />}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-300">
                      {address && <div>{address}</div>}
                      <div className="text-slate-500 text-xs mt-0.5">{p.comuna_name}{geo ? ` · ${geo.latitude!.toFixed(5)}, ${geo.longitude!.toFixed(5)}` : ''}</div>
                      {manualPin && (
                        <div className="text-emerald-400 text-xs mt-0.5">Pin corregido · {manualPin.latitude.toFixed(5)}, {manualPin.longitude.toFixed(5)}</div>
                      )}
                      {geo && (
                        <a href={`https://www.google.com/maps/search/?api=1&query=${manualPin?.latitude ?? geo.latitude},${manualPin?.longitude ?? geo.longitude}`} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 mt-1.5">Ver en el mapa <ExternalLink size={12} /></a>
                      )}
                    </div>
                  </div>
                )}

                {/* Características */}
                {feats.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">Características ({feats.length})</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {feats.map((f, i) => (
                        <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-slate-700/60 text-slate-300 border border-slate-600/50">{f}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Descripción */}
                {primary?.description && (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">Descripción</h3>
                    <p className="text-sm text-slate-400 whitespace-pre-line leading-relaxed">{primary.description}</p>
                  </div>
                )}
              </>
            )
          })()}

          {/* Avisos por corredora */}
          <div className="mt-5">
            <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-300 inline-flex items-center gap-1.5">
                {p.corredora_count > 1
                  ? <><GitCompareArrows size={15} className="text-amber-400" /> {p.corredora_count} corredoras la publican</>
                  : <><ShieldCheck size={15} className="text-emerald-400" /> Publicada en exclusiva</>}
              </h3>
              {sp && sp.count > 1 && sp.spread > 0 && (
                <span className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-full px-2 py-0.5">
                  rango {clp(sp.min)} – {clp(sp.max)} · {Math.round(sp.spreadPct * 100)}% de diferencia
                </span>
              )}
            </div>
            {p.listings.length > 1 && (
              <p className="text-[11px] text-slate-500 mb-2">
                ¿Alguno no es esta propiedad? Sepáralo con <Unlink size={11} className="inline -mt-0.5" /> y queda como ficha propia.
              </p>
            )}
            {splitError && <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2 mb-2">{splitError}</div>}
            <div className="space-y-2.5">
              {sortedListings.map(l => {
                const isBest = l.listing_id === cheapest && p.corredora_count > 1
                const thumb = l.photos?.[0]
                return (
                  <div key={l.listing_id} className={`flex gap-3 rounded-xl p-2.5 border transition-colors ${isBest ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-slate-900/50 border-slate-700 hover:border-slate-600'}`}>
                    <CorredoraThumb src={thumb} />
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium text-slate-100 truncate capitalize flex items-center gap-2 flex-wrap">
                            {l.advertiser_name || 'Corredora'}
                            {l.crm_platform && l.crm_platform !== 'unknown' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">{CRM_LABELS[l.crm_platform] ?? l.crm_platform}</span>
                            )}
                            {isBest && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"><Trophy size={9} /> mejor precio</span>
                            )}
                            {!l.is_active && <span className="text-[10px] text-slate-500">(baja)</span>}
                          </div>
                          <span className="text-sm font-semibold text-slate-100 shrink-0">{clp(l.price)}</span>
                        </div>
                        <div className="flex items-center gap-2.5 mt-1 text-[11px] text-slate-500">
                          <span className="uppercase tracking-wide">{l.currency || 'CLP'}</span>
                          {p.square_meters != null && <span className="inline-flex items-center gap-1"><Ruler size={11} /> {p.square_meters} m²</span>}
                          {l.photos?.length > 0 && <span className="inline-flex items-center gap-1"><Images size={11} /> {l.photos.length} fotos</span>}
                          {l.has_video && <span className="inline-flex items-center gap-1 text-rose-400"><Video size={11} /> video</span>}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        <span className="text-[11px] text-slate-500 font-mono truncate">{l.external_id}{l.seller_reference && <> · ref. {l.seller_reference}</>}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {p.listings.length > 1 && (
                            <button onClick={() => doSplit(l.listing_id)} disabled={splittingId != null}
                              title="No es la misma propiedad: separar este aviso en una ficha propia"
                              className="text-[11px] text-slate-500 hover:text-rose-400 disabled:opacity-50 inline-flex items-center gap-1">
                              <Unlink size={11} /> {splittingId === l.listing_id ? 'Separando…' : 'Separar'}
                            </button>
                          )}
                          {l.web_propia_url && (
                            <a href={l.web_propia_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-500 hover:text-cyan-400 inline-flex items-center gap-1" title="Web propia de la corredora"><Home size={11} /> web</a>
                          )}
                          {(l.stored_video || l.video_modal_url) && (
                            <a href={l.stored_video || l.video_modal_url || undefined} target="_blank" rel="noopener noreferrer" className="text-[11px] text-rose-400 hover:text-rose-300 inline-flex items-center gap-1" title="Ver video del aviso"><Video size={12} /> video</a>
                          )}
                          {l.source_url && (
                            <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1" title="Ver anuncio original">Ver aviso <ExternalLink size={12} /></a>
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
    </div>
  )
}

// ─── Barra de resumen ───────────────────────────────────────────────────────
function StatTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 bg-slate-800/60 border border-slate-700/70 rounded-xl px-4 py-3">
      <div className={`p-2 rounded-lg ${accent}`}>{icon}</div>
      <div><div className="text-lg font-bold text-slate-100 leading-none">{value}</div><div className="text-[11px] text-slate-500 mt-1">{label}</div></div>
    </div>
  )
}

// ─── Página ─────────────────────────────────────────────────────────────────
export default function PropiedadesChileClient() {
  const [items, setItems] = useState<Property[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [selected, setSelected] = useState<Property | null>(null)

  // ── Matching MANUAL (0078) ────────────────────────────────────────────────
  // Dos gestos para lo mismo: arrastrar una ficha sobre otra, o activar el modo
  // "Unir", marcar varias y unirlas. El dedup automático deja pasar casos que a
  // ojo son obvios; esto los cierra sin esperar al score.
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [mergeDialog, setMergeDialog] = useState<{ properties: Property[]; defaultSurvivorId?: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Fuerza el refetch del listado tras unir/separar (el conteo y las fichas
  // cambian, y la propiedad absorbida ya no existe).
  const [reloadKey, setReloadKey] = useState(0)

  const showToast = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 5000)
  }, [])

  const toggleSelect = useCallback((p: Property) => {
    setSelectedIds(prev => (prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id]))
  }, [])

  const exitMergeMode = useCallback(() => { setMergeMode(false); setSelectedIds([]) }, [])

  const pickProperties = useCallback((ids: string[]) => (
    ids.map(id => items.find(i => i.id === id)).filter((p): p is Property => !!p)
  ), [items])

  // Soltar la ficha arrastrada sobre otra = unirlas. Si venía de una selección
  // múltiple, se arrastra el grupo entero sobre el destino (que además queda
  // propuesto como la ficha que sobrevive).
  const onDropOnCard = useCallback((targetId: string) => {
    const sourceId = dragId
    setDropTargetId(null)
    setDragId(null)
    if (!sourceId || sourceId === targetId) return
    const ids = selectedIds.includes(sourceId)
      ? [...new Set([...selectedIds, targetId])]
      : [sourceId, targetId]
    const properties = pickProperties(ids)
    if (properties.length < 2) return
    setMergeDialog({ properties, defaultSurvivorId: targetId })
  }, [dragId, selectedIds, pickProperties])

  const openMergeFromSelection = useCallback(() => {
    const properties = pickProperties(selectedIds)
    if (properties.length < 2) return
    setMergeDialog({ properties })
  }, [pickProperties, selectedIds])

  const handleMerged = useCallback(async (survivorId: string, message: string) => {
    const mergedIds = mergeDialog?.properties.map(p => p.id) ?? []
    setMergeDialog(null)
    setSelectedIds([])
    setMergeMode(false)
    setReloadKey(k => k + 1)
    showToast(message)
    // Si la ficha abierta participó de la unión, mostrar ya la superviviente
    // (la absorbida dejó de existir).
    if (selected && mergedIds.includes(selected.id)) {
      const refreshed = await fetch(`/api/chile/property-cl?id=${encodeURIComponent(survivorId)}`).then(r => r.json()).catch(() => null)
      setSelected(refreshed?.success ? refreshed.data : null)
    }
  }, [mergeDialog, selected, showToast])

  const handleSplit = useCallback((message: string) => {
    setReloadKey(k => k + 1)
    showToast(message)
  }, [showToast])

  // Estado de filtros — hidratado desde la URL al montar (compartible/persistente).
  const initial = useMemo(() => {
    if (typeof window === 'undefined') return new URLSearchParams()
    return new URLSearchParams(window.location.search)
  }, [])
  const [page, setPage] = useState(Number(initial.get('page')) || 1)
  const [operation, setOperation] = useState(initial.get('op') || 'sale')
  const [comuna, setComuna] = useState(initial.get('comuna') || '')
  const [searchInput, setSearchInput] = useState(initial.get('comuna') || '')
  const [priceMin, setPriceMin] = useState<number | null>(initial.get('pmin') ? Number(initial.get('pmin')) : null)
  const [priceMax, setPriceMax] = useState<number | null>(initial.get('pmax') ? Number(initial.get('pmax')) : null)
  const [sqmMin, setSqmMin] = useState<number | null>(initial.get('sqm') ? Number(initial.get('sqm')) : null)
  const [bedroomsMin, setBedroomsMin] = useState<number | null>(initial.get('dorm') ? Number(initial.get('dorm')) : null)
  const [onlyMulti, setOnlyMulti] = useState(initial.get('canje') === '1')
  const [onlyConfirmed, setOnlyConfirmed] = useState(initial.get('conf') === '1')
  const [sortBy, setSortBy] = useState<SortKey>((initial.get('sort') as SortKey) in SORT_LABELS ? (initial.get('sort') as SortKey) : 'recent')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setComuna(searchInput.trim()); setPage(1) }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  useEffect(() => { setPage(1) }, [operation, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed, sortBy])

  // Sincroniza el estado a la URL sin recargar (history.replaceState). Incluye
  // la ficha abierta (?p=<id>) — URL específica y compartible por propiedad,
  // sin necesitar una ruta [id] aparte (evitaría dos efectos peleando por el
  // pathname: este ya usa query params sobre la MISMA página).
  useEffect(() => {
    const qs = new URLSearchParams()
    if (operation !== 'sale') qs.set('op', operation)
    if (comuna) qs.set('comuna', comuna)
    if (priceMin != null) qs.set('pmin', String(priceMin))
    if (priceMax != null) qs.set('pmax', String(priceMax))
    if (sqmMin != null) qs.set('sqm', String(sqmMin))
    if (bedroomsMin != null) qs.set('dorm', String(bedroomsMin))
    if (onlyMulti) qs.set('canje', '1')
    if (onlyConfirmed) qs.set('conf', '1')
    if (sortBy !== 'recent') qs.set('sort', sortBy)
    if (page > 1) qs.set('page', String(page))
    if (selected) qs.set('p', selected.id)
    const s = qs.toString()
    window.history.replaceState(null, '', s ? `?${s}` : window.location.pathname)
  }, [operation, comuna, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed, sortBy, page, selected])

  // Al montar: si la URL trae ?p=<id> (link compartido/bookmark de una ficha
  // específica), abre esa ficha directo — sin depender de que esté en la
  // página/filtro actual de la grilla (fetch por id, independiente del listado).
  useEffect(() => {
    const id = initial.get('p')
    if (!id) return
    fetch(`/api/chile/property-cl?id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(data => { if (data.success && data.data) setSelected(data.data) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), sort: sortBy })
    if (operation !== 'all') params.append('operation', operation)
    if (comuna) params.append('comuna', comuna)
    if (priceMin != null) params.append('price_min', String(priceMin))
    if (priceMax != null) params.append('price_max', String(priceMax))
    if (sqmMin != null) params.append('sqm_min', String(sqmMin))
    if (bedroomsMin != null) params.append('bedrooms_min', String(bedroomsMin))
    if (onlyMulti) params.append('only_multi_corredora', 'true')
    if (onlyConfirmed) params.append('only_confirmed', 'true')

    fetch(`/api/chile/property-cl?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.data)) { setItems(d.data); setTotal(d.total); setTotalPages(d.total_pages); setStats(d.stats ?? null) }
        else { setItems([]); setTotal(0); setTotalPages(1); setStats(null) }
      })
      .catch(() => { setItems([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [page, sortBy, operation, comuna, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed, reloadKey])

  const activeFilters = (priceMin != null || priceMax != null ? 1 : 0) + (sqmMin != null ? 1 : 0) + (bedroomsMin != null ? 1 : 0) + (onlyMulti ? 1 : 0) + (onlyConfirmed ? 1 : 0)
  const clearAll = () => {
    setPriceMin(null); setPriceMax(null); setSqmMin(null); setBedroomsMin(null); setOnlyMulti(false); setOnlyConfirmed(false)
    setComuna(''); setSearchInput('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 lg:p-6">
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400"><Home size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 leading-none">Propiedades</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              Inmuebles canónicos deduplicados · 1 propiedad = 1 ficha, aunque la publiquen N corredoras
              <span className="text-slate-600"> · </span>
              <span className="inline-flex items-center gap-1 text-slate-400"><Move size={11} /> arrastra una ficha sobre otra para unirlas</span>
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatTile icon={<Home size={16} />} label="Propiedades" value={loading ? '…' : (stats?.total ?? total).toLocaleString('es-CL')} accent="bg-amber-500/15 text-amber-400" />
          <StatTile icon={<GitCompareArrows size={16} />} label="En canje (multi-corredora)" value={loading ? '…' : String(stats?.multi_corredora ?? 0)} accent="bg-purple-500/15 text-purple-400" />
          <StatTile icon={<TrendingDown size={16} />} label="Precio mediano" value={loading ? '…' : clpShort(stats?.median_price ?? null)} accent="bg-blue-500/15 text-blue-400" />
          <StatTile icon={<BadgeCheck size={16} />} label="Ubicación confirmada" value={loading ? '…' : String(stats?.confirmed ?? 0)} accent="bg-emerald-500/15 text-emerald-400" />
        </div>

        {/* Búsqueda + comuna chips */}
        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Buscar por comuna…" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 pl-9 pr-8 py-2 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            {searchInput && <button onClick={() => setSearchInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X size={14} /></button>}
          </div>
          <select value={operation} onChange={e => setOperation(e.target.value)} className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-amber-500">
            <option value="all">Todas</option><option value="sale">Venta</option><option value="rent">Arriendo</option>
          </select>
          <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${activeFilters > 0 ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'}`}>
            <SlidersHorizontal size={14} /> Filtros {activeFilters > 0 && `(${activeFilters})`}
          </button>
          {/* Matching manual: el modo selección. El arrastre funciona siempre,
              con o sin este modo activo. */}
          <button onClick={() => (mergeMode ? exitMergeMode() : setMergeMode(true))}
            title="Marcar varias fichas que son el mismo inmueble y unirlas en una sola"
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${mergeMode ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'}`}>
            <Link2 size={14} /> {mergeMode ? 'Salir de unir' : 'Unir'}
          </button>
          <div className="relative">
            <button onClick={() => setShowSortMenu(!showSortMenu)} className="flex items-center gap-1 text-sm text-slate-300 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg hover:border-slate-600 whitespace-nowrap">
              {SORT_LABELS[sortBy]} <ChevronDown size={13} />
            </button>
            {showSortMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden min-w-[210px]">
                {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                  <button key={k} onClick={() => { setSortBy(k); setShowSortMenu(false) }} className={`block w-full text-left px-3 py-2 text-xs ${sortBy === k ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{SORT_LABELS[k]}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Chips de comuna prioritaria */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PRIORITY_COMUNAS.map(cm => {
            const active = comuna.toLowerCase() === cm.toLowerCase()
            return (
              <button key={cm} onClick={() => { const v = active ? '' : cm; setSearchInput(v); setComuna(v); setPage(1) }}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${active ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'}`}>{cm}</button>
            )
          })}
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4 bg-slate-800/40 border border-slate-700/60 rounded-xl p-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Precio (CLP)</label>
              <div className="flex gap-1">
                <input type="number" placeholder="Min" value={priceMin ?? ''} onChange={e => setPriceMin(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" />
                <input type="number" placeholder="Max" value={priceMax ?? ''} onChange={e => setPriceMax(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" />
              </div>
            </div>
            <div><label className="block text-[11px] font-semibold text-slate-400 mb-1">m² mín.</label>
              <input type="number" placeholder="ej. 80" value={sqmMin ?? ''} onChange={e => setSqmMin(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" /></div>
            <div><label className="block text-[11px] font-semibold text-slate-400 mb-1">Dorm. mín.</label>
              <input type="number" placeholder="ej. 3" value={bedroomsMin ?? ''} onChange={e => setBedroomsMin(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" /></div>
            <div className="flex flex-col justify-center gap-1.5">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={onlyMulti} onChange={e => setOnlyMulti(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" /> Solo en canje</label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={onlyConfirmed} onChange={e => setOnlyConfirmed(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" /> Ubicación confirmada</label>
            </div>
            <div className="flex items-end">
              {activeFilters > 0 && <button onClick={clearAll} className="text-xs text-slate-400 hover:text-amber-400 underline">Limpiar filtros</button>}
            </div>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-slate-700/50" /><div className="p-3 space-y-2"><div className="h-5 bg-slate-700/50 rounded w-1/2" /><div className="h-3 bg-slate-700/50 rounded w-3/4" /></div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-slate-500 py-16">
            <Building2 size={32} className="mx-auto mb-2 opacity-40" />
            Sin propiedades con esos filtros
            {activeFilters > 0 && <div className="mt-2"><button onClick={clearAll} className="text-amber-400 text-sm hover:underline">Limpiar filtros</button></div>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map(p => (
              <PropertyCardCl key={p.id} p={p} onOpen={setSelected}
                selectMode={mergeMode}
                selected={selectedIds.includes(p.id)}
                onToggleSelect={toggleSelect}
                dragId={dragId}
                isDropTarget={dropTargetId === p.id}
                onDragStartCard={setDragId}
                onDragEndCard={() => { setDragId(null); setDropTargetId(null) }}
                onDragOverCard={setDropTargetId}
                onDropOnCard={onDropOnCard} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-6">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-slate-800 border border-slate-700 disabled:opacity-40 hover:border-slate-600"><ChevronLeft size={16} /> Anterior</button>
            <span className="text-xs text-slate-400">{page} / {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-slate-800 border border-slate-700 disabled:opacity-40 hover:border-slate-600">Siguiente <ChevronRight size={16} /></button>
          </div>
        )}
      </div>

      {/* Barra flotante del modo "Unir" — vive fuera del scroll para seguir a
          mano mientras se recorre la grilla buscando la ficha gemela. */}
      {mergeMode && (
        <div className="fixed bottom-4 inset-x-0 z-[90] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-slate-800 border border-emerald-500/40 rounded-full shadow-2xl shadow-black/50 pl-4 pr-2 py-2">
            <span className="text-sm text-slate-200">
              {selectedIds.length === 0
                ? 'Marca las fichas que son el mismo inmueble'
                : `${selectedIds.length} ficha${selectedIds.length === 1 ? '' : 's'} seleccionada${selectedIds.length === 1 ? '' : 's'}`}
            </span>
            {selectedIds.length > 0 && (
              <button onClick={() => setSelectedIds([])} className="text-xs text-slate-400 hover:text-slate-200">Limpiar</button>
            )}
            <button onClick={openMergeFromSelection} disabled={selectedIds.length < 2}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600">
              <Link2 size={14} /> Unir
            </button>
            <button onClick={exitMergeMode} className="p-1.5 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-700"><X size={16} /></button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 inset-x-0 z-[130] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 text-sm bg-emerald-600 text-white px-4 py-2 rounded-full shadow-xl">
            <BadgeCheck size={15} /> {toast}
          </div>
        </div>
      )}

      {mergeDialog && (
        <MergeDialog properties={mergeDialog.properties} defaultSurvivorId={mergeDialog.defaultSurvivorId}
          onCancel={() => setMergeDialog(null)} onMerged={handleMerged} />
      )}

      {selected && <PropertyModal p={selected} onClose={() => setSelected(null)} onRefetched={setSelected} onSplit={handleSplit} />}
    </div>
  )
}
