'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import nextDynamicImport from 'next/dynamic'
import PropertyCard from '@/components/PropertyCard'
import FilterPanel from '@/components/filters/FilterPanel'
import { mockListings } from '@/lib/mock-listings'
import { SlidersHorizontal, Map, LayoutList, ChevronDown, Search, ChevronLeft, ChevronRight, X, Menu } from 'lucide-react'
import type { Listing } from '@/lib/types'
import type { FilterState } from '@/components/filters/FilterPanel'

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

export default function AnunciosClient() {
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
  const [filters, setFilters] = useState<FilterState>({
    operation: 'all',
    advertiserType: 'all',
    advertiserFilter: {
      mode: 'all',
      particularOptions: {
        onlyParticular: false,
        isPrivateByAgency: false,
        wasPrivateByAgency: false,
      },
      agencyOptions: {
        agencyId: null,
        agencyName: null,
        exclusive: false,
        exclusiveMode: 'both',
        excludeAgencyId: null,
      },
    },
    propertyTypes: [],
    price: { min: null, max: null },
    squareMeters: { min: null, max: null },
    pricePerSqm: { min: null, max: null },
    bedrooms: { min: null, max: null },
    bathrooms: { min: null, max: null },
    yearBuilt: { min: null, max: null },
    daysOnMarket: { min: null, max: null },
    parcelSize: { min: null, max: null },
    floor: null,
    view: null,
    orientation: null,
    furnished: null,
    energyRating: null,
    characteristics: [],
    location: null,
    distance: null,
    selected_district_id: null,
    selected_zone_id: null,
    selected_subzone_id: null,
    geoShape: null,
  })
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
  useEffect(() => { setPage(1) }, [operation, advertiser, onlyWithDrops, sortBy, filters])

  const getActiveFilterCount = (): number => {
    let count = 0
    if (filters.price.min !== null || filters.price.max !== null) count++
    if (filters.squareMeters.min !== null || filters.squareMeters.max !== null) count++
    if (filters.bedrooms.min !== null) count++
    if (filters.bathrooms.min !== null) count++
    if (filters.location) count++
    if (filters.characteristics.length > 0) count++
    if (filters.propertyTypes.length > 0) count++
    if (filters.furnished !== null) count++
    if (filters.yearBuilt.min !== null || filters.yearBuilt.max !== null) count++
    if (filters.energyRating) count++
    if (filters.geoShape) count++
    return count
  }

  const activeFilterCount = getActiveFilterCount()

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
        // Advanced filters
        if (filters.price.min !== null) params.set('price_min', filters.price.min.toString())
        if (filters.price.max !== null) params.set('price_max', filters.price.max.toString())
        if (filters.squareMeters.min !== null) params.set('sqm_min', filters.squareMeters.min.toString())
        if (filters.squareMeters.max !== null) params.set('sqm_max', filters.squareMeters.max.toString())
        if (filters.bedrooms.min !== null) params.set('bedrooms_min', filters.bedrooms.min.toString())
        if (filters.bathrooms.min !== null) params.set('bathrooms_min', filters.bathrooms.min.toString())
        if (filters.location) params.set('location', filters.location)
        if (filters.characteristics.length > 0) params.set('characteristics', filters.characteristics.join(','))
        if (filters.propertyTypes.length > 0) params.set('property_type', filters.propertyTypes.join(','))
        if (filters.furnished !== null) params.set('furnished', filters.furnished ? 'true' : 'false')
        if (filters.yearBuilt.min !== null) params.set('year_built_min', filters.yearBuilt.min.toString())
        if (filters.yearBuilt.max !== null) params.set('year_built_max', filters.yearBuilt.max.toString())
        if (filters.energyRating) params.set('energy_rating', filters.energyRating)
        if (filters.view) params.set('view', filters.view)
        if (filters.orientation) params.set('orientation', filters.orientation)
        if (filters.geoShape) {
          if (filters.geoShape.type === 'circle' && filters.geoShape.center && filters.geoShape.radius != null) {
            params.set('geo_circle', `${filters.geoShape.center[0]},${filters.geoShape.center[1]},${filters.geoShape.radius}`)
          } else if (filters.geoShape.coordinates) {
            params.set('geo_polygon', JSON.stringify(filters.geoShape.coordinates))
          }
        }

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
  }, [page, sortBy, operation, advertiser, onlyWithDrops, search, filters])

  const openFiltersPanel = useCallback(() => {
    setShowFiltersPanel((v) => !v)
  }, [])

  const handleApplyFilters = () => {
    setShowFiltersPanel(false)
  }

  const handleClearFilters = () => {
    setFilters({
      operation: 'all',
      advertiserType: 'all',
      advertiserFilter: {
        mode: 'all',
        particularOptions: {
          onlyParticular: false,
          isPrivateByAgency: false,
          wasPrivateByAgency: false,
        },
        agencyOptions: {
          agencyId: null,
          agencyName: null,
          exclusive: false,
          exclusiveMode: 'both',
          excludeAgencyId: null,
        },
      },
      propertyTypes: [],
      price: { min: null, max: null },
      squareMeters: { min: null, max: null },
      pricePerSqm: { min: null, max: null },
      bedrooms: { min: null, max: null },
      bathrooms: { min: null, max: null },
      yearBuilt: { min: null, max: null },
      daysOnMarket: { min: null, max: null },
      parcelSize: { min: null, max: null },
      floor: null,
      view: null,
      orientation: null,
      furnished: null,
      energyRating: null,
      characteristics: [],
      location: null,
      distance: null,
      selected_district_id: null,
      selected_zone_id: null,
      selected_subzone_id: null,
      geoShape: null,
    })
    setShowFiltersPanel(false)
  }

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

        {/* Más filtros button */}
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
            <span className="text-[10px] bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

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
        {/* Desktop Filter Panel Sidebar */}
        {showFiltersPanel && (
          <FilterPanel
            filters={filters}
            onFilterChange={setFilters}
            onApply={handleApplyFilters}
            onClear={handleClearFilters}
            isOpen={showFiltersPanel}
            onClose={() => setShowFiltersPanel(false)}
          />
        )}

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
              onShapeDrawn={(shape) => {
                setFilters(prev => ({ ...prev, geoShape: shape }))
                setPage(1)
              }}
              activeShape={filters.geoShape}
            />
          </div>
        )}
      </div>
    </div>
  )
}
