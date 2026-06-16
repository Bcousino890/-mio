'use client'

import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import PropertyCard from '@/components/PropertyCard'
import { mockListings } from '@/lib/mock-listings'
import { SlidersHorizontal, LayoutList, Map, TrendingDown, User, Building2 } from 'lucide-react'

const PropertyMap = dynamic(() => import('@/components/map/PropertyMap'), { ssr: false })

type Operation = 'all' | 'sale' | 'rent'
type AdvertiserFilter = 'all' | 'particular' | 'professional'

export default function AnunciosPage() {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [operation, setOperation] = useState<Operation>('all')
  const [advertiser, setAdvertiser] = useState<AdvertiserFilter>('all')
  const [showMap, setShowMap] = useState(true)
  const [onlyWithDrops, setOnlyWithDrops] = useState(false)
  const [sortBy, setSortBy] = useState<'days' | 'price' | 'sqm'>('days')

  const filtered = useMemo(() => {
    return mockListings
      .filter((l) => operation === 'all' || l.operation === operation)
      .filter((l) => advertiser === 'all' || l.advertiser_type === advertiser)
      .filter((l) => !onlyWithDrops || l.price_drops > 0)
      .sort((a, b) => {
        if (sortBy === 'days') return b.days_on_market - a.days_on_market
        if (sortBy === 'price') return a.price - b.price
        if (sortBy === 'sqm') return a.price_sqm - b.price_sqm
        return 0
      })
  }, [operation, advertiser, onlyWithDrops, sortBy])

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <header className="flex items-center gap-2 px-4 py-3 border-b border-[#1e2130] bg-[#0a0d14] flex-wrap">
        <h1 className="text-sm font-semibold text-slate-200 mr-2">Anuncios</h1>

        {/* Operation filter */}
        <div className="flex rounded-lg border border-[#2d3447] overflow-hidden text-xs">
          {(['all', 'sale', 'rent'] as const).map((op) => (
            <button
              key={op}
              onClick={() => setOperation(op)}
              className={`px-3 py-1.5 transition-all ${
                operation === op
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-[#1a1f2e] hover:text-slate-200'
              }`}
            >
              {op === 'all' ? 'Todo' : op === 'sale' ? 'En venta' : 'Alquiler'}
            </button>
          ))}
        </div>

        {/* Advertiser filter */}
        <div className="flex rounded-lg border border-[#2d3447] overflow-hidden text-xs">
          <button
            onClick={() => setAdvertiser('all')}
            className={`px-3 py-1.5 flex items-center gap-1.5 transition-all ${
              advertiser === 'all' ? 'bg-[#1e2a45] text-blue-300' : 'text-slate-400 hover:bg-[#1a1f2e]'
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setAdvertiser('particular')}
            className={`px-3 py-1.5 flex items-center gap-1.5 transition-all ${
              advertiser === 'particular' ? 'bg-amber-900/40 text-amber-300' : 'text-slate-400 hover:bg-[#1a1f2e]'
            }`}
          >
            <User size={11} /> Particular
          </button>
          <button
            onClick={() => setAdvertiser('professional')}
            className={`px-3 py-1.5 flex items-center gap-1.5 transition-all ${
              advertiser === 'professional' ? 'bg-[#1e2a45] text-blue-300' : 'text-slate-400 hover:bg-[#1a1f2e]'
            }`}
          >
            <Building2 size={11} /> Agencia
          </button>
        </div>

        {/* Price drops toggle */}
        <button
          onClick={() => setOnlyWithDrops(!onlyWithDrops)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${
            onlyWithDrops
              ? 'border-green-600 bg-green-900/30 text-green-300'
              : 'border-[#2d3447] text-slate-400 hover:bg-[#1a1f2e]'
          }`}
        >
          <TrendingDown size={12} />
          Con bajadas
        </button>

        <div className="flex-1" />

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="text-xs bg-[#0f1117] border border-[#2d3447] text-slate-400 rounded-lg px-2 py-1.5 cursor-pointer"
        >
          <option value="days">Días en mercado</option>
          <option value="price">Precio ↑</option>
          <option value="sqm">€/m² ↑</option>
        </select>

        {/* View toggle */}
        <div className="flex rounded-lg border border-[#2d3447] overflow-hidden">
          <button
            onClick={() => setShowMap(true)}
            className={`px-2.5 py-1.5 transition-all ${showMap ? 'bg-[#1e2a45] text-blue-300' : 'text-slate-500 hover:bg-[#1a1f2e]'}`}
          >
            <Map size={14} />
          </button>
          <button
            onClick={() => setShowMap(false)}
            className={`px-2.5 py-1.5 transition-all ${!showMap ? 'bg-[#1e2a45] text-blue-300' : 'text-slate-500 hover:bg-[#1a1f2e]'}`}
          >
            <LayoutList size={14} />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: list */}
        <div
          className={`overflow-y-auto flex-shrink-0 ${
            showMap ? 'w-[420px]' : 'flex-1'
          } border-r border-[#1e2130]`}
        >
          {/* Count bar */}
          <div className="sticky top-0 z-10 px-4 py-2 bg-[#0a0d14] border-b border-[#1a1f2e]">
            <p className="text-xs text-slate-500">
              <span className="text-slate-200 font-semibold">{filtered.length}</span> propiedades
              {operation !== 'all' && ` · ${operation === 'sale' ? 'venta' : 'alquiler'}`}
              {advertiser !== 'all' && ` · ${advertiser}`}
              <span className="ml-2 text-slate-700">— datos mock</span>
            </p>
          </div>

          <div className={`p-3 ${showMap ? '' : 'grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3'}`}>
            {filtered.map((l) => (
              <div key={l.id} className={showMap ? 'mb-2' : ''}>
                <PropertyCard
                  listing={l}
                  active={activeId === l.id}
                  onClick={() => setActiveId(activeId === l.id ? null : l.id)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Right: map */}
        {showMap && (
          <div className="flex-1 relative">
            <PropertyMap
              listings={filtered}
              activeId={activeId}
              onMarkerClick={(id) => setActiveId(activeId === id ? null : id)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
