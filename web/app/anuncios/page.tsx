'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import nextDynamicImport from 'next/dynamic'
import PropertyCard from '@/components/PropertyCard'
import { mockListings } from '@/lib/mock-listings'
import { SlidersHorizontal, Map, LayoutList, ChevronDown, Search, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { Listing } from '@/lib/mock-listings'

// Evita que Next.js cachee esta ruta como página estática (Full Route Cache):
// el contenido real depende de un fetch en cliente, no de datos en build time.
export const dynamic = 'force-dynamic'

const PropertyMap = nextDynamicImport(() => import('@/components/map/PropertyMap'), { ssr: false })

type Operation = 'all' | 'sale' | 'rent'
type AdvertiserFilter = 'all' | 'particular' | 'professional'
type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'sqm'

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Más recientes',
  price_asc: 'Precio: menor a mayor',
  price_desc: 'Precio: mayor a menor',
  sqm: '€/m² menor',
}

const PAGE_SIZE = 30

type RangeFilters = {
  priceMin: string
  priceMax: string
  sqmMin: string
  sqmMax: string
  bedroomsMin: string
  bathroomsMin: string
}

const EMPTY_RANGES: RangeFilters = {
  priceMin: '', priceMax: '', sqmMin: '', sqmMax: '', bedroomsMin: '', bathroomsMin: '',
}

function transformRow(row: any): Listing {
  const portal = row.portal || 'idealista'
  const price = row.price || 0
  const listedDate = new Date().toISOString().split('T')[0]
  return {
    id: row.id,
    property_id: row.property_id,
    title: row.title || `Inmueble ${row.id}`,
    operation: row.operation || 'rent',
    price,
    square_meters: row.square_meters || 0,
    price_sqm: row.price_sqm || 0,
    bedrooms: row.bedrooms || 0,
    bathrooms: row.bathrooms || 1,
    zone_name: row.zone_name || row.zone_raw || 'Unknown',
    portal,
    source_type: 'portal' as const,
    advertiser_type: row.advertiser_type || 'professional',
    advertiser_name: row.advertiser_name || 'Idealista',
    days_on_market: row.days_on_market || 0,
    is_active: row.is_active !== false,
    latitude: row.latitude || 40.43,
    longitude: row.longitude || -3.68,
    photos: Array.isArray(row.photos) ? row.photos : [],
    source_url: row.source_url || '',
    listing_count: 1,
    portals: [portal],
    price_drops: Number(row.price_drops) || 0,
    rc_status: 'none' as const,
    description: row.description,
    features: Array.isArray(row.features) ? row.features : [],
    priceHistory: [{ date: listedDate, price, event: 'listed' as const }],
    sources: [{
      id: `${row.id}-${portal}`,
      type: row.advertiser_type === 'particular' ? 'particular' : 'agency',
      name: row.advertiser_name || 'Idealista',
      portal,
      price,
      status: 'active' as const,
      listed_at: listedDate,
      url: row.source_url || '',
      is_particular: row.advertiser_type === 'particular',
    }],
  }
}

export default function AnunciosPage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [usingFallback, setUsingFallback] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [operation, setOperation] = useState<Operation>('all')
  const [advertiser, setAdvertiser] = useState<AdvertiserFilter>('all')
  const [showMap, setShowMap] = useState(true)
  const [onlyWithDrops, setOnlyWithDrops] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('recent')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFiltersPanel, setShowFiltersPanel] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [ranges, setRanges] = useState<RangeFilters>(EMPTY_RANGES)
  const [draftRanges, setDraftRanges] = useState<RangeFilters>(EMPTY_RANGES)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const combinedActive = hoverId ?? activeId
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce free-text search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  // Reset to page 1 whenever a filter (other than page itself) changes
  useEffect(() => { setPage(1) }, [operation, advertiser, onlyWithDrops, sortBy, ranges])

  const activeFilterCount = Object.values(ranges).filter(Boolean).length

  // Fetch listings whenever filters/sort/page change
  useEffect(() => {
    const controller = new AbortController()
    const fetchListings = async () => {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('page_size', String(PAGE_SIZE))
        params.set('sort', sortBy)
        if (operation !== 'all') params.set('operation', operation)
        if (advertiser !== 'all') params.set('advertiser_type', advertiser)
        if (onlyWithDrops) params.set('only_drops', 'true')
        if (search) params.set('q', search)
        if (ranges.priceMin) params.set('price_min', ranges.priceMin)
        if (ranges.priceMax) params.set('price_max', ranges.priceMax)
        if (ranges.sqmMin) params.set('sqm_min', ranges.sqmMin)
        if (ranges.sqmMax) params.set('sqm_max', ranges.sqmMax)
        if (ranges.bedroomsMin) params.set('bedrooms_min', ranges.bedroomsMin)
        if (ranges.bathroomsMin) params.set('bathrooms_min', ranges.bathroomsMin)

        const response = await fetch(`/api/listings?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Failed to fetch listings')
        const result = await response.json()
        if (result.success && Array.isArray(result.data)) {
          setListings(result.data.map(transformRow))
          setTotal(result.total ?? result.data.length)
          setTotalPages(result.total_pages ?? 1)
          setUsingFallback(false)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error('Error loading listings:', err)
        setListings(mockListings)
        setTotal(mockListings.length)
        setTotalPages(1)
        setUsingFallback(true)
      } finally {
        setLoading(false)
      }
    }
    fetchListings()
    return () => controller.abort()
  }, [page, sortBy, operation, advertiser, onlyWithDrops, search, ranges])

  const openFiltersPanel = useCallback(() => {
    setDraftRanges(ranges)
    setShowFiltersPanel((v) => !v)
  }, [ranges])

  const applyFilters = () => { setRanges(draftRanges); setShowFiltersPanel(false) }
  const clearFilters = () => { setDraftRanges(EMPTY_RANGES); setRanges(EMPTY_RANGES); setShowFiltersPanel(false) }

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="flex flex-col h-full bg-[var(--c-bg)]">
      {/* ── Filter bar ── */}
      <header className="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-[var(--c-border)] bg-[var(--c-bg)] flex-wrap">

        {/* Search input */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar zona, calle..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg text-slate-400 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/20"
          />
        </div>

        <div className="w-px h-5 bg-[var(--c-border-card)]" />

        {/* Operation pills */}
        <div className="flex rounded-lg bg-[var(--c-card)] border border-[var(--c-border-card)] p-0.5 gap-0.5">
          {(['all', 'sale', 'rent'] as Operation[]).map((op) => (
            <button
              key={op}
              onClick={() => setOperation(op)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                operation === op
                  ? 'bg-[var(--c-active)] text-blue-400 shadow-sm'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              {op === 'all' ? 'Todos' : op === 'sale' ? 'Venta' : 'Alquiler'}
            </button>
          ))}
        </div>

        {/* Advertiser pills */}
        <div className="flex rounded-lg bg-[var(--c-card)] border border-[var(--c-border-card)] p-0.5 gap-0.5">
          {(['all', 'particular', 'professional'] as AdvertiserFilter[]).map((a) => (
            <button
              key={a}
              onClick={() => setAdvertiser(a)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                advertiser === a
                  ? 'bg-[var(--c-active)] text-blue-400 shadow-sm'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              {a === 'all' ? 'Todos' : a === 'particular' ? 'Particular' : 'Agencia'}
            </button>
          ))}
        </div>

        {/* Bajadas toggle */}
        <button
          onClick={() => setOnlyWithDrops(!onlyWithDrops)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            onlyWithDrops
              ? 'bg-emerald-950/60 border-emerald-800/40 text-emerald-400'
              : 'bg-[var(--c-card)] border-[var(--c-border-card)] text-slate-600 hover:text-slate-400'
          }`}
        >
          <SlidersHorizontal size={12} />
          Bajadas
        </button>

        {/* Más filtros */}
        <div className="relative">
          <button
            onClick={openFiltersPanel}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              activeFilterCount > 0
                ? 'bg-blue-950/60 border-blue-800/40 text-blue-400'
                : 'bg-[var(--c-card)] border-[var(--c-border-card)] text-slate-600 hover:text-slate-400'
            }`}
          >
            Más filtros
            {activeFilterCount > 0 && (
              <span className="text-[10px] bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
            )}
            <ChevronDown size={11} className={`transition-transform ${showFiltersPanel ? 'rotate-180' : ''}`} />
          </button>
          {showFiltersPanel && (
            <div className="absolute left-0 top-full mt-1.5 z-50 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-xl shadow-xl shadow-black/40 p-4 w-80">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-slate-300">Filtros avanzados</h3>
                <button onClick={() => setShowFiltersPanel(false)} className="text-slate-500 hover:text-slate-300">
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">Precio (€)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Mín"
                      value={draftRanges.priceMin}
                      onChange={(e) => setDraftRanges((r) => ({ ...r, priceMin: e.target.value }))}
                      className="w-full text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg px-2.5 py-1.5 text-slate-300"
                    />
                    <span className="text-slate-600">—</span>
                    <input
                      type="number"
                      placeholder="Máx"
                      value={draftRanges.priceMax}
                      onChange={(e) => setDraftRanges((r) => ({ ...r, priceMax: e.target.value }))}
                      className="w-full text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg px-2.5 py-1.5 text-slate-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-500 block mb-1">Superficie (m²)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Mín"
                      value={draftRanges.sqmMin}
                      onChange={(e) => setDraftRanges((r) => ({ ...r, sqmMin: e.target.value }))}
                      className="w-full text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg px-2.5 py-1.5 text-slate-300"
                    />
                    <span className="text-slate-600">—</span>
                    <input
                      type="number"
                      placeholder="Máx"
                      value={draftRanges.sqmMax}
                      onChange={(e) => setDraftRanges((r) => ({ ...r, sqmMax: e.target.value }))}
                      className="w-full text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg px-2.5 py-1.5 text-slate-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Habitaciones mín.</label>
                    <select
                      value={draftRanges.bedroomsMin}
                      onChange={(e) => setDraftRanges((r) => ({ ...r, bedroomsMin: e.target.value }))}
                      className="w-full text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg px-2.5 py-1.5 text-slate-300"
                    >
                      <option value="">Cualquiera</option>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Baños mín.</label>
                    <select
                      value={draftRanges.bathroomsMin}
                      onChange={(e) => setDraftRanges((r) => ({ ...r, bathroomsMin: e.target.value }))}
                      className="w-full text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg px-2.5 py-1.5 text-slate-300"
                    >
                      <option value="">Cualquiera</option>
                      {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}+</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={clearFilters}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium text-slate-400 border border-[var(--c-border-card)] hover:text-slate-200 transition-colors"
                >
                  Limpiar
                </button>
                <button
                  onClick={applyFilters}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                >
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border bg-[var(--c-card)] border-[var(--c-border-card)] text-slate-400 hover:text-slate-200 transition-colors"
          >
            {SORT_LABELS[sortBy]}
            <ChevronDown size={11} className={`transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-full mt-1.5 z-50 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-xl shadow-xl shadow-black/40 py-1 min-w-[190px]">
              {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setSortBy(key); setShowSortMenu(false) }}
                  className={`w-full text-left px-3.5 py-2 text-xs transition-colors ${
                    sortBy === key ? 'text-blue-400 bg-blue-950/30' : 'text-slate-400 hover:bg-[var(--c-surface)] hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Map toggle */}
        <button
          onClick={() => setShowMap(!showMap)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            showMap
              ? 'bg-[var(--c-active)] border-blue-800/40 text-blue-400'
              : 'bg-[var(--c-card)] border-[var(--c-border-card)] text-slate-600 hover:text-slate-400'
          }`}
        >
          {showMap ? <LayoutList size={13} /> : <Map size={13} />}
          {showMap ? 'Lista' : 'Mapa'}
        </button>
      </header>

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Property list */}
        <div className={`flex flex-col overflow-hidden transition-all duration-300 ${showMap ? 'w-[52%]' : 'w-full'}`}>
          {/* Counter */}
          <div className="flex-none px-4 py-2 border-b border-[var(--c-border)]">
            <p className="text-xs text-slate-500">
              {total > 0 ? (
                <>
                  <span className="text-slate-300 font-semibold">{rangeStart}–{rangeEnd}</span>
                  {' '}de{' '}
                  <span className="text-slate-400">{total}</span> anuncios
                </>
              ) : (
                <span className="text-slate-400">0 anuncios</span>
              )}
              {usingFallback && <span className="text-amber-500"> (datos de ejemplo, sin conexión a la API)</span>}
            </p>
          </div>

          {/* Cards grid */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-700">
                <p className="text-sm font-medium">Cargando anuncios…</p>
              </div>
            ) : listings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-700">
                <p className="text-sm font-medium">Sin resultados</p>
                <p className="text-xs mt-1">Ajusta los filtros para ver más anuncios</p>
              </div>
            ) : (
              <div className={`grid gap-3 ${showMap ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {listings.map((listing) => (
                  <PropertyCard
                    key={listing.id}
                    listing={listing}
                    active={combinedActive === listing.id}
                    onHover={setHoverId}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="flex-none flex items-center justify-center gap-3 px-4 py-2.5 border-t border-[var(--c-border)]">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 border border-[var(--c-border-card)] disabled:opacity-30 disabled:cursor-not-allowed hover:text-slate-200 transition-colors"
              >
                <ChevronLeft size={13} />
                Anterior
              </button>
              <span className="text-xs text-slate-500">Página {page} de {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 border border-[var(--c-border-card)] disabled:opacity-30 disabled:cursor-not-allowed hover:text-slate-200 transition-colors"
              >
                Siguiente
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Map panel */}
        {showMap && (
          <div className="flex-1 relative border-l border-[var(--c-border)]">
            <PropertyMap
              listings={listings}
              activeId={combinedActive}
              onMarkerClick={(id) => setActiveId(id === activeId ? null : id)}
              onMarkerHover={setHoverId}
            />
          </div>
        )}
      </div>
    </div>
  )
}
