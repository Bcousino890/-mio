'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

export interface MatchCandidate {
  rol: string
  direccion: string | null
  lat: number | null
  lng: number | null
  match_score: number
  avaluo_fiscal_total: number | null
  superficie_terreno_m2?: number | null
  superficie_construida_m2?: number | null
  distance_m?: number | null
}

interface Props {
  listingLat: number
  listingLng: number
  candidates: MatchCandidate[]
  selectedRol?: string | null
  onSelectCandidate?: (rol: string) => void
}

function scoreColor(score: number) {
  if (score >= 75) return '#10b981' // emerald — alta probabilidad
  if (score >= 45) return '#f59e0b' // amber — revisar
  return '#ef4444' // red — baja probabilidad
}

/**
 * Mapa de confirmación: pin azul = ubicación declarada por el anuncio,
 * pines de color = roles SII candidatos, coloreados por % de coincidencia
 * (verde alto, ámbar medio, rojo bajo) para que el usuario confirme visualmente
 * cuál rol corresponde a la propiedad.
 */
export default function ListingMatchMap({ listingLat, listingLng, candidates, selectedRol, onSelectCandidate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidateMarkersRef = useRef<Record<string, any>>({})

  useEffect(() => {
    if (!containerRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((containerRef.current as any)._leaflet_id) return

    const geoCandidates = candidates.filter((c) => c.lat != null && c.lng != null)

    import('leaflet').then((L) => {
      if (!containerRef.current) return

      const map = L.map(containerRef.current, {
        center: [listingLat, listingLng],
        zoom: 17,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
      })

      // Google Satellite basemap para mejor visualización de ubicaciones exactas
      L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        attribution: '© Google',
        maxZoom: 21,
      }).addTo(map)

      L.control.zoom({ position: 'topright' }).addTo(map)

      // Círculos de radios visuales (100m, 300m, 1000m) para referencia de búsqueda
      const radios = [
        { radius: 100, color: '#10b981', opacity: 0.1 },
        { radius: 300, color: '#f59e0b', opacity: 0.05 },
        { radius: 1000, color: '#ef4444', opacity: 0.03 },
      ]
      for (const r of radios) {
        L.circle([listingLat, listingLng], {
          radius: r.radius,
          color: r.color,
          fillColor: r.color,
          fillOpacity: r.opacity,
          weight: 1,
        }).addTo(map)
      }

      // Pin azul: ubicación declarada por el anuncio
      const listingIcon = L.divIcon({
        className: '',
        iconAnchor: [11, 11],
        html: `<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;">A</div>`,
      })
      L.marker([listingLat, listingLng], { icon: listingIcon, zIndexOffset: 1000 })
        .bindPopup('<div style="font-family:system-ui;font-size:12px;font-weight:600">Ubicación del anuncio</div>')
        .addTo(map)

      const bounds = L.latLngBounds([[listingLat, listingLng]])

      for (let i = 0; i < geoCandidates.length; i++) {
        const c = geoCandidates[i]
        const color = scoreColor(c.match_score)
        const number = i + 1
        const icon = L.divIcon({
          className: '',
          iconAnchor: [14, 14],
          html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;">${number}</div>`,
        })
        const marker = L.marker([c.lat as number, c.lng as number], { icon })
          .bindPopup(`
            <div style="font-family:system-ui;font-size:12px;line-height:1.5;min-width:180px">
              <div style="font-weight:700;color:#0f172a">#${number} · Rol ${c.rol}</div>
              <div style="color:#64748b;font-size:11px;margin-top:1px">${c.direccion ?? '—'}</div>
              ${c.distance_m ? `<div style="color:#64748b;font-size:11px;margin-top:2px">Distancia: ${(c.distance_m / 1000).toFixed(2)}km</div>` : ''}
              ${c.superficie_terreno_m2 ? `<div style="color:#64748b;font-size:11px">Sup. terreno: ${c.superficie_terreno_m2}m²</div>` : ''}
              ${c.superficie_construida_m2 ? `<div style="color:#64748b;font-size:11px">Sup. construida: ${c.superficie_construida_m2}m²</div>` : ''}
              <div style="margin-top:6px;font-weight:600;color:${color}">${(c.match_score * 100).toFixed(0)}% coincidencia</div>
            </div>
          `)
        marker.on('click', () => onSelectCandidate?.(c.rol))
        marker.addTo(map)
        candidateMarkersRef.current[c.rol] = marker
        bounds.extend([c.lat as number, c.lng as number])
      }

      if (geoCandidates.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 })
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

  // Resalta el marcador seleccionado abriendo su popup
  useEffect(() => {
    if (!selectedRol) return
    const marker = candidateMarkersRef.current[selectedRol]
    if (marker) marker.openPopup()
  }, [selectedRol])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 backdrop-blur border border-black/8 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-600 space-y-1 shadow-md">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block flex-shrink-0" />
          Ubicación del anuncio
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block flex-shrink-0" />
          Alta coincidencia (≥92%)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block flex-shrink-0" />
          Revisar (65–91%)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block flex-shrink-0" />
          Baja coincidencia (&lt;65%)
        </div>
      </div>
    </div>
  )
}
