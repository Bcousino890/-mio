'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

interface SecondPin {
  latitude: number
  longitude: number
}

interface Props {
  latitude: number
  longitude: number
  /** true = ubicación exacta (RC resuelta); false = círculo difuso tipo Idealista */
  exact?: boolean
  blurRadiusM?: number
  /** 'carto' (por defecto, España) | 'satellite' (mismo satélite de Google sin
   * API key que ya usa /chile/catastro vía StreetViewMap.tsx). */
  tileStyle?: 'carto' | 'satellite'
  /** Segundo pin opcional (corrección manual del equipo) — se dibuja en verde,
   * distinto del pin/círculo declarado. Arrastrable si se pasa onSecondPinDrag. */
  secondPin?: SecondPin | null
  onSecondPinDrag?: (pos: SecondPin) => void
}

const TILE_LAYERS = {
  carto: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap © CARTO',
  },
  // Mismo patrón ya usado en components/map/StreetViewMap.tsx (visor de
  // catastro): tiles satelitales de Google servidos directo, sin API key.
  // Google solo sirve mt0-mt3 — sin `subdomains` explícito, Leaflet usa su
  // default ['a','b','c'] y pide mta/mtb/mtc (404), dejando el mapa en gris.
  satellite: {
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '',
    subdomains: ['0', '1', '2', '3'],
  },
}

/**
 * Mapa de una sola propiedad para la ficha. Si la ubicación es aproximada
 * (Idealista publica un círculo difuso) pintamos un círculo en vez de un pin
 * exacto, igual que hace el portal de origen.
 */
export default function DetailMap({
  latitude, longitude, exact = false, blurRadiusM = 180,
  tileStyle = 'carto', secondPin = null, onSecondPinDrag,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const secondMarkerRef = useRef<any>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const onSecondPinDragRef = useRef(onSecondPinDrag)
  onSecondPinDragRef.current = onSecondPinDrag

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

      const tile = TILE_LAYERS[tileStyle]
      L.tileLayer(tile.url, {
        attribution: tile.attribution,
        maxZoom: 20,
        ...('subdomains' in tile ? { subdomains: tile.subdomains } : {}),
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

      if (secondPin) {
        const secondIcon = L.divIcon({
          className: '',
          iconAnchor: [9, 9],
          html: `<div style="width:18px;height:18px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
        })
        const marker = L.marker([secondPin.latitude, secondPin.longitude], {
          icon: secondIcon,
          draggable: Boolean(onSecondPinDragRef.current),
        }).addTo(map)
        marker.on('dragend', () => {
          const pos = marker.getLatLng()
          onSecondPinDragRef.current?.({ latitude: pos.lat, longitude: pos.lng })
        })
        secondMarkerRef.current = marker
      }

      mapRef.current = map

      // El contenedor puede cambiar de tamaño después de montado (botón
      // "agrandar" en la ficha, que alterna entre el recuadro chico y overlay
      // de pantalla completa) — sin invalidateSize() Leaflet sigue creyendo
      // que tiene el tamaño viejo y el mapa queda cortado/mal centrado.
      // El invalidateSize se difiere a requestAnimationFrame para que corra
      // DESPUÉS del relayout del navegador (si no, Leaflet lee un tamaño
      // intermedio y vuelve a quedar cortado) y para evitar el warning
      // "ResizeObserver loop completed with undelivered notifications".
      if (containerRef.current) {
        const ro = new ResizeObserver(() => {
          requestAnimationFrame(() => mapRef.current?.invalidateSize())
        })
        ro.observe(containerRef.current)
        resizeObserverRef.current = ro
      }
    })

    return () => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        secondMarkerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El mapa se crea una sola vez (arriba); si el segundo pin aparece/cambia
  // DESPUÉS del montaje (ej. el usuario recién apretó "Agregar pin"), lo
  // reflejamos moviendo/creando el marcador sin recrear todo el mapa.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    import('leaflet').then((L) => {
      if (!secondPin) {
        if (secondMarkerRef.current) { secondMarkerRef.current.remove(); secondMarkerRef.current = null }
        return
      }
      if (secondMarkerRef.current) {
        secondMarkerRef.current.setLatLng([secondPin.latitude, secondPin.longitude])
        return
      }
      const secondIcon = L.divIcon({
        className: '',
        iconAnchor: [9, 9],
        html: `<div style="width:18px;height:18px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
      })
      const marker = L.marker([secondPin.latitude, secondPin.longitude], {
        icon: secondIcon,
        draggable: Boolean(onSecondPinDragRef.current),
      }).addTo(map)
      marker.on('dragend', () => {
        const pos = marker.getLatLng()
        onSecondPinDragRef.current?.({ latitude: pos.lat, longitude: pos.lng })
      })
      secondMarkerRef.current = marker
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondPin?.latitude, secondPin?.longitude])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {!exact && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 backdrop-blur border border-black/8 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-600 pointer-events-none shadow-md">
          Ubicación aproximada
        </div>
      )}
      {secondPin && (
        <div className="absolute bottom-3 right-3 z-[1000] bg-white/95 backdrop-blur border border-black/8 rounded-lg px-2.5 py-1.5 text-[11px] text-emerald-700 pointer-events-none shadow-md">
          Pin corregido {onSecondPinDrag ? '(arrástralo)' : ''}
        </div>
      )}
    </div>
  )
}
