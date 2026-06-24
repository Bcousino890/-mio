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

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO',
        maxZoom: 20,
      }).addTo(map)

      L.control.zoom({ position: 'topright' }).addTo(map)

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

      for (const c of geoCandidates) {
        const color = scoreColor(c.match_score)
        const icon = L.divIcon({
          className: '',
          iconAnchor: [9, 9],
          html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);"></div>`,
        })
        const marker = L.marker([c.lat as number, c.lng as number], { icon })
          .bindPopup(`
            <div style="font-family:system-ui;font-size:12px;line-height:1.5;min-width:160px">
              <div style="font-weight:700;color:#0f172a">Rol ${c.rol}</div>
              <div style="color:#64748b;font-size:11px;margin-top:1px">${c.direccion ?? '—'}</div>
              <div style="margin-top:4px;font-weight:600;color:${color}">${c.match_score.toFixed(0)}% coincidencia</div>
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
          Alta coincidencia (≥75%)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block flex-shrink-0" />
          Revisar (45–75%)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block flex-shrink-0" />
          Baja coincidencia (&lt;45%)
        </div>
      </div>
    </div>
  )
}
