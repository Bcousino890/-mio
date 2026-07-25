'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Ficha de propiedad canónica chilena (property_cl) — COMPARTIDA.
//
// Vivía dentro de /chile/propiedades. Se extrajo aquí porque la misma ficha se
// abre ahora también desde /chile/anuncios: hacer clic en un aviso llevaba al
// portal original en otra pestaña ("Chile no tiene ficha propia por anuncio"),
// y con el dedup por corredora + código interno (0078) TODO aviso pertenece ya
// a un property_cl — así que la ficha del inmueble es la misma en los dos
// lados, con sus fotos por corredora, su mapa, su pin manual y el desglose de
// quién lo publica.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  X, ChevronLeft, ChevronRight, BedDouble, Bath, Ruler, MapPin, ShieldCheck,
  GitCompareArrows, ExternalLink, Home, ImageOff, TrendingDown, CalendarClock,
  Building2, Trophy, Images, Video, Plus, RefreshCw, Maximize2, Minimize2, Unlink,
} from 'lucide-react'

const DetailMap = dynamic(() => import('@/components/map/DetailMap'), { ssr: false })

export type Listing = {
  listing_id: string
  external_id: string
  advertiser_name: string | null
  crm_platform: string | null
  web_propia_url: string | null
  price: number | null
  currency: string | null
  source_url: string | null
  is_active: boolean
  // El aviso fue movido a mano entre fichas (unión/separación manual, 0079):
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
export type Property = {
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
  // Sello de la última unión/separación manual (0079) — distingue un grupo
  // curado por el equipo de uno propuesto por el score del dedup.
  manual_merge_at: string | null
}

export const CRM_LABELS: Record<string, string> = { convecta: 'Convecta', ofinet: 'Ofinet', other: 'Otro CRM', unknown: '—' }
export const clp = (v: number | null) => v == null ? '—' : v.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
export const clpShort = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}MM`
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`
  return clp(v)
}

// Precio TAL COMO LO PUBLICA el portal: en el barrio alto casi todo se publica
// en UF, y mostrar la conversión al peso exacto ($571.827.060) daba una
// precisión falsa con pinta de dato de debug. Se muestra "UF 14.000" (lo que
// realmente dice el aviso) y el equivalente en CLP redondeado como referencia.
export const priceMain = (p: Property) =>
  p.canonical_price_uf != null
    ? `UF ${Math.round(Number(p.canonical_price_uf)).toLocaleString('es-CL')}`
    : clp(p.canonical_price)
export const priceAlt = (p: Property) =>
  p.canonical_price_uf != null && p.canonical_price ? `≈ ${clpShort(p.canonical_price)}` : null

export const CONF: Record<string, { t: string; dot: string; badge: string }> = {
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
export function marketTime(days: number | null): string {
  if (days == null) return '—'
  if (days < 30) return `${days} día${days === 1 ? '' : 's'}`
  const months = Math.round(days / 30)
  return `${months} ${months === 1 ? 'mes' : 'meses'}`
}

// Rango de precios entre corredoras (el insight de "en canje").
export function priceSpread(p: Property) {
  const prices = p.listings.map(l => l.price).filter((x): x is number => x != null && x > 0)
  if (prices.length === 0) return null
  const min = Math.min(...prices), max = Math.max(...prices)
  return { min, max, spread: max - min, spreadPct: min > 0 ? (max - min) / min : 0, count: prices.length }
}


// Celda del grid de características de la ficha (estilo bcousinoprop).
export function FieldCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
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
export function CorredoraThumb({ src }: { src?: string }) {
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

// ─── Modal / ficha interna ──────────────────────────────────────────────────
export default function PropertyModal({ p, onClose, onRefetched, onSplit }: {
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

  // Separar un aviso de este grupo (matching manual inverso, 0079): el aviso no
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
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-[fadeIn_.12s_ease-out]" onClick={onClose}>
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
                          ? 'fixed inset-0 z-[1300] bg-black/85 flex items-center justify-center p-4 sm:p-8'
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
                            className="absolute top-2 right-2 z-[1400] p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80">
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

