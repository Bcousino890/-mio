'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Listing } from '@/lib/mock-listings'

interface Props {
  listings: Listing[]
  activeId?: string | null
  onMarkerClick?: (id: string) => void
}

function fmt(n: number) {
  return n.toLocaleString('es-ES')
}

export default function PropertyMap({ listings, activeId, onMarkerClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Record<string, any>>({})

  useEffect(() => {
    if (!containerRef.current) return
    // Guard against StrictMode double-invoke and already-init containers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((containerRef.current as any)._leaflet_id) return

    import('leaflet').then((L) => {
      if (!containerRef.current) return

      // Fix webpack default icon paths
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: '/leaflet/marker-icon-2x.png',
        iconUrl: '/leaflet/marker-icon.png',
        shadowUrl: '/leaflet/marker-shadow.png',
      })

      const map = L.map(containerRef.current, {
        center: [40.4300, -3.6900],
        zoom: 13,
        zoomControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      listings.forEach((l) => {
        const isPartic = l.advertiser_type === 'particular'
        const color = isPartic ? '#f59e0b' : '#3b82f6'

        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${color};color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid rgba(255,255,255,0.25);box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:pointer;">${l.square_meters}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })

        const marker = L.marker([l.latitude, l.longitude], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:180px;font-family:system-ui;font-size:13px;line-height:1.5">
              <div style="font-weight:700;font-size:14px">${fmt(l.price)} €</div>
              <div style="color:#64748b;font-size:11px">${fmt(l.price_sqm)} €/m² · ${l.square_meters}m² · ${l.bedrooms}h ${l.bathrooms}b</div>
              <div style="margin-top:4px;font-size:12px">${l.title}</div>
              <div style="color:#94a3b8;font-size:11px">${l.zone_name}</div>
              ${l.listing_count > 1 ? `<div style="color:#60a5fa;font-size:11px;margin-top:2px">${l.listing_count} fuentes</div>` : ''}
            </div>
          `, { offset: [0, -8], maxWidth: 220 })

        marker.on('click', () => onMarkerClick?.(l.id))
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

  useEffect(() => {
    if (!mapRef.current || !activeId) return
    const marker = markersRef.current[activeId]
    if (marker) marker.openPopup()
  }, [activeId])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {/* Legend */}
      <div className="absolute bottom-6 left-4 z-[1000] bg-[#0f1117]/90 backdrop-blur border border-[#1e2130] rounded-lg px-3 py-2 text-xs text-slate-400 space-y-1 pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-500 inline-block flex-shrink-0" />
          Agencia/Portal
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-400 inline-block flex-shrink-0" />
          Particular
        </div>
        <div className="text-[10px] text-slate-600 pt-0.5">nº = m²</div>
      </div>
    </div>
  )
}
