'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  Search, X, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight,
  BedDouble, Bath, Ruler, MapPin, Users, ShieldCheck, GitCompareArrows, ExternalLink,
  Home, ImageOff, TrendingDown, CalendarClock, Building2, BadgeCheck, Trophy, Images, Video, Plus, RefreshCw,
  Maximize2, Minimize2, Link2, Unlink, Check, Move, AlertTriangle, Layers, Wand2, Hash, Map as MapIcon, LayoutList,
} from 'lucide-react'

// La ficha (modal) y sus tipos/helpers viven en un módulo compartido: la misma
// ficha se abre desde /chile/anuncios.
import PropertyModal, {
  type Property, type Listing, CONF, clp, clpShort, priceMain, priceAlt,
  marketTime, priceSpread, CorredoraThumb,
} from '@/components/chile/PropertyClModal'
// Tipo "Listing" de PropertyMap — homónimo pero distinto del `Listing` de
// arriba (ese es el desglose de avisos DENTRO de una Property; este es el
// shape plano que espera el mapa). Se alias para que convivan sin chocar.
import type { Listing as MapListing } from '@/lib/types'
import type { GeoShapeFilter } from '@/components/filters/FilterPanel'
import { useUfRateCl } from '@/hooks/useUfRateCl'

// Mismo mapa Leaflet + dibujo (polígono/rectángulo/círculo) que ya usan
// /anuncios (España) y /chile/anuncios — buscar "dentro de una zona dibujada"
// es la misma necesidad en las tres listas.
const PropertyMap = dynamic(() => import('@/components/map/PropertyMap'), { ssr: false })

type Stats = {
  total: number; multi_corredora: number; confirmed: number; median_price: number | null
  captadas?: number; smart?: number
}

type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'corredoras' | 'sqm'
const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Más recientes', price_asc: 'Precio: menor a mayor', price_desc: 'Precio: mayor a menor',
  corredoras: 'Más corredoras (en canje)', sqm: '$/m² menor',
}
const PRIORITY_COMUNAS = ['Las Condes', 'Vitacura', 'Lo Barnechea', 'Providencia', 'Ñuñoa', 'La Reina', 'Colina', 'Peñalolén']
const PAGE_SIZE = 24
const SANTIAGO_CENTER: [number, number] = [-33.4489, -70.6693]

// Adapta la propiedad canónica al shape plano que espera PropertyMap (el
// mismo componente de mapa+dibujo que ya usan /anuncios y /chile/anuncios) —
// solo para el pin y el popup del mapa, no reemplaza a PropertyCardCl.
function propertyToListing(p: Property): MapListing {
  const price = p.canonical_price ?? 0
  const listedDate = new Date().toISOString().split('T')[0]
  return {
    id: p.id,
    property_id: p.ref_code ?? p.id,
    title: `${p.bedrooms ?? '?'} dorm · ${p.square_meters ?? '?'} m² · ${p.comuna_name ?? 'Chile'}`,
    operation: p.operation === 'rent' ? 'rent' : 'sale',
    price,
    currency: 'CLP',
    price_uf: p.canonical_price_uf != null ? Number(p.canonical_price_uf) : null,
    square_meters: p.square_meters ?? 0,
    price_sqm: p.price_sqm ?? 0,
    bedrooms: p.bedrooms ?? 0,
    bathrooms: p.bathrooms ?? 0,
    zone_name: p.comuna_name || 'Sin comuna',
    portal: 'portalinmobiliario',
    source_type: 'portal',
    advertiser_type: 'professional',
    advertiser_name: 'Portal Inmobiliario',
    days_on_market: p.days_on_market ?? 0,
    is_active: true,
    // El pin manual (corregido a mano) manda sobre el declarado por el aviso.
    latitude: p.manual_latitude ?? p.latitude ?? SANTIAGO_CENTER[0],
    longitude: p.manual_longitude ?? p.longitude ?? SANTIAGO_CENTER[1],
    photos: p.cover_photo ? [p.cover_photo] : [],
    source_url: '',
    listing_count: p.listing_count,
    portals: [],
    price_drops: 0,
    rc_status: 'none',
    priceHistory: [{ date: listedDate, price, event: 'listed' as const }],
    sources: [],
  }
}

// ─── Card ───────────────────────────────────────────────────────────────────
// Además de abrir la ficha, la tarjeta es el gesto de MATCHING MANUAL: se
// arrastra una sobre otra para unirlas (o se seleccionan varias con el modo
// "Unir"). El dedup automático nunca acierta el 100%; el equipo mirando las
// fotos sí, y esa decisión pesa más que el score (ver 0079).
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
  // Misma definición que el filtro y el contador del API: el enlace guardado.
  const captada = Boolean(p.captacion_id)
  const phoneCount = p.crm?.phones?.length ?? 0
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
            {/* Estado de captación — el trabajo ya hecho sobre el inmueble tiene
                que verse SIN abrir la ficha: si no, no hay forma de saber qué
                queda por trabajar y se repite el mismo inmueble. */}
            {captada && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/90 text-white backdrop-blur-sm shadow"
                title={phoneCount > 0
                  ? `Captada · ${phoneCount} teléfono${phoneCount === 1 ? '' : 's'} del dueño`
                  : 'Captada — dueño/teléfonos pendientes'}>
                <BadgeCheck size={10} /> {phoneCount > 0 ? `captada · ${phoneCount} tel.` : 'captada'}
              </span>
            )}
            {p.smart_crm_at && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-600/90 text-white backdrop-blur-sm shadow"
                title="Ya subida al CRM externo (Smart)">
                <Trophy size={10} /> en Smart
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
    <div className="fixed inset-0 z-[1250] flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm" onClick={onCancel}>
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
export default function PropiedadesChileClient({ initialParams = {} }: { initialParams?: Record<string, string> }) {
  const [items, setItems] = useState<Property[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [selected, setSelected] = useState<Property | null>(null)

  // ── Matching MANUAL (0079) ────────────────────────────────────────────────
  // Dos gestos para lo mismo: arrastrar una ficha sobre otra, o activar el modo
  // "Unir", marcar varias y unirlas. El dedup automático deja pasar casos que a
  // ojo son obvios; esto los cierra sin esperar al score.
  const [mergeMode, setMergeMode] = useState(false)
  // Se guarda la FICHA completa, no solo el id: la selección sobrevive al
  // cambio de página y al refresco del listado. Antes se guardaban ids y se
  // resolvían contra `items` (SOLO la página visible), así que al marcar fichas
  // en páginas distintas el botón "Unir" no hacía nada — las de las otras
  // páginas se perdían y no llegaba al mínimo de 2.
  const [selectedById, setSelectedById] = useState<Map<string, Property>>(() => new Map())
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [mergeDialog, setMergeDialog] = useState<{ properties: Property[]; defaultSurvivorId?: string } | null>(null)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  // Fuerza el refetch del listado tras unir/separar (el conteo y las fichas
  // cambian, y la propiedad absorbida ya no existe).
  const [reloadKey, setReloadKey] = useState(0)

  const showToast = useCallback((text: string, ok = true) => {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 5000)
  }, [])

  const selectedIds = useMemo(() => [...selectedById.keys()], [selectedById])

  const toggleSelect = useCallback((p: Property) => {
    setSelectedById(prev => {
      const next = new Map(prev)
      if (next.has(p.id)) next.delete(p.id)
      else next.set(p.id, p)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedById(new Map()), [])
  const exitMergeMode = useCallback(() => { setMergeMode(false); clearSelection() }, [clearSelection])

  // Soltar la ficha arrastrada sobre otra = unirlas. Si venía de una selección
  // múltiple, se arrastra el grupo entero sobre el destino (que además queda
  // propuesto como la ficha que sobrevive).
  const onDropOnCard = useCallback((targetId: string) => {
    const sourceId = dragId
    setDropTargetId(null)
    setDragId(null)
    if (!sourceId || sourceId === targetId) return
    const target = items.find(i => i.id === targetId)
    if (!target) return
    // Arrastrar una ficha marcada arrastra TODO el grupo seleccionado sobre el
    // destino; si no estaba marcada, es la unión simple de esas dos.
    const group = selectedById.has(sourceId)
      ? [...selectedById.values()]
      : [selectedById.get(sourceId) ?? items.find(i => i.id === sourceId)].filter((p): p is Property => !!p)
    const properties = [...new Map([...group, target].map(p => [p.id, p])).values()]
    if (properties.length < 2) return
    setMergeDialog({ properties, defaultSurvivorId: targetId })
  }, [dragId, selectedById, items])

  const openMergeFromSelection = useCallback(() => {
    const properties = [...selectedById.values()]
    // Nunca fallar en silencio: si el botón se pudo pulsar y aun así no hay
    // material para unir, decirlo.
    if (properties.length < 2) {
      showToast('Marca al menos 2 fichas para unirlas', false)
      return
    }
    setMergeDialog({ properties })
  }, [selectedById, showToast])

  const handleMerged = useCallback(async (survivorId: string, message: string) => {
    const mergedIds = mergeDialog?.properties.map(p => p.id) ?? []
    setMergeDialog(null)
    clearSelection()
    setMergeMode(false)
    setReloadKey(k => k + 1)
    showToast(message)
    // Si la ficha abierta participó de la unión, mostrar ya la superviviente
    // (la absorbida dejó de existir).
    if (selected && mergedIds.includes(selected.id)) {
      const refreshed = await fetch(`/api/chile/property-cl?id=${encodeURIComponent(survivorId)}`).then(r => r.json()).catch(() => null)
      setSelected(refreshed?.success ? refreshed.data : null)
    }
  }, [mergeDialog, selected, showToast, clearSelection])

  // La ficha abierta cambió (pin guardado, captación creada, marca de Smart):
  // hay que reflejarlo TAMBIÉN en la tarjeta de la grilla. Sin esto el modal se
  // actualizaba solo por dentro y, al cerrarlo, la lista seguía mostrando el
  // estado viejo — y al reabrir la ficha desde esa tarjeta el botón volvía a
  // "Agregar a Smart", que es lo que se leía como "no se guarda".
  //
  // Se copian solo los campos de ESTADO del inmueble: en la vista sin agrupar
  // una fila es un anuncio, y volcar la ficha entera le pisaría su precio,
  // foto y recuentos propios.
  const handlePropertyChange = useCallback((next: Property) => {
    setSelected(next)
    setItems(prev => prev.map(it => it.id === next.id ? {
      ...it,
      smart_crm_at: next.smart_crm_at,
      crm: next.crm,
      captacion_id: next.captacion_id,
      manual_latitude: next.manual_latitude,
      manual_longitude: next.manual_longitude,
      location_confidence: next.location_confidence,
      rol_matriz: next.rol_matriz,
      exact_address: next.exact_address,
    } : it))
  }, [])

  const handleSplit = useCallback((message: string) => {
    setReloadKey(k => k + 1)
    showToast(message)
  }, [showToast])

  // Estado de filtros — sembrado con la query que ya leyó el servidor
  // (compartible/persistente). Viene por props a propósito: leer
  // `window.location.search` aquí hacía que el servidor pintara la página sin
  // filtros y el navegador con ellos, y eso es un error de hidratación en cada
  // carga de un enlace con filtros (ver page.tsx).
  const initial = useMemo(() => new URLSearchParams(initialParams), [initialParams])
  const [page, setPage] = useState(Number(initial.get('page')) || 1)
  const [operation, setOperation] = useState(initial.get('op') || 'sale')
  const [comuna, setComuna] = useState(initial.get('comuna') || '')
  const [searchInput, setSearchInput] = useState(initial.get('comuna') || '')
  // Buscador por código o URL. Acepta todas las formas en que se nombra un
  // inmueble —URL pegada del navegador con slug, número del anuncio suelto
  // ("2107783039"), "MLC-2107783039", código interno del CRM ("PI-2607-21087")
  // o el de la corredora—; quien las distingue es lib/property-code-query.ts.
  const [codeQuery, setCodeQuery] = useState(initial.get('q') || '')
  const [codeInput, setCodeInput] = useState(initial.get('q') || '')
  const [priceMin, setPriceMin] = useState<number | null>(initial.get('pmin') ? Number(initial.get('pmin')) : null)
  const [priceMax, setPriceMax] = useState<number | null>(initial.get('pmax') ? Number(initial.get('pmax')) : null)
  const [sqmMin, setSqmMin] = useState<number | null>(initial.get('sqm') ? Number(initial.get('sqm')) : null)
  const [bedroomsMin, setBedroomsMin] = useState<number | null>(initial.get('dorm') ? Number(initial.get('dorm')) : null)
  const [onlyMulti, setOnlyMulti] = useState(initial.get('canje') === '1')
  const [onlyConfirmed, setOnlyConfirmed] = useState(initial.get('conf') === '1')
  // Estado de captación: "lo que ya trabajé" vs "lo que falta".
  const [onlyCaptadas, setOnlyCaptadas] = useState(initial.get('captada') === '1')
  const [onlySmart, setOnlySmart] = useState(initial.get('smart') === '1')
  // Agrupar = 1 ficha por INMUEBLE (junta venta+arriendo de la misma corredora
  // con el mismo código interno). APAGADO por defecto: la lista enseña un
  // anuncio = una ficha, para que el recuento cuadre con el del portal.
  const [grouped, setGrouped] = useState(initial.get('agrupar') === '1')
  const [dedupRunning, setDedupRunning] = useState(false)

  // Lanza la deduplicación (corredora + código interno) sin esperar al ciclo de
  // 15 min del worker. Útil justo después de un barrido, cuando hay anuncios
  // nuevos aún sin ficha asignada.
  const runDedup = useCallback(async () => {
    setDedupRunning(true)
    try {
      const r = await fetch('/api/chile/dedup-cl', { method: 'POST' }).then(x => x.json())
      setToast({ text: r.message ?? (r.success ? 'Deduplicación lanzada' : 'Error'), ok: !!r.success })
      // Se recarga a los 20s: el job tarda un poco en pasar por la cola.
      setTimeout(() => setReloadKey(k => k + 1), 20000)
    } catch {
      setToast({ text: 'No se pudo lanzar la deduplicación', ok: false })
    } finally {
      setDedupRunning(false)
    }
  }, [])
  const [sortBy, setSortBy] = useState<SortKey>((initial.get('sort') as SortKey) in SORT_LABELS ? (initial.get('sort') as SortKey) : 'recent')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  // Mapa con dibujo (polígono/rectángulo/círculo) para buscar dentro de una
  // zona a medida — apagado por defecto, no reemplaza a la grilla. La forma
  // dibujada NO se persiste en la URL (a diferencia del resto de filtros):
  // un polígono de muchos puntos volvería la URL enorme y poco compartible.
  const [showMap, setShowMap] = useState(false)
  const [geoShape, setGeoShape] = useState<GeoShapeFilter | null>(null)
  // Filtro de precio en CLP o UF. Por dentro el precio SIEMPRE viaja en CLP
  // (priceMin/priceMax) — este toggle solo cambia en qué unidad se leen/
  // escriben esos inputs, convirtiendo con la tasa del día.
  const [priceUnit, setPriceUnit] = useState<'clp' | 'uf'>('clp')
  const { rate: ufRate, date: ufRateDate } = useUfRateCl()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setComuna(searchInput.trim()); setPage(1) }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  // Espera más que el buscador de comuna (350 ms) a propósito: un código de 10
  // dígitos que no esté en la base sale a buscarse EN VIVO al portal, y con una
  // espera corta cada estado intermedio de lo que se está tecleando dispararía
  // una descarga condenada a fallar.
  const codeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current)
    codeDebounceRef.current = setTimeout(() => { setCodeQuery(codeInput.trim()); setPage(1) }, 600)
    return () => { if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current) }
  }, [codeInput])

  useEffect(() => { setPage(1) }, [operation, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed, onlyCaptadas, onlySmart, sortBy, grouped, geoShape])

  // Sincroniza el estado a la URL sin recargar (history.replaceState). Incluye
  // la ficha abierta (?p=<id>) — URL específica y compartible por propiedad,
  // sin necesitar una ruta [id] aparte (evitaría dos efectos peleando por el
  // pathname: este ya usa query params sobre la MISMA página).
  useEffect(() => {
    const qs = new URLSearchParams()
    if (operation !== 'sale') qs.set('op', operation)
    if (comuna) qs.set('comuna', comuna)
    if (codeQuery) qs.set('q', codeQuery)
    if (priceMin != null) qs.set('pmin', String(priceMin))
    if (priceMax != null) qs.set('pmax', String(priceMax))
    if (sqmMin != null) qs.set('sqm', String(sqmMin))
    if (bedroomsMin != null) qs.set('dorm', String(bedroomsMin))
    if (onlyMulti) qs.set('canje', '1')
    if (onlyConfirmed) qs.set('conf', '1')
    if (onlyCaptadas) qs.set('captada', '1')
    if (onlySmart) qs.set('smart', '1')
    if (grouped) qs.set('agrupar', '1')
    if (sortBy !== 'recent') qs.set('sort', sortBy)
    if (page > 1) qs.set('page', String(page))
    if (selected) qs.set('p', selected.id)
    const s = qs.toString()
    window.history.replaceState(null, '', s ? `?${s}` : window.location.pathname)
  }, [operation, comuna, codeQuery, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed, onlyCaptadas, onlySmart, grouped, sortBy, page, selected])

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

  // Mismos filtros para dos consumidores (la grilla paginada y el mapa, que
  // pide un lote propio más grande — ver más abajo): centralizado para que no
  // se desincronicen si un filtro nuevo se agrega en un solo lugar.
  const buildFilterParams = useCallback((pageArg: number, pageSizeArg: number) => {
    const params = new URLSearchParams({ page: String(pageArg), page_size: String(pageSizeArg), sort: sortBy })
    if (operation !== 'all') params.append('operation', operation)
    if (comuna) params.append('comuna', comuna)
    if (codeQuery) params.append('q', codeQuery)
    if (priceMin != null) params.append('price_min', String(priceMin))
    if (priceMax != null) params.append('price_max', String(priceMax))
    if (sqmMin != null) params.append('sqm_min', String(sqmMin))
    if (bedroomsMin != null) params.append('bedrooms_min', String(bedroomsMin))
    if (onlyMulti) params.append('only_multi_corredora', 'true')
    if (onlyConfirmed) params.append('only_confirmed', 'true')
    if (onlyCaptadas) params.append('only_captadas', 'true')
    if (onlySmart) params.append('only_smart', 'true')
    if (grouped) params.append('grouped', '1')
    if (geoShape) {
      if (geoShape.type === 'circle' && geoShape.center && geoShape.radius != null) {
        params.append('geo_circle', `${geoShape.center[0]},${geoShape.center[1]},${geoShape.radius}`)
      } else if (geoShape.coordinates) {
        params.append('geo_polygon', JSON.stringify(geoShape.coordinates))
      }
    }
    return params
  }, [sortBy, operation, comuna, codeQuery, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed, onlyCaptadas, onlySmart, grouped, geoShape])

  useEffect(() => {
    setLoading(true)
    const params = buildFilterParams(page, PAGE_SIZE)

    fetch(`/api/chile/property-cl?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.data)) {
          setItems(d.data); setTotal(d.total); setTotalPages(d.total_pages); setStats(d.stats ?? null)
          // No estaba en la base: se trajo en vivo del sitio de origen —
          // Portal Inmobiliario o la web propia de la corredora, según la URL
          // (ver /api/chile/property-cl, bloque `q` sin resultados).
          if (d.scraped) showToast('Propiedad no encontrada en la base — se trajo en vivo desde su sitio')
          else if (d.scrape_error) showToast(`No se pudo traer la propiedad: ${d.scrape_error}`, false)
        }
        else { setItems([]); setTotal(0); setTotalPages(1); setStats(null) }
      })
      .catch(() => { setItems([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [page, buildFilterParams, reloadKey])

  // Mapa: pide un lote propio (tope del backend, 200) independiente de la
  // página de la grilla — si no, dibujar una zona con más de 24 resultados
  // (PAGE_SIZE) solo mostraba la primera página de pines en el mapa aunque la
  // grilla de abajo sí paginara sobre el total real.
  const [mapItems, setMapItems] = useState<Property[]>([])
  const [mapTotal, setMapTotal] = useState(0)
  const [mapLoading, setMapLoading] = useState(false)
  const MAP_PAGE_SIZE = 200

  useEffect(() => {
    if (!showMap) return
    setMapLoading(true)
    const params = buildFilterParams(1, MAP_PAGE_SIZE)
    fetch(`/api/chile/property-cl?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.data)) { setMapItems(d.data); setMapTotal(d.total) }
        else { setMapItems([]); setMapTotal(0) }
      })
      .catch(() => { setMapItems([]); setMapTotal(0) })
      .finally(() => setMapLoading(false))
  }, [showMap, buildFilterParams, reloadKey])

  const activeFilters = (priceMin != null || priceMax != null ? 1 : 0) + (sqmMin != null ? 1 : 0) + (bedroomsMin != null ? 1 : 0) + (onlyMulti ? 1 : 0) + (onlyConfirmed ? 1 : 0) + (onlyCaptadas ? 1 : 0) + (onlySmart ? 1 : 0) + (geoShape ? 1 : 0)
  const clearAll = () => {
    setPriceMin(null); setPriceMax(null); setSqmMin(null); setBedroomsMin(null); setOnlyMulti(false); setOnlyConfirmed(false)
    setOnlyCaptadas(false); setOnlySmart(false)
    setComuna(''); setSearchInput('')
    setCodeQuery(''); setCodeInput('')
    setGeoShape(null)
  }
  // Valor mostrado en los inputs de precio según la unidad activa — por dentro
  // priceMin/priceMax SIGUEN en CLP, esto solo convierte para mostrar/escribir.
  const priceMinDisplay = priceUnit === 'uf' && ufRate ? (priceMin != null ? Math.round(priceMin / ufRate) : '') : (priceMin ?? '')
  const priceMaxDisplay = priceUnit === 'uf' && ufRate ? (priceMax != null ? Math.round(priceMax / ufRate) : '') : (priceMax ?? '')
  const setPriceMinFromInput = (raw: string) => {
    const v = raw ? Number(raw) : null
    setPriceMin(v == null ? null : (priceUnit === 'uf' && ufRate ? Math.round(v * ufRate) : v))
  }
  const setPriceMaxFromInput = (raw: string) => {
    const v = raw ? Number(raw) : null
    setPriceMax(v == null ? null : (priceUnit === 'uf' && ufRate ? Math.round(v * ufRate) : v))
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
              {grouped
                ? '1 ficha por inmueble · los anuncios de la misma corredora con el mismo código interno (venta y arriendo incluidos) van juntos'
                : 'Todos los anuncios, uno por ficha · pulsa «Agrupar» para juntar los de la misma corredora + código interno'}
              <span className="text-slate-600"> · </span>
              <span className="inline-flex items-center gap-1 text-slate-400"><Move size={11} /> arrastra una ficha sobre otra para unirlas</span>
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <StatTile icon={<Home size={16} />} label="Propiedades" value={loading ? '…' : (stats?.total ?? total).toLocaleString('es-CL')} accent="bg-amber-500/15 text-amber-400" />
          <StatTile icon={<GitCompareArrows size={16} />} label="En canje (multi-corredora)" value={loading ? '…' : String(stats?.multi_corredora ?? 0)} accent="bg-purple-500/15 text-purple-400" />
          <StatTile icon={<TrendingDown size={16} />} label="Precio mediano" value={loading ? '…' : clpShort(stats?.median_price ?? null)} accent="bg-blue-500/15 text-blue-400" />
          <StatTile icon={<BadgeCheck size={16} />} label="Ubicación confirmada" value={loading ? '…' : String(stats?.confirmed ?? 0)} accent="bg-emerald-500/15 text-emerald-400" />
          {/* Cuánto del inventario ya pasó por Captación (y cuánto de eso ya
              está en Smart): el avance del trabajo, no solo el stock. */}
          <StatTile icon={<Users size={16} />}
            label={`Captadas${stats?.smart ? ` · ${stats.smart} en Smart` : ''}`}
            value={loading ? '…' : String(stats?.captadas ?? 0)} accent="bg-teal-500/15 text-teal-400" />
        </div>

        {/* Búsqueda + comuna chips */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Buscar por comuna…" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 pl-9 pr-8 py-2 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            {searchInput && <button onClick={() => setSearchInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X size={14} /></button>}
          </div>
          <div className="relative w-64 shrink-0">
            <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Código, MLC-… o pega la URL…" value={codeInput} onChange={e => setCodeInput(e.target.value)}
              title={'Acepta cualquiera de estas formas del mismo inmueble:\n' +
                '· URL pegada del navegador (https://www.portalinmobiliario.com/MLC-2107783039-se-vende-…-_JM)\n' +
                '· el número del anuncio suelto (2107783039)\n' +
                '· el número con prefijo (MLC-2107783039)\n' +
                '· el código interno del CRM (PI-2607-21087)\n' +
                '· el código interno de la corredora\n' +
                '· la URL de la ficha en la web propia de una corredora\n' +
                'Busca en venta y arriendo y también en anuncios ya retirados. Si no está en la base, se trae en vivo del sitio.'}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 pl-9 pr-8 py-2 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            {codeInput && <button onClick={() => setCodeInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X size={14} /></button>}
          </div>
          <select value={operation} onChange={e => setOperation(e.target.value)} className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-amber-500">
            <option value="all">Todas</option><option value="sale">Venta</option><option value="rent">Arriendo</option>
          </select>
          <button onClick={() => setShowFilters(!showFilters)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${activeFilters > 0 ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'}`}>
            <SlidersHorizontal size={14} /> Filtros {activeFilters > 0 && `(${activeFilters})`}
          </button>
          <button onClick={() => setShowMap(m => !m)}
            title="Buscar dentro de una zona dibujada a mano en el mapa (polígono, rectángulo o círculo)"
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${showMap ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'}`}>
            {showMap ? <LayoutList size={14} /> : <MapIcon size={14} />} {showMap ? 'Ocultar mapa' : 'Mapa'} {geoShape && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </button>
          {/* Matching manual: el modo selección. El arrastre funciona siempre,
              con o sin este modo activo. */}
          <button onClick={runDedup} disabled={dedupRunning}
            title="Agrupa los anuncios que comparten corredora Y código interno (ej. KD92695) bajo una misma ficha — incluidos venta y arriendo del mismo inmueble. Es la única regla de deduplicación: si no coinciden ambos, no se agrupan."
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border bg-slate-800 text-slate-300 border-slate-700 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-50 transition-colors">
            <Wand2 size={14} className={dedupRunning ? 'animate-pulse' : ''} /> {dedupRunning ? 'Lanzando…' : 'Deduplicar'}
          </button>
          <button onClick={() => setGrouped(g => !g)}
            title={grouped
              ? 'Mostrando 1 ficha por inmueble: los anuncios de la misma corredora con el mismo código interno (incluidos venta y arriendo del mismo inmueble) van juntos.'
              : 'Mostrando todos los anuncios, uno por ficha — el recuento cuadra con el del portal. Pulsa para agrupar los duplicados de la misma corredora + código interno.'}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${grouped ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'}`}>
            <Layers size={14} /> {grouped ? 'Agrupadas' : 'Agrupar'}
          </button>
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
              <div className="absolute right-0 top-full mt-1 z-[2000] bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden min-w-[210px]">
                {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                  <button key={k} onClick={() => { setSortBy(k); setShowSortMenu(false) }} className={`block w-full text-left px-3 py-2 text-xs ${sortBy === k ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{SORT_LABELS[k]}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Buscar por código ignora "Venta/Arriendo" y el "solo publicados"
            implícito (ver /api/chile/property-cl): quien pega un código quiere
            ESE inmueble. Se dice aquí para que no parezca que el selector de
            operación dejó de funcionar. */}
        {codeQuery && (
          <div className="flex items-center gap-1.5 mb-2 text-[11px] text-amber-300/80">
            <Hash size={11} />
            <span>Buscando <span className="font-mono text-amber-300">{codeQuery}</span> en venta y arriendo, incluidos anuncios ya retirados</span>
            <button onClick={() => { setCodeInput(''); setCodeQuery('') }} className="text-slate-500 hover:text-slate-300 underline underline-offset-2">quitar</button>
          </div>
        )}

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

        {/* Mapa con dibujo: pinta hasta 200 propiedades del filtro actual
            (lote propio, independiente de la página de la grilla) y deja
            recortar por un polígono/rectángulo/círculo a mano — el resultado
            vuelve a pedirse al backend (ST_Contains/ST_DWithin sobre el geom
            indexado), así que la grilla de abajo y los pines del mapa quedan
            filtrados igual. */}
        {showMap && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5 text-[11px] text-slate-400">
              <span>
                {mapLoading
                  ? 'Cargando mapa…'
                  : mapTotal > mapItems.length
                    ? `Mostrando ${mapItems.length.toLocaleString('es-CL')} de ${mapTotal.toLocaleString('es-CL')} propiedades en el mapa`
                    : `${mapTotal.toLocaleString('es-CL')} propiedad${mapTotal === 1 ? '' : 'es'} en el mapa`}
              </span>
            </div>
            <div className="h-[460px] rounded-xl overflow-hidden border border-slate-700/60">
              <PropertyMap
                listings={mapItems.map(propertyToListing)}
                activeId={selected?.id ?? null}
                onMarkerClick={id => { const p = mapItems.find(i => i.id === id) ?? items.find(i => i.id === id); if (p) setSelected(p) }}
                onShapeDrawn={setGeoShape}
                activeShape={geoShape}
                tileStyle="satellite"
              />
            </div>
          </div>
        )}

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4 bg-slate-800/40 border border-slate-700/60 rounded-xl p-3">
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-semibold text-slate-400">Precio ({priceUnit === 'uf' ? 'UF' : 'CLP'})</label>
                <div className="flex rounded-md overflow-hidden border border-slate-600 shrink-0">
                  <button type="button" onClick={() => setPriceUnit('clp')}
                    className={`px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${priceUnit === 'clp' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}>CLP</button>
                  <button type="button" onClick={() => setPriceUnit('uf')} disabled={!ufRate}
                    title={ufRate ? `1 UF = ${clp(ufRate)} (${ufRateDate})` : 'Cargando tasa UF…'}
                    className={`px-1.5 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${priceUnit === 'uf' ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}>UF</button>
                </div>
              </div>
              <div className="flex gap-1">
                <input type="number" placeholder="Min" value={priceMinDisplay} onChange={e => setPriceMinFromInput(e.target.value)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" />
                <input type="number" placeholder="Max" value={priceMaxDisplay} onChange={e => setPriceMaxFromInput(e.target.value)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" />
              </div>
            </div>
            <div><label className="block text-[11px] font-semibold text-slate-400 mb-1">m² mín.</label>
              <input type="number" placeholder="ej. 80" value={sqmMin ?? ''} onChange={e => setSqmMin(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" /></div>
            <div><label className="block text-[11px] font-semibold text-slate-400 mb-1">Dorm. mín.</label>
              <input type="number" placeholder="ej. 3" value={bedroomsMin ?? ''} onChange={e => setBedroomsMin(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" /></div>
            <div className="flex flex-col justify-center gap-1.5">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={onlyMulti} onChange={e => setOnlyMulti(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" /> Solo en canje</label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={onlyConfirmed} onChange={e => setOnlyConfirmed(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" /> Ubicación confirmada</label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer" title="Solo las que ya tienen ficha en el CRM de Captación"><input type="checkbox" checked={onlyCaptadas} onChange={e => setOnlyCaptadas(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-emerald-500" /> Solo captadas</label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer" title="Solo las marcadas como ya subidas al CRM externo (Smart)"><input type="checkbox" checked={onlySmart} onChange={e => setOnlySmart(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-violet-500" /> Ya en Smart</label>
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
              <PropertyCardCl key={(p as { row_key?: string }).row_key ?? p.id} p={p} onOpen={setSelected}
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
              <button onClick={clearSelection} className="text-xs text-slate-400 hover:text-slate-200">Limpiar</button>
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
        <div className="fixed bottom-20 inset-x-0 z-[1350] flex justify-center px-4 pointer-events-none">
          <div className={`pointer-events-auto flex items-center gap-2 text-sm text-white px-4 py-2 rounded-full shadow-xl ${toast.ok ? 'bg-emerald-600' : 'bg-rose-600'}`}>
            {toast.ok ? <BadgeCheck size={15} /> : <AlertTriangle size={15} />} {toast.text}
          </div>
        </div>
      )}

      {mergeDialog && (
        <MergeDialog properties={mergeDialog.properties} defaultSurvivorId={mergeDialog.defaultSurvivorId}
          onCancel={() => setMergeDialog(null)} onMerged={handleMerged} />
      )}

      {selected && <PropertyModal p={selected} onClose={() => setSelected(null)} onRefetched={handlePropertyChange} onSplit={handleSplit} />}
    </div>
  )
}
