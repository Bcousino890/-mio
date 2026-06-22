'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

export interface StreetViewPin {
  lat: number
  lng: number
  label?: string
  geojson?: object | null
}

interface Props {
  center: { lat: number; lng: number }
  zoom?: number
  pin?: StreetViewPin | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let leafletPromise: Promise<any> | null = null
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = import('leaflet').then((L) => { (window as any).L = L; return L })
  }
  return leafletPromise
}

export default function StreetViewMap({ center, zoom = 17, pin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polygonRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current, {
        center: [center.lat, center.lng],
        zoom,
        zoomControl: true,
        attributionControl: true,
      })

      // Satélite ESRI
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Esri, Maxar', maxZoom: 20 }
      ).addTo(map)

      // Capa de etiquetas/calles encima del satélite
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, opacity: 0.85 }
      ).addTo(map)

      mapRef.current = map
    })

    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actualiza centro, pin y polígono cuando cambia la selección
  useEffect(() => {
    if (!mapRef.current) return
    const L = (window as any).L
    if (!L) return

    mapRef.current.setView([center.lat, center.lng], zoom, { animate: true, duration: 0.5 })

    // Limpiar marker y polígono anteriores
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null }
    if (polygonRef.current) { polygonRef.current.remove(); polygonRef.current = null }

    if (!pin) return

    // Polígono del predio (si viene del GeoPackage)
    if (pin.geojson) {
      const poly = L.geoJSON(pin.geojson, {
        style: {
          color: '#3b82f6',
          weight: 3,
          fillColor: '#3b82f6',
          fillOpacity: 0.2,
        },
      }).addTo(mapRef.current)
      polygonRef.current = poly

      // Centrar en el polígono
      try { mapRef.current.fitBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 20 }) } catch { /* ignore */ }
    }

    // Marcador puntual (siempre, para indicar ubicación aunque no haya polígono)
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        width:16px;height:16px;border-radius:50%;
        background:#3b82f6;border:3px solid #fff;
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    })
    const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(mapRef.current)
    if (pin.label) marker.bindPopup(`<div style="font-family:system-ui;font-size:12px">${pin.label}</div>`, { closeButton: false }).openPopup()
    markerRef.current = marker
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, zoom, pin])

  return <div ref={containerRef} className="w-full h-full" />
}
