'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import nextDynamicImport from 'next/dynamic'
import PropertyCard from '@/components/PropertyCard'
import PropertyClModal, { type Property as PropertyCl, clp } from '@/components/chile/PropertyClModal'
import { SlidersHorizontal, Map, ChevronDown, ChevronLeft, ChevronRight, X, Menu } from 'lucide-react'
import type { Listing } from '@/lib/types'
import type { GeoShapeFilter } from '@/components/filters/FilterPanel'
import { useUfRateCl } from '@/hooks/useUfRateCl'

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
    // Antes -51.2093: no es Chile (cae en el Atlántico), copiado por error del
    // fallback de otra región. Sin coordenadas, centrar en Santiago.
    longitude: row.longitude ? parseFloat(row.longitude) : -70.6693,
    photos: Array.isArray(row.photos) ? row.photos.filter((p: any) => typeof p === 'string') : [],
    source_url: row.source_url || '',
    listing_count: 1,
    portals: [portal],
    price_drops: 0,
    rc_status: 'none' as const,
    description: row.description,
    features: Array.isArray(row.features) ? row.features.filter((f: any) => typeof f === 'string') : [],
    videos: row.has_video && row.video_modal_url ? [row.video_modal_url] : [],
    property_cl_id: row.property_cl_id ?? null,
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
  // Mapa con dibujo (polígono/rectángulo/círculo) para acotar la búsqueda a una
  // zona — mismos parámetros geo_circle/geo_polygon que ya entiende
  // /api/chile/anuncios.
  const [geoShape, setGeoShape] = useState<GeoShapeFilter | null>(null)
  // Precio en CLP o UF: priceMin/priceMax siguen viajando en CLP, el toggle
  // solo cambia la unidad en la que se leen/escriben los inputs.
  const [priceUnit, setPriceUnit] = useState<'clp' | 'uf'>('clp')
  const { rate: ufRate, date: ufRateDate } = useUfRateCl()
  // SSR-safe desktop detection: window is not available during server render,
  // so we resolve isDesktop after mount and keep it updated on resize.
  const [isDesktop, setIsDesktop] = useState(false)
  // Ficha del inmueble (property_cl) abierta desde la lista — la MISMA que en
  // /chile/propiedades, en vez de mandar al portal original en otra pestaña.
  const [ficha, setFicha] = useState<PropertyCl | null>(null)
  const [fichaLoading, setFichaLoading] = useState<string | null>(null)

  const combinedActive = hoverId ?? activeId
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Abre la ficha canónica del inmueble al que pertenece el aviso. Todo anuncio
  // tiene su property_cl desde el dedup por corredora + código interno (0078);
  // si por lo que sea faltara, se cae al comportamiento anterior (abrir el
  // aviso original) en vez de dejar el clic sin respuesta.
  const openFicha = useCallback(async (l: Listing) => {
    if (!l.property_cl_id) {
      if (l.source_url) window.open(l.source_url, '_blank', 'noopener,noreferrer')
      return
    }
    setFichaLoading(l.id)
    try {
      const res = await fetch(`/api/chile/property-cl?id=${encodeURIComponent(l.property_cl_id)}`)
      const data = await res.json()
      if (data.success && data.data) setFicha(data.data)
      else if (l.source_url) window.open(l.source_url, '_blank', 'noopener,noreferrer')
    } catch {
      if (l.source_url) window.open(l.source_url, '_blank', 'noopener,noreferrer')
    } finally {
      setFichaLoading(null)
    }
  }, [])

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

  useEffect(() => { setPage(1) }, [operation, advertiser, sortBy, priceMin, priceMax, sqmMin, sqmMax, bedroomsMin, bathroomsMin, identityResolved, geoShape])

  const getActiveFilterCount = (): number => {
    let count = 0
    if (priceMin !== null || priceMax !== null) count++
    if (sqmMin !== null || sqmMax !== null) count++
    if (bedroomsMin !== null) count++
    if (bathroomsMin !== null) count++
    if (operation !== 'all') count++
    if (advertiser !== 'all') count++
    if (identityResolved) count++
    if (geoShape) count++
    return count
  }

  // Mismos filtros para dos consumidores (la lista paginada y el mapa, que
  // pide un lote propio más grande — ver más abajo).
  const buildFilterParams = useCallback((pageArg: number, pageSizeArg: number) => {
    const params = new URLSearchParams()
    params.append('page', String(pageArg))
    params.append('page_size', String(pageSizeArg))
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
    if (geoShape) {
      if (geoShape.type === 'circle' && geoShape.center && geoShape.radius != null) {
        params.append('geo_circle', `${geoShape.center[0]},${geoShape.center[1]},${geoShape.radius}`)
      } else if (geoShape.coordinates) {
        params.append('geo_polygon', JSON.stringify(geoShape.coordinates))
      }
    }
    return params
  }, [sortBy, operation, advertiser, search, priceMin, priceMax, sqmMin, sqmMax, bedroomsMin, bathroomsMin, identityResolved, geoShape])

  useEffect(() => {
    setLoading(true)
    const params = buildFilterParams(page, PAGE_SIZE)

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
  }, [page, buildFilterParams])

  // Mapa: pide un lote propio (tope del backend, 200) independiente de la
  // página de la lista — si no, dibujar una zona con más de 30 resultados
  // (PAGE_SIZE) solo mostraba la primera página de pines en el mapa aunque la
  // lista de la izquierda sí paginara sobre el total real.
  const [mapListings, setMapListings] = useState<Listing[]>([])
  const [mapTotal, setMapTotal] = useState(0)
  const [mapLoading, setMapLoading] = useState(false)
  const MAP_PAGE_SIZE = 200

  useEffect(() => {
    setMapLoading(true)
    const params = buildFilterParams(1, MAP_PAGE_SIZE)
    fetch(`/api/chile/anuncios?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) { setMapListings(data.data.map(transformChileRow)); setMapTotal(data.total) }
        else { setMapListings([]); setMapTotal(0) }
      })
      .catch(() => { setMapListings([]); setMapTotal(0) })
      .finally(() => setMapLoading(false))
  }, [buildFilterParams])

  const handlePrevPage = useCallback(() => {
    setPage(Math.max(1, page - 1))
  }, [page])

  const handleNextPage = useCallback(() => {
    setPage(Math.min(totalPages, page + 1))
  }, [page, totalPages])

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
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-slate-400">Precio ({priceUnit === 'uf' ? 'UF' : 'CLP'})</label>
                    <div className="flex rounded-md overflow-hidden border border-slate-600 shrink-0">
                      <button type="button" onClick={() => setPriceUnit('clp')}
                        className={`px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${priceUnit === 'clp' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}>CLP</button>
                      <button type="button" onClick={() => setPriceUnit('uf')} disabled={!ufRate}
                        title={ufRate ? `1 UF = ${clp(ufRate)} (${ufRateDate})` : 'Cargando tasa UF…'}
                        className={`px-1.5 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${priceUnit === 'uf' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}>UF</button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      value={priceMinDisplay}
                      onChange={e => setPriceMinFromInput(e.target.value)}
                      className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 px-3 py-2 rounded text-sm focus:outline-none focus:border-blue-400"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      value={priceMaxDisplay}
                      onChange={e => setPriceMaxFromInput(e.target.value)}
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
                className={`relative border-b border-slate-700 last:border-b-0 cursor-pointer hover:bg-slate-700/50 transition-colors p-3 ${fichaLoading === listing.id ? 'opacity-60' : ''}`}
              >
                {fichaLoading === listing.id && (
                  <span className="absolute z-10 top-4 right-4 text-[11px] px-2 py-1 rounded-full bg-black/70 text-slate-200">Abriendo ficha…</span>
                )}
                <PropertyCard
                  listing={listing}
                  active={combinedActive === listing.id}
                  onHover={setHoverId}
                  onOpen={openFicha}
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

        {/* Map — pinta hasta 200 anuncios del filtro actual (lote propio,
            independiente de la página de la lista de la izquierda). */}
        {(showMap || isDesktop) && (
          <div className="hidden lg:flex lg:col-span-2 h-screen flex-col">
            <div className="flex-none px-3 py-1.5 text-[11px] text-slate-400 bg-slate-800 border-b border-slate-700">
              {mapLoading
                ? 'Cargando mapa…'
                : mapTotal > mapListings.length
                  ? `Mostrando ${mapListings.length.toLocaleString('es-CL')} de ${mapTotal.toLocaleString('es-CL')} anuncios en el mapa`
                  : `${mapTotal.toLocaleString('es-CL')} anuncio${mapTotal === 1 ? '' : 's'} en el mapa`}
            </div>
            <div className="flex-1 min-h-0 relative">
              <PropertyMap
                listings={mapListings}
                activeId={combinedActive}
                onMarkerClick={(id) => setActiveId(id)}
                onMarkerHover={(id) => setHoverId(id)}
                onShapeDrawn={setGeoShape}
                activeShape={geoShape}
                tileStyle="satellite"
              />
            </div>
          </div>
        )}
      </div>

      {/* Ficha del inmueble — la misma de /chile/propiedades (galería por
          corredora, mapa con pin manual, unir/separar). */}
      {ficha && (
        <PropertyClModal
          p={ficha}
          onClose={() => setFicha(null)}
          onRefetched={setFicha}
          onSplit={() => { /* separar fichas no cambia la lista de anuncios */ }}
        />
      )}
    </div>
  )
}
