'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  Search, X, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight,
  BedDouble, Bath, Ruler, MapPin, Users, ShieldCheck, GitCompareArrows, ExternalLink,
  Home, ImageOff, TrendingDown, CalendarClock, Building2, BadgeCheck, Trophy, Images, Video, Plus, RefreshCw,
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
function PropertyCardCl({ p, onOpen }: { p: Property; onOpen: (p: Property) => void }) {
  const [imgError, setImgError] = useState(false)
  const conf = CONF[p.location_confidence] ?? CONF.none
  const sp = priceSpread(p)
  const multi = p.corredora_count > 1
  return (
    <button onClick={() => onOpen(p)}
      className="text-left bg-slate-800/70 border border-slate-700 rounded-xl overflow-hidden hover:border-amber-500/50 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5 transition-all duration-200 group">
      <div className="relative aspect-[4/3] bg-slate-900 overflow-hidden">
        {p.cover_photo && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.cover_photo} alt="" onError={() => setImgError(true)} loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600"><ImageOff size={28} /></div>
        )}
        <div className="absolute inset-x-0 top-0 p-2 flex items-start justify-between">
          {multi ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-600/90 text-white backdrop-blur-sm shadow">
              <GitCompareArrows size={10} /> {p.corredora_count} corredoras
            </span>
          ) : <span />}
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
          <div className="text-lg font-bold text-slate-100">{clp(p.canonical_price)}</div>
          {p.price_sqm ? <div className="text-[11px] text-slate-500 shrink-0">{clpShort(p.price_sqm)}/m²</div> : null}
        </div>
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
    </button>
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
  return (
    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center text-slate-600">
      {src && !err ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setErr(true)} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <ImageOff size={20} />
      )}
    </div>
  )
}

// ─── Modal / ficha interna ──────────────────────────────────────────────────
function PropertyModal({ p, onClose, onRefetched }: { p: Property; onClose: () => void; onRefetched: (p: Property) => void }) {
  const gallery = useMemo(() => {
    const all = [p.cover_photo, ...p.listings.flatMap(l => l.photos || [])].filter((x): x is string => !!x)
    return Array.from(new Set(all))
  }, [p])
  const [idx, setIdx] = useState(0)
  const [imgError, setImgError] = useState(false)
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

  const addManualPin = useCallback((baseLat: number, baseLng: number) => {
    // Offset pequeño para que el pin nuevo no quede exactamente encima del
    // declarado (si no, no se ve que hay dos hasta que se arrastra).
    setManualPin({ latitude: baseLat + 0.0004, longitude: baseLng + 0.0004 })
    setManualPinDirty(true)
  }, [])

  const saveManualPin = useCallback(async () => {
    if (!manualPin) return
    setSavingPin(true)
    try {
      await fetch('/api/chile/property-cl', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, latitude: manualPin.latitude, longitude: manualPin.longitude }),
      })
      setManualPinDirty(false)
    } finally {
      setSavingPin(false)
    }
  }, [manualPin, p.id])

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
  const sortedListings = useMemo(() => [...p.listings].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)), [p])
  const cheapest = sortedListings.find(l => l.price != null)?.listing_id
  const primaryListing = sortedListings[0] as Listing | undefined

  // Re-scrapea el aviso "principal" de la ficha bajo demanda (en vez de
  // esperar el próximo barrido programado de esa comuna) y refresca la
  // propiedad completa para que fotos/precio queden al día en la ficha.
  const [refetching, setRefetching] = useState(false)
  const [refetchMsg, setRefetchMsg] = useState<string | null>(null)
  const doRefetch = useCallback(async () => {
    if (!primaryListing || refetching) return
    setRefetching(true)
    setRefetchMsg(null)
    try {
      const res = await fetch('/api/chile/listings-cl/refetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: primaryListing.listing_id }),
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
  }, [primaryListing, refetching, p.id, onRefetched])

  const prev = useCallback(() => { setImgError(false); setIdx(i => (i - 1 + gallery.length) % gallery.length) }, [gallery.length])
  const next = useCallback(() => { setImgError(false); setIdx(i => (i + 1) % gallery.length) }, [gallery.length])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [onClose, prev, next])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-[fadeIn_.12s_ease-out]" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Galería */}
        <div className="relative aspect-[16/9] bg-slate-900 rounded-t-2xl overflow-hidden">
          {gallery.length > 0 && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gallery[idx]} alt="" onError={() => setImgError(true)} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600"><ImageOff size={40} /></div>
          )}
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <button onClick={doRefetch} disabled={refetching || !primaryListing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-blue-600/90 text-white hover:bg-blue-600 disabled:opacity-50 backdrop-blur-sm shadow">
              <RefreshCw size={13} className={refetching ? 'animate-spin' : ''} /> {refetching ? 'Re-scrapeando…' : 'Re-scrapear'}
            </button>
            {primaryListing?.source_url && (
              <a href={primaryListing.source_url} target="_blank" rel="noopener noreferrer"
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
        {/* Thumbnails */}
        {gallery.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 py-2 bg-slate-900/40">
            {gallery.map((g, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={g} alt="" onClick={() => { setImgError(false); setIdx(i) }} loading="lazy"
                className={`h-12 w-16 object-cover rounded cursor-pointer shrink-0 border-2 transition-colors ${i === idx ? 'border-amber-500' : 'border-transparent opacity-60 hover:opacity-100'}`} />
            ))}
          </div>
        )}

        <div className="p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              {p.ref_code && <div className="text-[11px] font-mono font-semibold text-amber-400 mb-1">{p.ref_code}</div>}
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">{p.operation === 'rent' ? 'Precio arriendo' : 'Precio venta'}</div>
              <div className="text-2xl font-bold text-slate-100">{clp(p.canonical_price)}</div>
              {p.canonical_price_uf && <div className="text-xs text-slate-500">≈ {Number(p.canonical_price_uf).toLocaleString('es-CL')} UF{p.price_sqm ? ` · ${clp(p.price_sqm)}/m²` : ''}</div>}
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
            const geo = p.listings.find(l => l.latitude != null && l.longitude != null)
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
                      <div className="h-56 rounded-xl overflow-hidden border border-slate-700 mb-2">
                        <DetailMap
                          latitude={geo.latitude!} longitude={geo.longitude!} exact
                          tileStyle="satellite"
                          secondPin={manualPin}
                          onSecondPinDrag={(pos) => { setManualPin(pos); setManualPinDirty(true) }}
                        />
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
  }, [page, sortBy, operation, comuna, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed])

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
            <p className="text-[11px] text-slate-500 mt-1">Inmuebles canónicos deduplicados · 1 propiedad = 1 ficha, aunque la publiquen N corredoras</p>
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
            {items.map(p => <PropertyCardCl key={p.id} p={p} onOpen={setSelected} />)}
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

      {selected && <PropertyModal p={selected} onClose={() => setSelected(null)} onRefetched={setSelected} />}
    </div>
  )
}
