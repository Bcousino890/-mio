'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { CadastreParcel, CadastreListingPin } from '@/lib/mock-chile-cadastre'

interface Props {
  parcels: CadastreParcel[]
  pins: CadastreListingPin[]
  center?: { lat: number; lng: number }
  zoom?: number
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
    leafletPromise = import('leaflet').then((L) => L)
  }
  return leafletPromise
}

export default function CadastreMap({ parcels, pins, center, zoom = 16 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  const initializingRef = useRef(false)

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
