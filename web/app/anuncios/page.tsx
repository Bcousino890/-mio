'use client'

import { useState, useMemo, useEffect } from 'react'
import nextDynamicImport from 'next/dynamic'
import PropertyCard from '@/components/PropertyCard'
import { mockListings } from '@/lib/mock-listings'
import { SlidersHorizontal, Map, LayoutList, ChevronDown, Search } from 'lucide-react'
import type { Listing } from '@/lib/mock-listings'

// Evita que Next.js cachee esta ruta como página estática (Full Route Cache):
// el contenido real depende de un fetch en cliente, no de datos en build time.
export const dynamic = 'force-dynamic'

const PropertyMap = nextDynamicImport(() => import('@/components/map/PropertyMap'), { ssr: false })

type Operation = 'all' | 'sale' | 'rent'
type AdvertiserFilter = 'all' | 'particular' | 'professional'
type SortKey = 'days' | 'price_asc' | 'price_desc' | 'sqm'

const SORT_LABELS: Record<SortKey, string> = {
  days: 'Más recientes',
  price_asc: 'Precio: menor a mayor',
  price_desc: 'Precio: mayor a menor',
  sqm: '€/m² menor',
}

export default function AnunciosPage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [operation, setOperation] = useState<Operation>('all')
  const [advertiser, setAdvertiser] = useState<AdvertiserFilter>('all')
  const [showMap, setShowMap] = useState(true)
  const [onlyWithDrops, setOnlyWithDrops] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('days')
  const [showSortMenu, setShowSortMenu] = useState(false)

  const combinedActive = hoverId ?? activeId

  // Load listings from API on mount
  useEffect(() => {
    const fetchListings = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/listings?limit=5000')
        if (!response.ok) throw new Error('Failed to fetch listings')
        const result = await response.json()
        if (result.success && Array.isArray(result.data)) {
          // Transform raw DB data to Listing type
          const transformed = result.data.map((row: any): Listing => {
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
              zone_name: row.zone_name || 'Unknown',
              portal,
              source_type: 'portal' as const,
              advertiser_type: row.advertiser_type || 'professional',
              advertiser_name: row.advertiser_name || 'Idealista',
              days_on_market: row.days_on_market || 0,
              is_active: row.is_active !== false,
              latitude: row.latitude || 40.43,
              longitude: row.longitude || -3.68,
              photos: Array.isArray(row.photos) ? row.photos : (typeof row.photos === 'string' ? [] : []),
              source_url: row.source_url || '',
              listing_count: 1,
              portals: [portal],
              price_drops: 0,
              rc_status: 'none' as const,
              description: row.description,
              features: Array.isArray(row.features) ? row.features : (typeof row.features === 'string' ? [] : []),
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
          })
          setListings(transformed)
          setError(null)
        }
      } catch (err) {
        console.error('Error loading listings:', err)
        setError(err instanceof Error ? err.message : 'Error loading listings')
        // Fallback to mock listings if API fails
        setListings(mockListings)
      } finally {
        setLoading(false)
      }
    }
    fetchListings()
  }, [])

  const filtered = useMemo(() => {
    return listings
      .filter((l) => operation === 'all' || l.operation === operation)
      .filter((l) => advertiser === 'all' || l.advertiser_type === advertiser)
      .filter((l) => !onlyWithDrops || l.price_drops > 0)
      .sort((a, b) => {
        switch (sortBy) {
          case 'days': return a.days_on_market - b.days_on_market
          case 'price_asc': return a.price - b.price
          case 'price_desc': return b.price - a.price
          case 'sqm': return a.price_sqm - b.price_sqm
        }
      })
  }, [listings, operation, advertiser, onlyWithDrops, sortBy])

  return (
    <div className="flex flex-col h-full bg-[var(--c-bg)]">
      {/* ── Filter bar ── */}
      <header className="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-[var(--c-border)] bg-[var(--c-bg)] flex-wrap">

        {/* Search input */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
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
              <span className="text-slate-300 font-semibold">{filtered.length}</span>
              {' '}de{' '}
              <span className="text-slate-400">{listings.length}</span> anuncios
              {showMap && <span className="text-slate-700"> en el mapa</span>}
            </p>
          </div>

          {/* Cards grid */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-700">
                <p className="text-sm font-medium">Cargando anuncios…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-700">
                <p className="text-sm font-medium">Sin resultados</p>
                <p className="text-xs mt-1">Ajusta los filtros para ver más anuncios</p>
              </div>
            ) : (
              <div className={`grid gap-3 ${showMap ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {filtered.map((listing) => (
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
        </div>

        {/* Map panel */}
        {showMap && (
          <div className="flex-1 relative border-l border-[var(--c-border)]">
            <PropertyMap
              listings={filtered}
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
