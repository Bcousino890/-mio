'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

interface Props {
  selectedRol?: { lat?: number; lng?: number; direccion?: string | null } | null
  center?: { lat: number; lng: number }
  zoom?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let leafletPromise: Promise<any> | null = null
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = import('leaflet').then((L) => { (window as any).L = L; return L })
  }
  return leafletPromise
}

const BLUE_ICON_URL =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI4IiBmaWxsPSIjMzM5OWYzIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg=='

export default function GoogleMapsView({ selectedRol, center, zoom = 15 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null)

  const lat = selectedRol?.lat ?? center?.lat ?? -33.4095
  const lng = selectedRol?.lng ?? center?.lng ?? -70.5677

  // Init — se monta una sola vez. Antes esto inyectaba <script src="unpkg...">
  // en cada montaje (dependiente de red externa, sin control de caché del
  // bundler, y sin fallback si unpkg.com estaba lento/caído: el mapa se
  // quedaba en blanco indefinidamente). Usar el paquete 'leaflet' ya
  // bundleado con la app carga siempre desde el propio build, tan rápido
  // como cualquier otro componente de la página.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom,
        zoomControl: true,
        attributionControl: true,
      })

      // Satélite híbrido de Google (lyrs=y: imagen + nombres de calles),
      // tiles estáticos gratis sin API key — mismo esquema que el Visor
      // Catastral (/chile/street) y que ListingMatchMap.
      L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        attribution: '© Google',
        maxZoom: 21,
        maxNativeZoom: 20,
      }).addTo(map)

      const icon = L.icon({
        iconUrl: BLUE_ICON_URL,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
      })
      const marker = L.marker([lat, lng], { icon })
        .addTo(map)
        .bindPopup(`<div style="font-size:12px;color:#333"><strong>${selectedRol?.direccion || 'Ubicación'}</strong><br/>${lat.toFixed(6)}, ${lng.toFixed(6)}</div>`)
        .openPopup()

      markerRef.current = marker
      mapRef.current = map

      // El contenedor puede montarse con tamaño 0 si el panel padre todavía
      // está animando su transición de ancho/alto — sin este invalidateSize
      // el mapa queda con tiles a medio cargar o en gris hasta el próximo
      // resize manual de la ventana.
      requestAnimationFrame(() => map.invalidateSize())
    })

    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actualiza posición del marcador y centro cuando cambia el rol seleccionado
  useEffect(() => {
    const map = mapRef.current
    const L = (window as any).L
    if (!map || !L) return

    if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null }

    const icon = L.icon({
      iconUrl: BLUE_ICON_URL,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12],
    })
    const marker = L.marker([lat, lng], { icon })
      .addTo(map)
      .bindPopup(`<div style="font-size:12px;color:#333"><strong>${selectedRol?.direccion || 'Ubicación'}</strong><br/>${lat.toFixed(6)}, ${lng.toFixed(6)}</div>`)
      .openPopup()

    markerRef.current = marker
    map.setView([lat, lng], zoom, { animate: true })
  }, [lat, lng, selectedRol?.direccion, zoom])

  return <div ref={containerRef} className="w-full h-full" />
}
