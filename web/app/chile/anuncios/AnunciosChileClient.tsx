'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import nextDynamicImport from 'next/dynamic'
import PropertyCard from '@/components/PropertyCard'
import { SlidersHorizontal, Map, ChevronDown, ChevronLeft, ChevronRight, X, Menu } from 'lucide-react'
import type { Listing } from '@/lib/types'

const PropertyMap = nextDynamicImport(() => import('@/components/map/PropertyMap'), { ssr: false })

type Operation = 'all' | 'sale' | 'rent'
type AdvertiserFilter = 'all' | 'particular' | 'professional'
type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'sqm'

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Más recientes',
  price_asc: 'Precio: menor a mayor',
  price_desc: 'Precio: mayor a menor',
  sqm: '$/m² menor',
}

const PAGE_SIZE = 30

function transformChileRow(row: any): Listing {
  const portal = row.portal || 'portalinmobiliario'
  const price = row.price || 0
  const listedDate = new Date().toISOString().split('T')[0]
  // El sector/barrio (localidad, ej. "Vaticano", "La Llavería") es más específico
  // que la comuna — cuando existe, se antepone para que la ficha no muestre solo
  // "Las Condes" cuando el propio anuncio ya declara el sector exacto.
  const zoneName = row.localidad && row.comuna_name
    ? `${row.localidad}, ${row.comuna_name}`
    : (row.comuna_name || 'Sin comuna')

  return {
    id: row.id || row.external_id,
    property_id: row.external_id,
    title: `${row.bedrooms || '?'} dorm · ${row.square_meters || '?'} m² · ${row.comuna_name || 'Chile'}`,
    operation: row.operation || 'sale',
    price,
    currency: 'CLP' as const,
    price_uf: row.price_uf != null ? Number(row.price_uf) : null,
    square_meters: row.square_meters || 0,
    price_sqm: row.price_sqm || 0,
    bedrooms: row.bedrooms || 0,
    bathrooms: row.bathrooms || 0,
    zone_name: zoneName,
    barrio: row.localidad || undefined,
    portal,
    source_type: 'portal' as const,
    advertiser_type: row.advertiser_type || 'professional',
    advertiser_name: row.advertiser_name || 'Inmobiliario',
    days_on_market: row.days_on_market || 0,
    is_active: row.is_active !== false,
    latitude: row.latitude ? parseFloat(row.latitude) : -33.8688,
    longitude: row.longitude ? parseFloat(row.longitude) : -51.2093,
    photos: Array.isArray(row.photos) ? row.photos.filter((p: any) => typeof p === 'string') : [],
    source_url: row.source_url || '',
    listing_count: 1,
    portals: [portal],
    price_drops: 0,
    rc_status: 'none' as const,
    description: row.description,
    features: Array.isArray(row.features) ? row.features.filter((f: any) => typeof f === 'string') : [],
    videos: row.has_video && row.video_modal_url ? [row.video_modal_url] : [],
    priceHistory: [{ date: listedDate, price, event: 'listed' as const }],
    sources: [{
      id: row.external_id,
      type: row.advertiser_type === 'particular' ? 'particular' : 'agency',
      name: row.advertiser_name || 'Portal Inmobiliario',
      portal,
      price,
      status: 'active' as const,
      listed_at: listedDate,
      url: row.source_url || '',
      is_particular: row.advertiser_type === 'particular',
    }],
  }
}

export default function AnunciosChileClient() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [operation, setOperation] = useState<Operation>('sale')
  const [advertiser, setAdvertiser] = useState<AdvertiserFilter>('all')
  const [showMap, setShowMap] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('recent')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFiltersPanel, setShowFiltersPanel] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [priceMin, setPriceMin] = useState<number | null>(null)
  const [priceMax, setPriceMax] = useState<number | null>(null)
  const [sqmMin, setSqmMin] = useState<number | null>(null)
  const [sqmMax, setSqmMax] = useState<number | null>(null)
  const [bedroomsMin, setBedroomsMin] = useState<number | null>(null)
  const [bathroomsMin, setBathroomsMin] = useState<number | null>(null)
  const [identityResolved, setIdentityResolved] = useState(false)
  // SSR-safe desktop detection: window is not available during server render,
  // so we resolve isDesktop after mount and keep it updated on resize.
  const [isDesktop, setIsDesktop] = useState(false)

  const combinedActive = hoverId ?? activeId
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 1024)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  useEffect(() => { setPage(1) }, [operation, advertiser, sortBy, priceMin, priceMax, sqmMin, sqmMax, bedroomsMin, bathroomsMin, identityResolved])

  const getActiveFilterCount = (): number => {
    let count = 0
    if (priceMin !== null || priceMax !== null) count++
    if (sqmMin !== null || sqmMax !== null) count++
    if (bedroomsMin !== null) count++
    if (bathroomsMin !== null) count++
    if (operation !== 'all') count++
    if (advertiser !== 'all') count++
    if (identityResolved) count++
    return count
  }

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.append('page', String(page))
    params.append('page_size', String(PAGE_SIZE))
    params.append('sort', sortBy)

    if (operation !== 'all') params.append('operation', operation)
    if (advertiser !== 'all') params.append('advertiser_type', advertiser)
    if (search) params.append('q', search)
    if (priceMin !== null) params.append('price_min', String(priceMin))
    if (priceMax !== null) params.append('price_max', String(priceMax))
    if (sqmMin !== null) params.append('sqm_min', String(sqmMin))
    if (sqmMax !== null) params.append('sqm_max', String(sqmMax))
    if (bedroomsMin !== null) params.append('bedrooms_min', String(bedroomsMin))
    if (bathroomsMin !== null) params.append('bathrooms_min', String(bathroomsMin))
    if (identityResolved) params.append('only_identity_resolved', 'true')

    fetch(`/api/chile/anuncios?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          setListings(data.data.map(transformChileRow))
          setTotal(data.total)
          setTotalPages(data.total_pages)
        } else {
          setListings([])
          setTotal(0)
          setTotalPages(1)
        }
      })
      .catch(err => {
        console.error('Error fetching listings:', err)
        setListings([])
      })
      .finally(() => setLoading(false))
  }, [page, sortBy, operation, advertiser, search, priceMin, priceMax, sqmMin, sqmMax, bedroomsMin, bathroomsMin, identityResolved])

  const handlePrevPage = useCallback(() => {
    setPage(Math.max(1, page - 1))
  }, [page])

  const handleNextPage = useCallback(() => {
    setPage(Math.min(totalPages, page + 1))
  }, [page, totalPages])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Mobile header */}
      <div className="sticky top-0 z-40 lg:hidden bg-slate-800/95 border-b border-slate-700 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex-1 flex gap-1">
            <button
              onClick={() => setShowMap(!showMap)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                showMap ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Map size={14} />
              Mapa
            </button>
            <button
              onClick={() => setShowFiltersPanel(!showFiltersPanel)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                getActiveFilterCount() > 0 ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <SlidersHorizontal size={14} />
              Filtros {getActiveFilterCount() > 0 && `(${getActiveFilterCount()})`}
            </button>
          </div>
          <Menu size={16} className="text-slate-400" />
        </div>
        <div className="flex gap-1">
          <input
            type="text"
            placeholder="Buscar..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 px-3 py-1.5 rounded text-sm placeholder-slate-500 focus:outline-none focus:border-blue-400"
          />
          {searchInput && (
            <button onClick={() => setSearchInput('')} className="text-slate-400 hover:text-slate-200">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 h-screen">
        {/* Sidebar & Results */}
        <div className="lg:col-span-1 flex flex-col overflow-hidden">
          {/* Filters Panel */}
          {(showFiltersPanel || isDesktop) && (
            <div className="flex-1 overflow-y-auto bg-slate-800 border-r border-slate-700 p-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-2">Operación</label>
                  <select
                    value={operation}
                    onChange={e => setOperation(e.target.value as Operation)}
                    className="w-full bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                  >
                    <option value="all">Todas</option>
                    <option value="sale">Venta</option>
                    <option value="rent">Arriendo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-2">Anunciante</label>
                  <select
                    value={advertiser}
                    onChange={e => setAdvertiser(e.target.value as AdvertiserFilter)}
                    className="w-full bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                  >
                    <option value="all">Todas</option>
                    <option value="professional">Corredoras</option>
                    <option value="particular">Particulares</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-2">Precio (CLP)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      value={priceMin ?? ''}
                      onChange={e => setPriceMin(e.target.value ? Number(e.target.value) : null)}
                      className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={priceMax ?? ''}
                      onChange={e => setPriceMax(e.target.value ? Number(e.target.value) : null)}
                      className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-2">m² construidos</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      value={sqmMin ?? ''}
                      onChange={e => setSqmMin(e.target.value ? Number(e.target.value) : null)}
                      className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={sqmMax ?? ''}
                      onChange={e => setSqmMax(e.target.value ? Number(e.target.value) : null)}
                      className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Dormitorios</label>
                    <input
                      type="number"
                      placeholder="Min"
                      value={bedroomsMin ?? ''}
                      onChange={e => setBedroomsMin(e.target.value ? Number(e.target.value) : null)}
                      className="w-full bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-slate-400 mb-2">Baños</label>
                    <input
                      type="number"
                      placeholder="Min"
                      value={bathroomsMin ?? ''}
                      onChange={e => setBathroomsMin(e.target.value ? Number(e.target.value) : null)}
                      className="w-full bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={identityResolved}
                    onChange={e => setIdentityResolved(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-300">Solo con identidad confirmada (Rol SII)</span>
                </label>
              </div>
            </div>
          )}

          {/* Toolbar: result count + sort */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-800 border-t border-b border-slate-700">
            <span className="text-xs text-slate-400">
              {loading ? 'Cargando…' : `${total.toLocaleString('es-CL')} anuncios`}
            </span>
            <div className="relative">
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className="flex items-center gap-1 text-xs text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors"
              >
                {SORT_LABELS[sortBy]}
                <ChevronDown size={14} />
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden min-w-[180px]">
                  {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
                    <button
                      key={key}
                      onClick={() => { setSortBy(key); setShowSortMenu(false) }}
                      className={`block w-full text-left px-3 py-2 text-xs transition-colors ${
                        sortBy === key ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {SORT_LABELS[key]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Results List */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center p-8">
                <div className="text-slate-400">Cargando...</div>
              </div>
            )}
            {!loading && listings.length === 0 && (
              <div className="flex items-center justify-center p-8">
                <div className="text-slate-400">Sin resultados</div>
              </div>
            )}
            {listings.map(listing => (
              <div
                key={listing.id}
                onClick={() => setActiveId(listing.id)}
                className="border-b border-slate-700 last:border-b-0 cursor-pointer hover:bg-slate-700/50 transition-colors p-3"
              >
                <PropertyCard
                  listing={listing}
                  active={combinedActive === listing.id}
                  onHover={setHoverId}
                  onOpen={(l) => {
                    // Chile no tiene ficha propia por anuncio todavía (/anuncios/[id]
                    // es la tabla de España): abrir el aviso original en vez de un 404.
                    if (l.source_url) window.open(l.source_url, '_blank', 'noopener,noreferrer')
                  }}
                />
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-slate-700 bg-slate-800/50">
                <button
                  onClick={handlePrevPage}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                >
                  <ChevronLeft size={16} />
                  Anterior
                </button>
                <span className="text-xs text-slate-400">
                  {page} / {totalPages} · {total} total
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                >
                  Siguiente
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        {(showMap || isDesktop) && (
          <div className="hidden lg:block lg:col-span-2 h-screen">
            <PropertyMap
              listings={listings}
              activeId={combinedActive}
              onMarkerClick={(id) => setActiveId(id)}
              onMarkerHover={(id) => setHoverId(id)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
