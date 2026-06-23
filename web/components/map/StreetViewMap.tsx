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
  comunaCode?: string | null
  onParcelClick?: (props: { rol: string; sii_comuna_code: string; comuna_name: string }) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let leafletPromise: Promise<any> | null = null
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = import('leaflet').then((L) => { (window as any).L = L; return L })
  }
  return leafletPromise
}

const MIN_ZOOM_PARCELS = 15  // solo cargar predios con zoom ≥ 15

export default function StreetViewMap({ center, zoom = 17, pin, comunaCode, onParcelClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedPolyRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelLayerRef = useRef<any>(null)
  const loadingRef = useRef(false)
  const onParcelClickRef = useRef(onParcelClick)
  onParcelClickRef.current = onParcelClick

  // Cargar predios del viewport
  async function loadParcels() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    const L = (window as any).L
    if (!map || !L || map.getZoom() < MIN_ZOOM_PARCELS || loadingRef.current) return

    const b = map.getBounds()
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`
    const url = `/api/chile/parcels-bbox?bbox=${bbox}${comunaCode ? `&comuna=${comunaCode}` : ''}`

    loadingRef.current = true
    try {
      const res = await fetch(url)
      const data = await res.json()
      if (!data.success || !data.features?.length) return

      // Eliminar capa anterior
      if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }

      const layer = L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
        style: {
          color: '#ffffff',
          weight: 1.5,
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
          opacity: 0.7,
        },
        onEachFeature(feature: any, flayer: any) {
          flayer.on('click', () => {
            const p = feature.properties
            onParcelClickRef.current?.({ rol: p.rol, sii_comuna_code: p.sii_comuna_code, comuna_name: p.comuna_name })
            // Resaltar predio clicado
            flayer.setStyle({ fillOpacity: 0.35, color: '#3b82f6', weight: 2.5 })
            setTimeout(() => flayer.setStyle({ fillOpacity: 0.08, color: '#ffffff', weight: 1.5 }), 2000)
          })
          flayer.on('mouseover', () => flayer.setStyle({ fillOpacity: 0.2, color: '#60a5fa', weight: 2 }))
          flayer.on('mouseout',  () => flayer.setStyle({ fillOpacity: 0.08, color: '#ffffff', weight: 1.5 }))
        },
      }).addTo(map)

      parcelLayerRef.current = layer
    } catch { /* ignore */ } finally {
      loadingRef.current = false
    }
  }

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

      // Etiquetas encima del satélite
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, opacity: 0.85 }
      ).addTo(map)

      mapRef.current = map

      // Cargar predios al mover/hacer zoom
      map.on('moveend zoomend', () => {
        if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
        if (map.getZoom() >= MIN_ZOOM_PARCELS) loadParcels()
      })

      // Cargar inicial si zoom es suficiente
      if (zoom >= MIN_ZOOM_PARCELS) loadParcels()
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

    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null }
    if (selectedPolyRef.current) { selectedPolyRef.current.remove(); selectedPolyRef.current = null }

    if (!pin) return

    // Polígono seleccionado (encima de la capa de todos los predios)
    if (pin.geojson) {
      const poly = L.geoJSON(pin.geojson, {
        style: {
          color: '#3b82f6',
          weight: 3,
          fillColor: '#3b82f6',
          fillOpacity: 0.35,
        },
      }).addTo(mapRef.current)
      selectedPolyRef.current = poly
      try { mapRef.current.fitBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 20 }) } catch { /* ignore */ }
    }

    // Marcador puntual
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })
    const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(mapRef.current)
    if (pin.label) marker.bindPopup(`<div style="font-family:system-ui;font-size:12px">${pin.label}</div>`, { closeButton: false }).openPopup()
    markerRef.current = marker
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, zoom, pin])

  return <div ref={containerRef} className="w-full h-full" />
}
