'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

interface Props {
  latitude: number
  longitude: number
  /** true = ubicación exacta (RC resuelta); false = círculo difuso tipo Idealista */
  exact?: boolean
  blurRadiusM?: number
}

/**
 * Mapa de una sola propiedad para la ficha. Si la ubicación es aproximada
 * (Idealista publica un círculo difuso) pintamos un círculo en vez de un pin
 * exacto, igual que hace el portal de origen.
 */
export default function DetailMap({ latitude, longitude, exact = false, blurRadiusM = 180 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((containerRef.current as any)._leaflet_id) return

    import('leaflet').then((L) => {
      if (!containerRef.current) return

      const map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom: exact ? 17 : 15,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
      })

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO',
        maxZoom: 20,
      }).addTo(map)

      L.control.zoom({ position: 'topright' }).addTo(map)

      if (exact) {
        const icon = L.divIcon({
          className: '',
          iconAnchor: [9, 9],
          html: `<div style="width:18px;height:18px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
        })
        L.marker([latitude, longitude], { icon }).addTo(map)
      } else {
        L.circle([latitude, longitude], {
          radius: blurRadiusM,
          color: '#3b82f6',
          weight: 1.5,
          fillColor: '#3b82f6',
          fillOpacity: 0.18,
        }).addTo(map)
      }

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

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {!exact && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 backdrop-blur border border-black/8 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-600 pointer-events-none shadow-md">
          Ubicación aproximada
        </div>
      )}
    </div>
  )
}
