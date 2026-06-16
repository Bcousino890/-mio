'use client'

import type { Listing } from '@/lib/mock-listings'
import { Bed, Bath, Maximize2, Clock, TrendingDown, MapPin, Building2, User } from 'lucide-react'

function fmt(n: number) {
  return n.toLocaleString('es-ES')
}

interface Props {
  listing: Listing
  active?: boolean
  onClick?: () => void
}

export default function PropertyCard({ listing: l, active, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer border rounded-xl overflow-hidden transition-all hover:border-blue-500/40 ${
        active
          ? 'border-blue-500 bg-[#111827]'
          : 'border-[#1e2130] bg-[#0f1117] hover:bg-[#111218]'
      }`}
    >
      {/* Photo placeholder */}
      <div className="relative h-36 bg-[#1a1f2e] flex items-center justify-center">
        <Building2 size={28} className="text-slate-700" />

        {/* Badges top-left */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {l.days_on_market > 0 && (
            <span className="text-[10px] bg-black/70 text-slate-300 px-2 py-0.5 rounded">
              {l.days_on_market}d en mercado
            </span>
          )}
          {l.price_drops > 0 && (
            <span className="text-[10px] bg-green-900/80 text-green-300 px-2 py-0.5 rounded flex items-center gap-1">
              <TrendingDown size={10} />
              {l.price_drops} bajada{l.price_drops > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* RC badge top-right */}
        {l.rc_status !== 'none' && (
          <div className="absolute top-2 right-2">
            <span className="text-[10px] bg-purple-900/80 text-purple-300 px-2 py-0.5 rounded">
              Ubicación exacta
            </span>
          </div>
        )}

        {/* Price overlay bottom */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
          <span className="text-white font-bold text-sm">
            {l.operation === 'sale' ? '' : ''}
            {fmt(l.price)}{l.operation === 'sale' ? ' €' : ' €/mes'}
          </span>
          <span className="text-slate-400 text-xs ml-2">
            ({fmt(l.price_sqm)} €/m²)
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="px-3 py-2.5">
        <p className="text-slate-200 text-sm font-medium leading-snug line-clamp-1 mb-2">
          {l.title}
        </p>

        {/* Specs row */}
        <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
          <span className="flex items-center gap-1">
            <Bed size={12} /> {l.bedrooms > 0 ? l.bedrooms : 'Est.'}
          </span>
          <span className="flex items-center gap-1">
            <Bath size={12} /> {l.bathrooms}
          </span>
          <span className="flex items-center gap-1">
            <Maximize2 size={12} /> {l.square_meters} m²
          </span>
          {l.floor && (
            <span className="text-slate-600">{l.floor}</span>
          )}
        </div>

        {/* Source info */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {l.advertiser_type === 'particular' ? (
              <User size={11} className="text-amber-400" />
            ) : (
              <Building2 size={11} className="text-slate-500" />
            )}
            <span className="text-xs text-slate-600 truncate max-w-[120px]">
              {l.advertiser_name}
            </span>
          </div>
          {l.listing_count > 1 && (
            <span className="text-[11px] text-blue-400 bg-blue-950/50 px-2 py-0.5 rounded">
              {l.listing_count} fuentes
            </span>
          )}
        </div>

        {/* Zone */}
        <div className="flex items-center gap-1 mt-1.5">
          <MapPin size={10} className="text-slate-700" />
          <span className="text-[11px] text-slate-600">{l.zone_name}</span>
        </div>
      </div>
    </div>
  )
}
