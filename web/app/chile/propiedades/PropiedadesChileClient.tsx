'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  Search, X, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight,
  BedDouble, Bath, Ruler, MapPin, Users, ShieldCheck, GitCompareArrows, ExternalLink,
  Home, ImageOff, TrendingDown, CalendarClock, Building2, BadgeCheck, Trophy, Images, Video, Plus, RefreshCw,
  Maximize2, Minimize2, Link2, Unlink, Check, Move, AlertTriangle,
} from 'lucide-react'

// La ficha (modal) y sus tipos/helpers viven en un módulo compartido: la misma
// ficha se abre desde /chile/anuncios.
import PropertyModal, {
  type Property, type Listing, CONF, clp, clpShort, priceMain, priceAlt,
  marketTime, priceSpread, CorredoraThumb,
} from '@/components/chile/PropertyClModal'

type Stats = { total: number; multi_corredora: number; confirmed: number; median_price: number | null }

type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'corredoras' | 'sqm'
const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Más recientes', price_asc: 'Precio: menor a mayor', price_desc: 'Precio: mayor a menor',
  corredoras: 'Más corredoras (en canje)', sqm: '$/m² menor',
}
const PRIORITY_COMUNAS = ['Las Condes', 'Vitacura', 'Lo Barnechea', 'Providencia', 'Ñuñoa', 'La Reina', 'Colina', 'Peñalolén']
const PAGE_SIZE = 24

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
export default function PropiedadesChileClient() {
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
        <div className="fixed bottom-20 inset-x-0 z-[1350] flex justify-center px-4 pointer-events-none">
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
