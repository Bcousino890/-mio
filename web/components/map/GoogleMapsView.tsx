'use client'

import { useEffect, useRef } from 'react'

interface Props {
  selectedRol?: { lat?: number; lng?: number; direccion?: string | null } | null
  center?: { lat: number; lng: number }
  zoom?: number
}

declare global {
  interface Window {
    L: any
  }
}

export default function GoogleMapsView({ selectedRol, center, zoom = 15 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)

  const lat = selectedRol?.lat ?? center?.lat ?? -33.4095
  const lng = selectedRol?.lng ?? center?.lng ?? -70.5677

  useEffect(() => {
    if (!containerRef.current) return

    // Load Leaflet CSS/JS
    const loadMap = async () => {
      if (!window.L) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)

        const script = document.createElement('script')
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        script.onload = () => {
          initMap()
        }
        document.body.appendChild(script)
      } else {
        initMap()
      }
    }

    const initMap = () => {
      if (mapRef.current) return

      const L = window.L
      const map = L.map(containerRef.current).setView([lat, lng], zoom)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      const blueIcon = L.icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI4IiBmaWxsPSIjMzM5OWYzIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
      })

      const marker = L.marker([lat, lng], { icon: blueIcon })
        .addTo(map)
        .bindPopup(`<div style="font-size:12px;color:#333"><strong>${selectedRol?.direccion || 'Ubicación'}</strong><br/>${lat.toFixed(6)}, ${lng.toFixed(6)}</div>`)
        .openPopup()

      markerRef.current = marker
      mapRef.current = map
    }

    loadMap()

    return () => {
      // Don't destroy map on unmount — keep it persistent
    }
  }, [lat, lng, selectedRol?.direccion, zoom])

  // Update marker position when selectedRol changes
  useEffect(() => {
    if (mapRef.current && markerRef.current) {
      const L = window.L
      mapRef.current.removeLayer(markerRef.current)

      const blueIcon = L.icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI4IiBmaWxsPSIjMzM5OWYzIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
      })

      const marker = L.marker([lat, lng], { icon: blueIcon })
        .addTo(mapRef.current)
        .bindPopup(`<div style="font-size:12px;color:#333"><strong>${selectedRol?.direccion || 'Ubicación'}</strong><br/>${lat.toFixed(6)}, ${lng.toFixed(6)}</div>`)
        .openPopup()

      markerRef.current = marker
      mapRef.current.setView([lat, lng], zoom, { animate: true })
    }
  }, [lat, lng, selectedRol?.direccion, zoom])

  return <div ref={containerRef} className="w-full h-full" />
}
