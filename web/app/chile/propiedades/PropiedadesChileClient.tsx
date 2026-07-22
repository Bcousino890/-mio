'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, X, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight,
  BedDouble, Bath, Ruler, MapPin, Users, ShieldCheck, GitCompareArrows, ExternalLink, Home, ImageOff,
} from 'lucide-react'

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
}

type Property = {
  id: string
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
}

type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'corredoras' | 'sqm'
const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Más recientes',
  price_asc: 'Precio: menor a mayor',
  price_desc: 'Precio: mayor a menor',
  corredoras: 'Más corredoras (en canje)',
  sqm: '$/m² menor',
}
const CRM_LABELS: Record<string, string> = { convecta: 'Convecta', ofinet: 'Ofinet', other: 'Otro CRM', unknown: '—' }
const PAGE_SIZE = 24

function clp(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

const CONF_LABEL: Record<string, { t: string; c: string }> = {
  confirmed: { t: 'Ubicación confirmada', c: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  candidate: { t: 'Ubicación probable', c: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  pin_suspect: { t: 'Pin sospechoso', c: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  none: { t: 'Sin ubicar', c: 'bg-slate-600/30 text-slate-400 border-slate-600/40' },
}

// ─── Card de propiedad ──────────────────────────────────────────────────────
function PropertyCardCl({ p, onOpen }: { p: Property; onOpen: (p: Property) => void }) {
  const [imgError, setImgError] = useState(false)
  return (
    <button onClick={() => onOpen(p)} className="text-left bg-slate-800/70 border border-slate-700 rounded-xl overflow-hidden hover:border-amber-500/50 hover:shadow-lg hover:shadow-black/30 transition-all group">
      <div className="relative aspect-[4/3] bg-slate-900 overflow-hidden">
        {p.cover_photo && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.cover_photo} alt="" onError={() => setImgError(true)} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600"><ImageOff size={28} /></div>
        )}
        {p.corredora_count > 1 && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-600/90 text-white backdrop-blur-sm">
            <GitCompareArrows size={10} /> {p.corredora_count} corredoras
          </span>
        )}
        <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-slate-200 backdrop-blur-sm capitalize">
          {p.operation === 'rent' ? 'Arriendo' : 'Venta'}
        </span>
      </div>
      <div className="p-3">
        <div className="text-lg font-bold text-slate-100">{clp(p.canonical_price)}</div>
        {p.price_sqm ? <div className="text-[11px] text-slate-500">{clp(p.price_sqm)}/m²</div> : null}
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
          {p.bedrooms != null && <span className="inline-flex items-center gap-1"><BedDouble size={13} /> {p.bedrooms}</span>}
          {p.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath size={13} /> {p.bathrooms}</span>}
          {p.square_meters != null && <span className="inline-flex items-center gap-1"><Ruler size={13} /> {p.square_meters} m²</span>}
        </div>
        <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-400 truncate">
          <MapPin size={12} className="text-slate-500 shrink-0" /> {p.comuna_name || 'Sin comuna'}
          <span className="text-slate-600">·</span>
          <span className="inline-flex items-center gap-1"><Users size={12} /> {p.listing_count} {p.listing_count === 1 ? 'anuncio' : 'anuncios'}</span>
        </div>
      </div>
    </button>
  )
}

// ─── Ficha interna (modal) ──────────────────────────────────────────────────
function PropertyModal({ p, onClose }: { p: Property; onClose: () => void }) {
  const gallery = Array.from(new Set(p.listings.flatMap(l => l.photos || []).filter(Boolean)))
  const cover = p.cover_photo && !gallery.includes(p.cover_photo) ? [p.cover_photo, ...gallery] : gallery
  const [idx, setIdx] = useState(0)
  const [imgError, setImgError] = useState(false)
  const conf = CONF_LABEL[p.location_confidence] ?? CONF_LABEL.none

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasGallery = cover.length > 0
  const prev = useCallback(() => { setImgError(false); setIdx(i => (i - 1 + cover.length) % cover.length) }, [cover.length])
  const next = useCallback(() => { setImgError(false); setIdx(i => (i + 1) % cover.length) }, [cover.length])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Galería */}
        <div className="relative aspect-[16/9] bg-slate-900 rounded-t-2xl overflow-hidden">
          {hasGallery && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover[idx]} alt="" onError={() => setImgError(true)} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600"><ImageOff size={40} /></div>
          )}
          <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"><X size={18} /></button>
          {cover.length > 1 && (
            <>
              <button onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"><ChevronLeft size={20} /></button>
              <button onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"><ChevronRight size={20} /></button>
              <span className="absolute bottom-2 right-2 text-[11px] px-2 py-0.5 rounded-full bg-black/60 text-white">{idx + 1} / {cover.length}</span>
            </>
          )}
        </div>

        <div className="p-5">
          {/* Cabecera */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-2xl font-bold text-slate-100">{clp(p.canonical_price)}</div>
              {p.canonical_price_uf && <div className="text-xs text-slate-500">≈ {Number(p.canonical_price_uf).toLocaleString('es-CL')} UF</div>}
            </div>
            <span className={`text-[11px] px-2 py-1 rounded-full border ${conf.c}`}>{conf.t}</span>
          </div>

          <div className="flex items-center gap-4 mt-3 text-sm text-slate-300">
            {p.bedrooms != null && <span className="inline-flex items-center gap-1.5"><BedDouble size={15} /> {p.bedrooms} dorm</span>}
            {p.bathrooms != null && <span className="inline-flex items-center gap-1.5"><Bath size={15} /> {p.bathrooms} baños</span>}
            {p.square_meters != null && <span className="inline-flex items-center gap-1.5"><Ruler size={15} /> {p.square_meters} m²</span>}
            <span className="inline-flex items-center gap-1.5"><Home size={15} /> {p.property_type ?? 'casa'}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-sm text-slate-400">
            <MapPin size={14} className="text-slate-500" /> {p.comuna_name || 'Sin comuna'}
            {p.days_on_market != null && <span className="text-slate-600">· {p.days_on_market} días en mercado</span>}
          </div>

          {/* Corredoras */}
          <h3 className="text-sm font-semibold text-slate-300 mt-5 mb-2">
            {p.corredora_count > 1
              ? <span className="inline-flex items-center gap-1.5"><GitCompareArrows size={15} className="text-amber-400" /> Publicada por {p.corredora_count} corredoras (en canje)</span>
              : <span className="inline-flex items-center gap-1.5"><ShieldCheck size={15} className="text-emerald-400" /> Publicada en exclusiva</span>}
          </h3>
          <div className="space-y-2">
            {p.listings.map(l => (
              <div key={l.listing_id} className="flex items-center justify-between gap-3 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-slate-200 truncate capitalize">
                    {l.advertiser_name || 'Corredora'}
                    {l.crm_platform && l.crm_platform !== 'unknown' && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">{CRM_LABELS[l.crm_platform] ?? l.crm_platform}</span>
                    )}
                    {!l.is_active && <span className="ml-2 text-[10px] text-slate-500">(dado de baja)</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {l.external_id}{l.seller_reference && <> · ref. {l.seller_reference}</>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold text-slate-100">{clp(l.price)}</span>
                  {l.source_url && (
                    <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-cyan-400" title="Ver anuncio">
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Página ─────────────────────────────────────────────────────────────────
export default function PropiedadesChileClient() {
  const [items, setItems] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Property | null>(null)

  const [operation, setOperation] = useState('sale')
  const [comuna, setComuna] = useState('')
  const [priceMin, setPriceMin] = useState<number | null>(null)
  const [priceMax, setPriceMax] = useState<number | null>(null)
  const [sqmMin, setSqmMin] = useState<number | null>(null)
  const [bedroomsMin, setBedroomsMin] = useState<number | null>(null)
  const [onlyMulti, setOnlyMulti] = useState(false)
  const [onlyConfirmed, setOnlyConfirmed] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('recent')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setComuna(searchInput.trim()); setPage(1) }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  useEffect(() => { setPage(1) }, [operation, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed, sortBy])

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
        if (d.success && Array.isArray(d.data)) { setItems(d.data); setTotal(d.total); setTotalPages(d.total_pages) }
        else { setItems([]); setTotal(0); setTotalPages(1) }
      })
      .catch(() => { setItems([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [page, sortBy, operation, comuna, priceMin, priceMax, sqmMin, bedroomsMin, onlyMulti, onlyConfirmed])

  const activeFilters = (priceMin != null || priceMax != null ? 1 : 0) + (sqmMin != null ? 1 : 0) + (bedroomsMin != null ? 1 : 0) + (onlyMulti ? 1 : 0) + (onlyConfirmed ? 1 : 0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400"><Home size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 leading-none">Propiedades</h1>
            <p className="text-[11px] text-slate-500 mt-1">Inmuebles canónicos deduplicados · 1 propiedad = 1 ficha, aunque la publiquen N corredoras</p>
          </div>
          <span className="ml-auto text-xs text-slate-500">{loading ? 'cargando…' : `${total.toLocaleString('es-CL')} propiedades`}</span>
        </div>

        {/* Barra de control */}
        <div className="flex items-center gap-2 my-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Buscar por comuna…" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 pl-9 pr-8 py-2 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            {searchInput && <button onClick={() => setSearchInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X size={14} /></button>}
          </div>
          <select value={operation} onChange={e => setOperation(e.target.value)} className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-amber-500">
            <option value="all">Todas</option>
            <option value="sale">Venta</option>
            <option value="rent">Arriendo</option>
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

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4 bg-slate-800/40 border border-slate-700/60 rounded-xl p-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Precio (CLP)</label>
              <div className="flex gap-1">
                <input type="number" placeholder="Min" value={priceMin ?? ''} onChange={e => setPriceMin(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" />
                <input type="number" placeholder="Max" value={priceMax ?? ''} onChange={e => setPriceMax(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">m² mín.</label>
              <input type="number" placeholder="ej. 80" value={sqmMin ?? ''} onChange={e => setSqmMin(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Dorm. mín.</label>
              <input type="number" placeholder="ej. 3" value={bedroomsMin ?? ''} onChange={e => setBedroomsMin(e.target.value ? Number(e.target.value) : null)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-2 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div className="flex flex-col justify-center gap-1.5">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={onlyMulti} onChange={e => setOnlyMulti(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" /> Solo en canje
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={onlyConfirmed} onChange={e => setOnlyConfirmed(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" /> Ubicación confirmada
              </label>
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
          <div className="text-center text-slate-500 py-16">Sin propiedades con esos filtros</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map(p => <PropertyCardCl key={p.id} p={p} onOpen={setSelected} />)}
          </div>
        )}

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-6">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-slate-800 border border-slate-700 disabled:opacity-40 hover:border-slate-600"><ChevronLeft size={16} /> Anterior</button>
            <span className="text-xs text-slate-400">{page} / {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-slate-800 border border-slate-700 disabled:opacity-40 hover:border-slate-600">Siguiente <ChevronRight size={16} /></button>
          </div>
        )}
      </div>

      {selected && <PropertyModal p={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
