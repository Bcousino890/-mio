'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de ubicación de la ficha del inmueble chileno (property_cl). A diferencia
// de DetailMap (ficha de España, un pin), aquí conviven:
//
//   · Un pin por CORREDORA — la coordenada que declara el anuncio de cada
//     corredora del grupo (al unir varios avisos a mano se ven TODOS, para
//     comparar dónde puso cada una el pin).
//   · Las PARCELAS del catastro SII (polígonos naranja, igual que el visor de
//     /chile/catastro) como guía para colocar el pin sobre el predio real.
//   · El PIN REAL (verde, arrastrable): la corrección del equipo. Al soltarlo /
//     clicar una parcela se emite su posición para resolver el rol de abajo.
//   · La parcela resuelta bajo el pin real, resaltada.
//
// Se mantiene aparte de DetailMap a propósito: esa la comparte la ficha de
// España y no debe cargar con la lógica de parcelas/multi-pin de Chile.
// ─────────────────────────────────────────────────────────────────────────────

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { corredoraColor } from '@/lib/corredora-pin-colors'

export interface LatLng { latitude: number; longitude: number }
export interface CorredoraPin extends LatLng { label: string }

interface Props {
  /** Centro inicial del mapa (normalmente el pin declarado del anuncio principal). */
  latitude: number
  longitude: number
  /** Pin declarado por cada corredora del grupo (uno por anuncio con coordenada). */
  corredoraPins?: CorredoraPin[]
  /** Pin real corregido a mano (verde, arrastrable). null = todavía no puesto. */
  realPin?: LatLng | null
  /** Se llama al arrastrar el pin real o al clicar el mapa/una parcela. */
  onRealPinChange?: (pos: LatLng) => void
  /** Polígono GeoJSON de la parcela resuelta bajo el pin real (se resalta). */
  highlightGeojson?: object | null
  /** Dibuja las parcelas del catastro (polígonos naranja) al hacer zoom. */
  showParcels?: boolean
  /** Código de comuna SII: las parcelas se cargan ya filtradas por comuna. */
  comunaCode?: string | null
}

const MIN_ZOOM_PARCELS = 16

// Estilo de las parcelas: mismo naranja del visor de catastro (StreetViewMap).
const PARCEL_STYLE = { color: '#fbbf24', weight: 1, fillColor: '#fbbf24', fillOpacity: 0.05, opacity: 0.85 }
// Parcela resuelta bajo el pin real: verde, para asociarla con el pin real.
const HIGHLIGHT_STYLE = { color: '#22c55e', weight: 3, fillColor: '#22c55e', fillOpacity: 0.28, opacity: 1 }

export default function PropertyLocationMap({
  latitude, longitude, corredoraPins, realPin, onRealPinChange, highlightGeojson, showParcels = false, comunaCode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realMarkerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const corredoraLayerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelLayerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const highlightLayerRef = useRef<any>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const loadingRef = useRef(false)
  // Leaflet se carga con import() dinámico: hasta que resuelve no hay mapa. Sin
  // esta señal, los efectos que pintan capas corrían una sola vez con el mapa
  // todavía en null, salían por el early-return y —al no cambiar sus deps— ya
  // no volvían a correr: los pines de corredora NUNCA llegaban a dibujarse.
  const [ready, setReady] = useState(false)

  // Refs para que los listeners registrados una sola vez (al init) vean siempre
  // el valor actual de las props sin recrear el mapa.
  const onRealPinChangeRef = useRef(onRealPinChange)
  onRealPinChangeRef.current = onRealPinChange
  const realPinRef = useRef<LatLng | null | undefined>(realPin)
  realPinRef.current = realPin
  const showParcelsRef = useRef(showParcels)
  showParcelsRef.current = showParcels
  const comunaCodeRef = useRef(comunaCode)
  comunaCodeRef.current = comunaCode

  async function loadParcels() {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L || !showParcelsRef.current || map.getZoom() < MIN_ZOOM_PARCELS || loadingRef.current) return
    const b = map.getBounds()
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`
    // Con la comuna, las parcelas vienen ya filtradas por comuna (más rápido y
    // sin predios de comunas vecinas en el borde del viewport).
    const comuna = comunaCodeRef.current
    loadingRef.current = true
    try {
      const res = await fetch(`/api/chile/parcels-bbox?bbox=${bbox}${comuna ? `&comuna=${comuna}` : ''}`)
      const data = await res.json()
      if (!data.success || !data.features?.length) return
      if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
      const layer = L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
        style: PARCEL_STYLE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEachFeature(feature: any, flayer: any) {
          if (feature.properties?.rol) flayer.bindTooltip(`Rol ${feature.properties.rol}`, { sticky: true, direction: 'top' })
          flayer.on('mouseover', () => flayer.setStyle({ ...PARCEL_STYLE, weight: 2, fillOpacity: 0.15 }))
          flayer.on('mouseout', () => flayer.setStyle(PARCEL_STYLE))
          // Clic en una parcela = "el inmueble real es este": pone/mueve el pin
          // real ahí (el padre resuelve el rol desde esa posición).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          flayer.on('click', (e: any) => {
            onRealPinChangeRef.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng })
          })
        },
      }).addTo(map)
      parcelLayerRef.current = layer
      // El pin real y la parcela resaltada quedan por encima de la capa de predios.
      highlightLayerRef.current?.bringToFront?.()
      realMarkerRef.current?.setZIndexOffset?.(1000)
    } catch { /* ignore */ } finally {
      loadingRef.current = false
    }
  }

  // ── Init del mapa (una sola vez) ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((containerRef.current as any)._leaflet_id) return

    import('leaflet').then((L) => {
      if (!containerRef.current) return
      LRef.current = L

      const map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom: 18,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        preferCanvas: true,
      })

      // Satélite híbrido de Google (imagen + calles), sin API key — mismo patrón
      // que StreetViewMap/catastro. Google solo sirve mt0-mt3.
      L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        attribution: '',
        maxZoom: 21,
        maxNativeZoom: 20,
      }).addTo(map)
      L.control.zoom({ position: 'topright' }).addTo(map)

      // Clic en el mapa (fuera de una parcela): mueve el pin real SI ya existe.
      // La creación se hace con el botón "Agregar pin" o clicando una parcela —
      // así un clic al explorar no suelta un pin sin querer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on('click', (e: any) => {
        if (realPinRef.current) onRealPinChangeRef.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng })
      })

      // Recargar predios al mover/hacer zoom (solo con showParcels y zoom alto).
      map.on('moveend zoomend', () => {
        if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
        loadParcels()
      })

      mapRef.current = map

      // El contenedor cambia de tamaño al "agrandar" la ficha: invalidateSize
      // (diferido a rAF, para que corra tras el relayout) o el mapa queda cortado.
      const ro = new ResizeObserver(() => requestAnimationFrame(() => mapRef.current?.invalidateSize()))
      ro.observe(containerRef.current)
      resizeObserverRef.current = ro

      loadParcels()
      setReady(true)
    })

    return () => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        setReady(false)
        realMarkerRef.current = null
        corredoraLayerRef.current = null
        parcelLayerRef.current = null
        highlightLayerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Cargar/recargar parcelas cuando se activa el toggle ─────────────────────
  useEffect(() => {
    if (!mapRef.current) return
    if (!showParcels) {
      if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
      return
    }
    loadParcels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showParcels])

  // ── Pines declarados por cada corredora (numerados, un color cada uno) ──────
  // El número y el color coinciden con la leyenda de la ficha: así se sabe de un
  // vistazo qué pin declaró cada corredora, y cuál de todos es el verde (real).
  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return
    if (corredoraLayerRef.current) { corredoraLayerRef.current.remove(); corredoraLayerRef.current = null }
    if (!corredoraPins || corredoraPins.length === 0) return
    const group = L.layerGroup()
    corredoraPins.forEach((p, i) => {
      const color = corredoraColor(i)
      const icon = L.divIcon({
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.55);color:#fff;font:700 12px/22px system-ui,-apple-system,sans-serif;text-align:center">${i + 1}</div>`,
      })
      const m = L.marker([p.latitude, p.longitude], { icon, zIndexOffset: 400 })
      m.bindTooltip(`${i + 1} · ${p.label}`, { direction: 'top', offset: [0, -14] })
      group.addLayer(m)
    })
    group.addTo(map)
    corredoraLayerRef.current = group

    // Con varias corredoras los pines pueden caer fuera del encuadre inicial
    // (zoom 18 sobre el pin principal) y parecía que "no había pines". Encuadrar
    // todos garantiza que se vean; maxZoom evita acercarse de más si están juntos.
    const pts: [number, number][] = corredoraPins.map((p) => [p.latitude, p.longitude])
    const rp = realPinRef.current
    if (rp) pts.push([rp.latitude, rp.longitude])
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 18 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(corredoraPins), ready])

  // ── Pin real (verde, arrastrable) ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return
    if (!realPin) {
      if (realMarkerRef.current) { realMarkerRef.current.remove(); realMarkerRef.current = null }
      return
    }
    if (realMarkerRef.current) {
      realMarkerRef.current.setLatLng([realPin.latitude, realPin.longitude])
      return
    }
    // Verde + etiqueta "REAL": rodeado de pines numerados de colores, un círculo
    // más no bastaba para distinguir cuál es la corrección del equipo.
    const icon = L.divIcon({
      className: '',
      iconSize: [64, 48],
      iconAnchor: [32, 15],
      html: `<div style="display:flex;flex-direction:column;align-items:center;cursor:grab">
        <div style="width:28px;height:28px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.55)"></div>
        <div style="margin-top:3px;padding:1px 6px;border-radius:6px;background:#22c55e;border:1px solid rgba(255,255,255,.85);color:#052e16;font:700 9px/1.5 system-ui,-apple-system,sans-serif;letter-spacing:.05em;white-space:nowrap">REAL</div>
      </div>`,
    })
    const marker = L.marker([realPin.latitude, realPin.longitude], { icon, draggable: true, zIndexOffset: 1000 }).addTo(map)
    marker.bindTooltip('Pin real · arrástralo para corregir', { direction: 'top', offset: [0, -18] })
    marker.on('dragend', () => {
      const pos = marker.getLatLng()
      onRealPinChangeRef.current?.({ latitude: pos.lat, longitude: pos.lng })
    })
    realMarkerRef.current = marker
    // Solo recentrar si el pin real cae fuera del encuadre: si ya se ve, mover
    // el mapa sacaría de cuadro los pines de corredora recién encuadrados.
    if (!map.getBounds().contains([realPin.latitude, realPin.longitude])) {
      map.panTo([realPin.latitude, realPin.longitude], { animate: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realPin?.latitude, realPin?.longitude, ready])

  // ── Parcela resuelta bajo el pin real (resaltada en verde) ──────────────────
  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return
    if (highlightLayerRef.current) { highlightLayerRef.current.remove(); highlightLayerRef.current = null }
    if (!highlightGeojson) return
    const layer = L.geoJSON(highlightGeojson, { style: HIGHLIGHT_STYLE, interactive: false }).addTo(map)
    highlightLayerRef.current = layer
    realMarkerRef.current?.setZIndexOffset?.(1000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightGeojson, ready])

  return <div ref={containerRef} className="w-full h-full" />
}
