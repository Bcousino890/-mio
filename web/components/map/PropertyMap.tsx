'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Listing } from '@/lib/mock-listings'

interface Props {
  listings: Listing[]
  activeId?: string | null
  onMarkerClick?: (id: string) => void
  onMarkerHover?: (id: string | null) => void
}

function fmtPrice(n: number, op: string) {
  if (op === 'rent') return `${n.toLocaleString('es-ES')} €/mes`
  const k = n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString('es-ES', { minimumFractionDigits: n % 1_000_000 !== 0 ? 1 : 0, maximumFractionDigits: 1 })} M€`
    : `${Math.round(n / 1000)} K€`
  return k
}

function markerHtml(l: Listing, isActive: boolean) {
  const priceStr = fmtPrice(l.price, l.operation)
  const isPartic = l.advertiser_type === 'particular'
  const bg = isActive ? '#3b82f6' : '#ffffff'
  const text = isActive ? '#ffffff' : '#0f172a'
  const border = isActive ? 'transparent' : 'rgba(0,0,0,0.12)'
  const shadow = isActive
    ? '0 4px 16px rgba(59,130,246,0.5)'
    : '0 2px 8px rgba(0,0,0,0.25)'
  const dot = isPartic && !isActive ? 'background:#f59e0b;' : ''
  const dotHtml = isPartic ? `<span style="width:6px;height:6px;border-radius:50%;${dot || 'background:#3b82f6;'}display:inline-block;flex-shrink:0"></span>` : ''

  return `<div style="
    background:${bg};
    color:${text};
    border:1px solid ${border};
    border-radius:999px;
    padding:4px 10px;
    font-size:12px;
    font-weight:700;
    font-family:system-ui,-apple-system,sans-serif;
    white-space:nowrap;
    box-shadow:${shadow};
    display:flex;
    align-items:center;
    gap:5px;
    cursor:pointer;
    transition:all .15s;
    letter-spacing:-0.01em;
  ">${dotHtml}${priceStr}</div>`
}

export default function PropertyMap({ listings, activeId, onMarkerClick, onMarkerHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Record<string, any>>({})

  useEffect(() => {
    if (!containerRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((containerRef.current as any)._leaflet_id) return

    import('leaflet').then((L) => {
      if (!containerRef.current) return

      const map = L.map(containerRef.current, {
        center: [40.4300, -3.6900],
        zoom: 13,
        zoomControl: false,
        attributionControl: false,
      })

      // Carto light for contrast with our dark UI
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO',
        maxZoom: 20,
      }).addTo(map)

      // Custom zoom controls placement
      L.control.zoom({ position: 'topright' }).addTo(map)
      L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map)

      listings.forEach((l) => {
        const icon = L.divIcon({
          className: '',
          html: markerHtml(l, false),
          iconAnchor: [0, 0],
        })

        const marker = L.marker([l.latitude, l.longitude], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:200px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px">
              <div style="font-weight:700;font-size:14px;color:#0f172a">${l.price.toLocaleString('es-ES')} €</div>
              <div style="color:#64748b;font-size:11px;margin-top:1px">${l.price_sqm.toLocaleString('es-ES')} €/m² · ${l.square_meters}m² · ${l.bedrooms > 0 ? l.bedrooms + 'h · ' : ''}${l.bathrooms}b</div>
              <div style="margin-top:5px;font-size:12px;color:#1e293b;font-weight:500">${l.title}</div>
              <div style="color:#94a3b8;font-size:11px;margin-top:1px">${l.zone_name}</div>
              ${l.listing_count > 1 ? `<div style="color:#3b82f6;font-size:11px;margin-top:3px;font-weight:600">${l.listing_count} fuentes</div>` : ''}
            </div>
          `, { maxWidth: 240, offset: [0, 4] })

        marker.on('click', () => {
          onMarkerClick?.(l.id)
        })
        marker.on('mouseover', () => onMarkerHover?.(l.id))
        marker.on('mouseout', () => onMarkerHover?.(null))

        markersRef.current[l.id] = marker
      })

      mapRef.current = map
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update active marker style
  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then((L) => {
      Object.entries(markersRef.current).forEach(([id, marker]) => {
        const l = listings.find((x) => x.id === id)
        if (!l) return
        const isActive = id === activeId
        marker.setIcon(L.divIcon({
          className: '',
          html: markerHtml(l, isActive),
          iconAnchor: [0, 0],
        }))
        if (isActive) {
          marker.openPopup()
          marker.setZIndexOffset(1000)
        } else {
          marker.setZIndexOffset(0)
        }
      })
    })
  }, [activeId, listings])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {/* Map legend */}
      <div className="absolute bottom-5 left-4 z-[1000] bg-white/95 backdrop-blur border border-black/8 rounded-xl px-3 py-2 text-xs text-slate-600 space-y-1 pointer-events-none shadow-md">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block flex-shrink-0" />
          Particular
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block flex-shrink-0" />
          Agencia / Portal
        </div>
      </div>
    </div>
  )
}
