'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Listing } from '@/lib/types'
import { ChevronLeft, ChevronRight, MoreHorizontal, MapPin } from 'lucide-react'

const BADGE_DOT: Record<string, string> = {
  green:  'bg-emerald-400',
  amber:  'bg-amber-400',
  red:    'bg-red-400',
  blue:   'bg-blue-400',
  purple: 'bg-violet-400',
  orange: 'bg-orange-400',
}

function fmt(n: number) {
  return n.toLocaleString('es-ES')
}

/** Precio formateado según la moneda del listing. CLP (Chile) sin decimales,
 * con símbolo $; EUR (España, comportamiento histórico) sin cambios. */
function fmtPrice(n: number, currency: Listing['currency']) {
  if (currency === 'CLP') return n.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
  return `${fmt(n)} €`
}

function daysLabel(d: number) {
  if (d === 0) return 'Hoy'
  if (d === 1) return 'Hace 1 día'
  if (d < 30) return `Hace ${d} días`
  if (d < 60) return 'Hace 1 mes'
  return `Hace ${Math.round(d / 30)} meses`
}

interface Props {
  listing: Listing
  active?: boolean
  onHover?: (id: string | null) => void
  /** Override de navegación al hacer click (por defecto: /anuncios/{id}, España).
   * Chile no tiene ficha propia por anuncio todavía: se pasa un callback que
   * abre el aviso original en vez de un 404 contra la tabla de España. */
  onOpen?: (listing: Listing) => void
}

export default function PropertyCard({ listing: l, active, onHover, onOpen }: Props) {
  const router = useRouter()
  const [photoIdx, setPhotoIdx] = useState(0)
  const isClp = l.currency === 'CLP'

  const prevPhoto = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPhotoIdx((i) => (i === 0 ? l.photos.length - 1 : i - 1))
  }
  const nextPhoto = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPhotoIdx((i) => (i === l.photos.length - 1 ? 0 : i + 1))
  }

  return (
    <article
      onClick={() => (onOpen ? onOpen(l) : router.push(`/anuncios/${l.id}`))}
      onMouseEnter={() => onHover?.(l.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`group cursor-pointer rounded-2xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40 ${
        active
          ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/10'
          : 'ring-1 ring-white/5'
      } bg-[var(--c-card)]`}
    >
      {/* ── Photo area ── */}
      <div className="relative h-44 bg-[var(--c-card)] overflow-hidden">
        {l.photos.length > 0 ? (
          <img
            src={l.photos[photoIdx]}
            alt={l.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-700 text-sm">Sin foto</div>
        )}

        {/* Dark scrim bottom */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 to-transparent" />

        {/* Slider arrows — visible on hover */}
        {l.photos.length > 1 && (
          <>
            <button
              onClick={prevPhoto}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={nextPhoto}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
            >
              <ChevronRight size={14} />
            </button>
            {/* Dot indicators */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {l.photos.map((_, i) => (
                <span
                  key={i}
                  className={`w-1 h-1 rounded-full transition-all ${i === photoIdx ? 'bg-white w-2.5' : 'bg-white/40'}`}
                />
              ))}
            </div>
          </>
        )}

        {/* Top-right: actions */}
        <button
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm text-white/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70 hover:text-white"
        >
          <MoreHorizontal size={14} />
        </button>

        {/* Bottom-left: price */}
        <div className="absolute bottom-2.5 left-3">
          <span className="text-white font-bold text-base leading-none tracking-tight">
            {fmtPrice(l.price, l.currency)}{l.operation === 'rent' ? '/mes' : ''}
          </span>
          <span className="text-white/60 text-xs ml-1.5">
            {isClp ? `${fmtPrice(l.price_sqm, l.currency)}/m²` : `${fmt(l.price_sqm)} €/m²`}
          </span>
          {isClp && l.price_uf != null && (
            <div className="text-white/70 text-[11px] mt-0.5">≈ {l.price_uf.toLocaleString('es-CL')} UF</div>
          )}
        </div>

        {/* Operation tag */}
        <div className="absolute bottom-2.5 right-3">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${l.operation === 'sale' ? 'bg-blue-600/80 text-white' : 'bg-violet-600/80 text-white'}`}>
            {l.operation === 'sale' ? 'VENTA' : 'ALQUILER'}
          </span>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="px-3.5 py-3">
        {/* Badge chip + days */}
        {l.badge && (
          <div className="flex items-center justify-between mb-1.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
              <span className={`w-1.5 h-1.5 rounded-full ${BADGE_DOT[l.badge.color]}`} />
              {l.badge.label}
            </span>
            <span className="text-[10px] text-slate-700">{daysLabel(l.days_on_market)}</span>
          </div>
        )}

        {/* Title */}
        <p className="text-slate-200 text-sm font-semibold leading-snug line-clamp-1 mb-1.5">
          {l.title}
        </p>

        {/* Specs line */}
        <p className="text-slate-500 text-xs mb-2.5">
          {l.square_meters} m²
          {l.bedrooms > 0 && <> · {l.bedrooms} hab</>}
          {` · ${l.bathrooms} baño${l.bathrooms > 1 ? 's' : ''}`}
          {l.floor && <> · {l.floor}</>}
        </p>

        {/* Bottom row */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1 text-[11px] text-slate-600 flex-1">
            <div className="flex items-center gap-1.5">
              <MapPin size={10} className="text-slate-700 flex-shrink-0" />
              <span className="truncate max-w-[140px]">{l.zone_name}</span>
            </div>
            {l.latitude && l.longitude && (
              <a
                href={`https://maps.google.com/?q=${l.latitude},${l.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                title={`${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)}`}
              >
                📍 {l.latitude.toFixed(4)}, {l.longitude.toFixed(4)}
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            {l.listing_count > 1 && (
              <span className="text-[10px] text-blue-400 bg-blue-950/60 border border-blue-900/40 px-1.5 py-0.5 rounded-full">
                {l.listing_count} fuentes
              </span>
            )}
            {!l.badge && <span className="text-[10px] text-slate-700">{daysLabel(l.days_on_market)}</span>}
          </div>
        </div>
      </div>
    </article>
  )
}
