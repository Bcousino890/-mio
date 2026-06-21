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
  highlightedParcelId?: string | null
  onMapClick?: () => void
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

// Orden de prioridad para elegir el color/label dominante de un grupo de
// pines del mismo edificio (ej. 1 confirmado + 1 candidato → se pinta como
// confirmado, el estado más fuerte gana).
const CONFIDENCE_RANK: Record<CadastreListingPin['location_confidence'], number> = {
  confirmed: 3,
  candidate: 2,
  pin_suspect: 1,
  none: 0,
}

function dominantConfidence(pins: CadastreListingPin[]): CadastreListingPin['location_confidence'] {
  return pins.reduce((best, p) => (CONFIDENCE_RANK[p.location_confidence] > CONFIDENCE_RANK[best] ? p.location_confidence : best), pins[0].location_confidence)
}

function pinHtml(confidence: CadastreListingPin['location_confidence'], count: number) {
  const color = CONFIDENCE_COLOR[confidence]
  const size = count > 1 ? 22 : 16
  return `<div style="
    width:${size}px;height:${size}px;border-radius:50%;
    background:${color};
    border:2px solid #ffffff;
    box-shadow:0 2px 6px rgba(0,0,0,0.45);
    cursor:pointer;
    display:flex;align-items:center;justify-content:center;
    color:#ffffff;font-family:system-ui;font-size:10px;font-weight:700;
  ">${count > 1 ? count : ''}</div>`
}

// Un pin individual (sin agrupar) o una de las filas dentro del popup de un
// edificio agrupado — cada anuncio se ve de forma independiente, nunca se
// fusiona la info de varios anuncios en un solo bloque.
function pinRowHtml(pin: CadastreListingPin) {
  const color = CONFIDENCE_COLOR[pin.location_confidence]
  return `
    <div style="padding:6px 0">
      <div style="font-weight:700;font-size:13px;color:#0f172a">${pin.title}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:4px">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
        <span style="font-size:11px;font-weight:600;color:#1e293b">${CONFIDENCE_LABEL[pin.location_confidence]}</span>
      </div>
      ${pin.rol_matriz ? `<div style="color:#475569;font-size:11px;margin-top:3px">Rol: ${pin.rol_matriz}</div>` : ''}
      ${pin.agency_count > 1 ? `<div style="color:#3b82f6;font-size:11px;margin-top:3px;font-weight:600">${pin.agency_count} corredoras republicando</div>` : ''}
    </div>
  `
}

function groupPopupHtml(comuna: string, pins: CadastreListingPin[]) {
  const rows = pins.map((p, i) => `${i > 0 ? '<div style="border-top:1px solid #e2e8f0"></div>' : ''}${pinRowHtml(p)}`).join('')
  return `
    <div style="min-width:220px;max-width:260px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px">
      ${pins.length > 1 ? `<div style="color:#64748b;font-size:11px;margin-bottom:2px">${comuna} · ${pins.length} anuncios en este edificio</div>` : `<div style="color:#64748b;font-size:11px;margin-bottom:2px">${comuna}</div>`}
      ${rows}
    </div>
  `
}

// Agrupa pines del mismo edificio (mismo matched_parcel_id, o mismo
// rol_matriz si no hay parcela resuelta) en un único punto del mapa —
// evita que 6 corredoras republicando la misma casa se vean como 6 pines
// dispersos. La info de cada anuncio sigue viéndose por separado dentro
// del popup del grupo, nunca se fusiona en un solo dato.
function groupPinsByBuilding(pins: CadastreListingPin[]): { key: string; pins: CadastreListingPin[] }[] {
  const groups = new Map<string, CadastreListingPin[]>()
  pins.forEach((pin, i) => {
    const key = pin.matched_parcel_id ?? pin.rol_matriz ?? `__single_${i}`
    const existing = groups.get(key)
    if (existing) existing.push(pin)
    else groups.set(key, [pin])
  })
  return Array.from(groups.entries()).map(([key, pins]) => ({ key, pins }))
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

export default function CadastreMap({ parcels, pins, center, zoom = 16, onShapeDrawn, highlightedParcelId, onMapClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawnItemsRef = useRef<any>(null)
  const initializingRef = useRef(false)
  const [activeShape, setActiveShape] = useState<DrawnShape | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelLayersRef = useRef<Map<string, any>>(new Map())

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

      let selectedParcelLayer: { layer: L.GeoJSON; parcel: typeof parcels[0] } | null = null

      // Helper function to compute parcel style
      const getParcelStyle = (parcelSource: string, isSelected: boolean = false, isHovered: boolean = false) => {
        if (parcelSource === 'ide_chile') {
          return {
            color: isSelected ? '#0891b2' : isHovered ? '#06b6d4' : '#22d3ee',
            weight: isSelected ? 4 : isHovered ? 3 : 2.5,
            fillColor: isSelected ? '#0891b2' : isHovered ? '#06b6d4' : '#22d3ee',
            fillOpacity: isSelected ? 0.28 : isHovered ? 0.22 : 0.16,
          }
        } else if (parcelSource === 'estimated') {
          return {
            color: isSelected ? '#d97706' : isHovered ? '#f97316' : '#f59e0b',
            weight: isSelected ? 4 : isHovered ? 3 : 2.5,
            dashArray: '4,3',
            fillColor: isSelected ? '#d97706' : isHovered ? '#f97316' : '#f59e0b',
            fillOpacity: isSelected ? 0.2 : isHovered ? 0.14 : 0.1,
          }
        } else {
          return {
            color: isSelected ? '#7c3aed' : isHovered ? '#a78bfa' : '#c4b5fd',
            weight: isSelected ? 4 : isHovered ? 3 : 2.5,
            fillColor: isSelected ? '#7c3aed' : isHovered ? '#a78bfa' : '#c4b5fd',
            fillOpacity: isSelected ? 0.24 : isHovered ? 0.18 : 0.12,
          }
        }
      }

      parcels.forEach((parcel) => {

        const layer = L.geoJSON(parcel.geojson, { style: () => getParcelStyle(parcel.source) }).addTo(map)

        // Store layer reference for highlighting from parent
        parcelLayersRef.current.set(parcel.id, { layer, parcel })

        layer.on('mouseenter', () => {
          const isSelected = selectedParcelLayer?.layer === layer || parcel.id === highlightedParcelId
          layer.setStyle(getParcelStyle(parcel.source, isSelected, true))
          layer.bringToFront()
        })

        layer.on('mouseleave', () => {
          const isSelected = selectedParcelLayer?.layer === layer || parcel.id === highlightedParcelId
          layer.setStyle(getParcelStyle(parcel.source, isSelected, false))
        })

        layer.on('click', () => {
          if (selectedParcelLayer && selectedParcelLayer.layer !== layer) {
            const wasHighlighted = selectedParcelLayer.parcel.id === highlightedParcelId
            selectedParcelLayer.layer.setStyle(getParcelStyle(selectedParcelLayer.parcel.source, wasHighlighted, false))
          }
          selectedParcelLayer = { layer, parcel }
          layer.setStyle(getParcelStyle(parcel.source, true, false))
          layer.bringToFront()
          onMapClick?.()
        })

        layer.bindPopup(`
          <div style="font-family:system-ui;font-size:12px;line-height:1.5">
            <div style="font-weight:700;color:#0f172a">${parcel.comuna}</div>
            <div style="color:#64748b;margin-top:2px">Rol: ${parcel.rol ?? 'sin rol'}</div>
            <div style="color:#94a3b8;font-size:11px;margin-top:2px">Fuente: ${parcel.source}</div>
          </div>
        `)
      })

      const parcelCentroidById = new Map(parcels.map((p) => [p.id, p.centroid]))

      groupPinsByBuilding(pins).forEach(({ key, pins: groupPins }) => {
        // Punto del marcador: centroide de la parcela catastral si el grupo
        // ya está resuelto a un edificio real; si no, el promedio de los
        // pines del grupo (mismo rol_matriz pero sin parcela geométrica aún).
        const parcelCentroid = parcelCentroidById.get(key)
        const point = parcelCentroid ?? {
          lat: groupPins.reduce((sum, p) => sum + p.lat, 0) / groupPins.length,
          lng: groupPins.reduce((sum, p) => sum + p.lng, 0) / groupPins.length,
        }

        const confidence = dominantConfidence(groupPins)
        const icon = L.divIcon({
          className: '',
          html: pinHtml(confidence, groupPins.length),
          iconSize: [groupPins.length > 1 ? 22 : 16, groupPins.length > 1 ? 22 : 16],
          iconAnchor: [groupPins.length > 1 ? 11 : 8, groupPins.length > 1 ? 11 : 8],
        })
        const marker = L.marker([point.lat, point.lng], { icon }).addTo(map)
        marker.bindPopup(groupPopupHtml(groupPins[0].comuna, groupPins), { maxWidth: 280, offset: [0, -4] })
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

  // Handle highlighting parcel when highlightedParcelId changes
  useEffect(() => {
    if (!highlightedParcelId) {
      // Reset all parcels to normal style when no highlight
      parcelLayersRef.current.forEach(({ layer, parcel }) => {
        const getNormalStyle = () => {
          if (parcel.source === 'ide_chile') {
            return {
              color: '#22d3ee',
              weight: 2.5,
              fillColor: '#22d3ee',
              fillOpacity: 0.16,
            }
          } else if (parcel.source === 'estimated') {
            return {
              color: '#f59e0b',
              weight: 2.5,
              dashArray: '4,3',
              fillColor: '#f59e0b',
              fillOpacity: 0.1,
            }
          } else {
            return {
              color: '#c4b5fd',
              weight: 2.5,
              fillColor: '#c4b5fd',
              fillOpacity: 0.12,
            }
          }
        }
        layer.setStyle(getNormalStyle())
      })
      return
    }

    const parcelData = parcelLayersRef.current.get(highlightedParcelId)
    if (!parcelData) return

    const { layer, parcel } = parcelData

    // Helper to compute style for highlighting
    const getHighlightStyle = (isSelected: boolean = false) => {
      if (parcel.source === 'ide_chile') {
        return {
          color: isSelected ? '#0891b2' : '#22d3ee',
          weight: isSelected ? 4 : 2.5,
          fillColor: isSelected ? '#0891b2' : '#22d3ee',
          fillOpacity: isSelected ? 0.28 : 0.16,
        }
      } else if (parcel.source === 'estimated') {
        return {
          color: isSelected ? '#d97706' : '#f59e0b',
          weight: isSelected ? 4 : 2.5,
          dashArray: '4,3',
          fillColor: isSelected ? '#d97706' : '#f59e0b',
          fillOpacity: isSelected ? 0.2 : 0.1,
        }
      } else {
        return {
          color: isSelected ? '#7c3aed' : '#c4b5fd',
          weight: isSelected ? 4 : 2.5,
          fillColor: isSelected ? '#7c3aed' : '#c4b5fd',
          fillOpacity: isSelected ? 0.24 : 0.12,
        }
      }
    }

    layer.setStyle(getHighlightStyle(true))
    layer.bringToFront()
  }, [highlightedParcelId])

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
