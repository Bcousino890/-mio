'use client'

import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import { useEffect, useRef, useState } from 'react'
import type { CadastreParcel, CadastreListingPin } from '@/lib/mock-chile-cadastre'

interface Props {
  parcels: CadastreParcel[]
  pins: CadastreListingPin[]
  center?: { lat: number; lng: number }
  zoom?: number
  onShapeDrawn?: (shape: DrawnShape | null) => void
}

export interface DrawnShape {
  type: 'polygon' | 'circle' | 'rectangle'
  coordinates?: [number, number][]
  center?: [number, number]
  radius?: number
}

const CONFIDENCE_COLOR: Record<CadastreListingPin['location_confidence'], string> = {
  confirmed: '#22c55e',
  candidate: '#f59e0b',
  pin_suspect: '#ef4444',
  none: '#94a3b8',
}

const CONFIDENCE_LABEL: Record<CadastreListingPin['location_confidence'], string> = {
  confirmed: 'Confirmado (catastro)',
  candidate: 'Candidato',
  pin_suspect: 'Pin sospechoso',
  none: 'Sin resolver',
}

function pinHtml(pin: CadastreListingPin) {
  const color = CONFIDENCE_COLOR[pin.location_confidence]
  return `<div style="
    width:16px;height:16px;border-radius:50%;
    background:${color};
    border:2px solid #ffffff;
    box-shadow:0 2px 6px rgba(0,0,0,0.45);
    cursor:pointer;
  "></div>`
}

function popupHtml(pin: CadastreListingPin) {
  const color = CONFIDENCE_COLOR[pin.location_confidence]
  return `
    <div style="min-width:200px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px">
      <div style="font-weight:700;font-size:13px;color:#0f172a">${pin.title}</div>
      <div style="color:#64748b;font-size:11px;margin-top:2px">${pin.comuna}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
        <span style="font-size:11px;font-weight:600;color:#1e293b">${CONFIDENCE_LABEL[pin.location_confidence]}</span>
      </div>
      ${pin.rol_matriz ? `<div style="color:#475569;font-size:11px;margin-top:3px">Rol: ${pin.rol_matriz}</div>` : ''}
      ${pin.agency_count > 1 ? `<div style="color:#3b82f6;font-size:11px;margin-top:3px;font-weight:600">${pin.agency_count} corredoras republicando</div>` : ''}
    </div>
  `
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let leafletPromise: Promise<any> | null = null
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = import('leaflet').then(async (L) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).L = L
      await import('leaflet-draw')
      return L
    })
  }
  return leafletPromise
}

export default function CadastreMap({ parcels, pins, center, zoom = 16, onShapeDrawn }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawnItemsRef = useRef<any>(null)
  const initializingRef = useRef(false)
  const [activeShape, setActiveShape] = useState<DrawnShape | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    if (initializingRef.current) return
    initializingRef.current = true

    let cancelled = false
    const fallbackCenter = parcels[0]?.centroid ?? { lat: -33.45, lng: -70.65 }
    const mapCenter = center ?? fallbackCenter

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        center: [mapCenter.lat, mapCenter.lng],
        zoom,
        zoomControl: false,
        attributionControl: false,
      })

      // ESRI World Imagery: satélite gratuito, sin API key.
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      }).addTo(map)

      L.control.zoom({ position: 'topright' }).addTo(map)
      L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map)

      parcels.forEach((parcel) => {
        const style =
          parcel.source === 'ide_chile'
            ? { color: '#22d3ee', weight: 2, fillColor: '#22d3ee', fillOpacity: 0.12 }
            : parcel.source === 'estimated'
              ? { color: '#f59e0b', weight: 2, dashArray: '4,3', fillColor: '#f59e0b', fillOpacity: 0.08 }
              : { color: '#a78bfa', weight: 2, fillColor: '#a78bfa', fillOpacity: 0.1 }

        const layer = L.geoJSON(parcel.geojson, { style }).addTo(map)
        layer.bindPopup(`
          <div style="font-family:system-ui;font-size:12px;line-height:1.5">
            <div style="font-weight:700;color:#0f172a">${parcel.comuna}</div>
            <div style="color:#64748b;margin-top:2px">Rol: ${parcel.rol ?? 'sin rol'}</div>
            <div style="color:#94a3b8;font-size:11px;margin-top:2px">Fuente: ${parcel.source}</div>
          </div>
        `)
      })

      pins.forEach((pin) => {
        const icon = L.divIcon({
          className: '',
          html: pinHtml(pin),
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        })
        const marker = L.marker([pin.lat, pin.lng], { icon }).addTo(map)
        marker.bindPopup(popupHtml(pin), { maxWidth: 240, offset: [0, -4] })
      })

      // Draw tools
      const drawnItems = new (L as any).FeatureGroup()
      map.addLayer(drawnItems)
      drawnItemsRef.current = drawnItems

      const drawControl = new (L as any).Control.Draw({
        position: 'topright',
        edit: { featureGroup: drawnItems, remove: true },
        draw: {
          polygon: { shapeOptions: { color: '#22d3ee', fillOpacity: 0.12, weight: 2 } },
          circle: { shapeOptions: { color: '#22d3ee', fillOpacity: 0.12, weight: 2 } },
          rectangle: { shapeOptions: { color: '#22d3ee', fillOpacity: 0.12, weight: 2 } },
          polyline: false,
          marker: false,
          circlemarker: false,
        },
      })
      map.addControl(drawControl)

      map.on((L as any).Draw.Event.CREATED, (e: any) => {
        drawnItems.clearLayers()
        drawnItems.addLayer(e.layer)
        let shape: DrawnShape | null = null
        if (e.layerType === 'circle') {
          const c = e.layer.getLatLng()
          shape = { type: 'circle', center: [c.lat, c.lng], radius: e.layer.getRadius() }
        } else {
          const coords: [number, number][] = e.layer.getLatLngs()[0].map((ll: any) => [ll.lat, ll.lng])
          coords.push(coords[0])
          shape = { type: e.layerType === 'rectangle' ? 'rectangle' : 'polygon', coordinates: coords }
        }
        setActiveShape(shape)
        onShapeDrawn?.(shape)
      })

      map.on((L as any).Draw.Event.DELETED, () => {
        setActiveShape(null)
        onShapeDrawn?.(null)
      })

      map.on((L as any).Draw.Event.EDITED, (e: any) => {
        e.layers.eachLayer((layer: any) => {
          let shape: DrawnShape
          if (typeof layer.getRadius === 'function') {
            const c = layer.getLatLng()
            shape = { type: 'circle', center: [c.lat, c.lng], radius: layer.getRadius() }
          } else {
            const coords: [number, number][] = layer.getLatLngs()[0].map((ll: any) => [ll.lat, ll.lng])
            coords.push(coords[0])
            shape = { type: 'polygon', coordinates: coords }
          }
          setActiveShape(shape)
          onShapeDrawn?.(shape)
        })
      })

      mapRef.current = map
    })

    return () => {
      cancelled = true
      initializingRef.current = false
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
      {activeShape && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 bg-cyan-600/90 backdrop-blur border border-cyan-500/50 rounded-full px-3 py-1.5 text-xs text-white font-medium shadow-lg">
          <span>Zona dibujada activa</span>
          <button
            onClick={() => {
              drawnItemsRef.current?.clearLayers()
              setActiveShape(null)
              onShapeDrawn?.(null)
            }}
            className="w-4 h-4 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            ×
          </button>
        </div>
      )}
      <div className="absolute bottom-5 left-4 z-[1000] bg-white/95 backdrop-blur border border-black/8 rounded-xl px-3 py-2 text-xs text-slate-600 space-y-1 pointer-events-none shadow-md">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e] inline-block flex-shrink-0" />
          Confirmado (catastro)
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] inline-block flex-shrink-0" />
          Candidato
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444] inline-block flex-shrink-0" />
          Pin sospechoso
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-black/5">
          <span className="w-3 h-1.5 rounded-sm bg-[#22d3ee]/40 border border-[#22d3ee] inline-block flex-shrink-0" />
          Parcela IDE Chile
        </div>
      </div>
    </div>
  )
}
