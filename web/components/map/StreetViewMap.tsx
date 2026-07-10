'use client'

import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import { useEffect, useRef, useState } from 'react'
import { formatCLP } from '@/lib/currency-formatter'

export interface StreetViewPin {
  lat: number
  lng: number
  label?: string
  geojson?: object | null
}

export interface DrawnShape {
  type: 'polygon' | 'circle' | 'rectangle'
  coordinates?: [number, number][]
  center?: [number, number]
  radius?: number
}

export type AnalyticLayer = 'none' | 'avaluo_m2' | 'tgr'

interface Props {
  center: { lat: number; lng: number }
  zoom?: number
  pin?: StreetViewPin | null
  comunaCode?: string | null
  onParcelClick?: (props: { rol: string; sii_comuna_code: string; comuna_name: string }) => void
  onZoomChange?: (zoom: number) => void
  /** Capa analítica sobre los polígonos (coropletas). Requiere enrich en la API. */
  analyticLayer?: AnalyticLayer
  /** Habilita el control de dibujo (polígono/rectángulo/círculo) para farming. */
  enableDraw?: boolean
  onShapeDrawn?: (shape: DrawnShape | null) => void
  /** Solo se usa para limpiar la capa dibujada cuando el padre la resetea a null. */
  drawnShape?: DrawnShape | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let leafletPromise: Promise<any> | null = null
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = import('leaflet').then(async (L) => {
      ;(window as any).L = L
      // leaflet-draw se registra sobre window.L — debe importarse después
      await import('leaflet-draw')
      return L
    })
  }
  return leafletPromise
}

const MIN_ZOOM_PARCELS = 15

// Rampa secuencial azul (5 tramos, monocroma, validada sobre superficie
// oscura): el extremo oscuro = valor bajo (se funde con el satélite), el
// claro = valor alto (resalta). Cortes por quintiles del viewport.
const SEQ_RAMP = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6']
const SEQ_STROKE = '#0d366b'
// Colores de estado reservados para la capa TGR (nunca se usan como serie).
const TGR_DEBT = '#d03b3b'
const TGR_CLEAN = '#0ca30c'
const NO_DATA = '#94a3b8'

const DEFAULT_STYLE = { color: '#fbbf24', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.06, opacity: 0.9 }

function quantileBreaks(values: number[], n = 5): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const breaks: number[] = []
  for (let i = 1; i < n; i++) {
    breaks.push(sorted[Math.min(sorted.length - 1, Math.floor((i / n) * sorted.length))])
  }
  return breaks
}

function bucketOf(v: number, breaks: number[]): number {
  let b = 0
  while (b < breaks.length && v >= breaks[b]) b++
  return b
}

interface LegendState {
  layer: AnalyticLayer
  breaks?: number[]
  tgrCounts?: { deuda: number; sinDeuda: number; sinDato: number }
}

export default function StreetViewMap({
  center, zoom = 17, pin, comunaCode, onParcelClick, onZoomChange,
  analyticLayer = 'none', enableDraw = false, onShapeDrawn, drawnShape,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedPolyRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelLayerRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawnItemsRef = useRef<any>(null)
  const loadingRef = useRef(false)
  const onParcelClickRef = useRef(onParcelClick)
  onParcelClickRef.current = onParcelClick
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const onShapeDrawnRef = useRef(onShapeDrawn)
  onShapeDrawnRef.current = onShapeDrawn
  // Refs para que loadParcels (capturado por el listener de moveend
  // registrado una sola vez al init) vea siempre los valores actuales.
  const comunaCodeRef = useRef(comunaCode)
  comunaCodeRef.current = comunaCode
  const analyticLayerRef = useRef<AnalyticLayer>(analyticLayer)
  analyticLayerRef.current = analyticLayer
  const breaksRef = useRef<number[]>([])

  const [legend, setLegend] = useState<LegendState | null>(null)
  const [currentZoom, setCurrentZoom] = useState(zoom)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function styleForProps(p: any) {
    const layer = analyticLayerRef.current
    if (layer === 'avaluo_m2') {
      const v = p.avaluo_por_m2
      if (v == null) return { color: NO_DATA, weight: 1, fillColor: NO_DATA, fillOpacity: 0.08, opacity: 0.6, dashArray: '3,3' }
      const idx = bucketOf(Number(v), breaksRef.current)
      return { color: SEQ_STROKE, weight: 1, fillColor: SEQ_RAMP[idx] ?? SEQ_RAMP[SEQ_RAMP.length - 1], fillOpacity: 0.55, opacity: 0.9 }
    }
    if (layer === 'tgr') {
      if (p.tiene_deuda === true) return { color: '#7f1d1d', weight: 1.5, fillColor: TGR_DEBT, fillOpacity: 0.55, opacity: 1 }
      if (p.tiene_deuda === false) return { color: '#14532d', weight: 1, fillColor: TGR_CLEAN, fillOpacity: 0.3, opacity: 0.9 }
      return { color: NO_DATA, weight: 1, fillColor: NO_DATA, fillOpacity: 0.06, opacity: 0.5, dashArray: '3,3' }
    }
    return DEFAULT_STYLE
  }

  async function loadParcels() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any
    const L = (window as any).L
    if (!map || !L || map.getZoom() < MIN_ZOOM_PARCELS || loadingRef.current) return

    const b = map.getBounds()
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`
    const comuna = comunaCodeRef.current
    const analytic = analyticLayerRef.current
    const url = `/api/chile/parcels-bbox?bbox=${bbox}${comuna ? `&comuna=${comuna}` : ''}${analytic !== 'none' ? '&enrich=1' : ''}`

    loadingRef.current = true
    try {
      const res = await fetch(url)
      const data = await res.json()
      if (!data.success || !data.features?.length) {
        if (analytic !== 'none') setLegend(null)
        return
      }

      if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }

      // Cortes por quintiles del viewport actual (coropleta avalúo/m²) y
      // conteos para la leyenda TGR.
      if (analytic === 'avaluo_m2') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const values = data.features.map((f: any) => f.properties.avaluo_por_m2).filter((v: unknown) => v != null).map(Number)
        breaksRef.current = values.length >= SEQ_RAMP.length ? quantileBreaks(values, SEQ_RAMP.length) : []
        setLegend({ layer: 'avaluo_m2', breaks: breaksRef.current })
      } else if (analytic === 'tgr') {
        let deuda = 0, sinDeuda = 0, sinDato = 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.features.forEach((f: any) => {
          if (f.properties.tiene_deuda === true) deuda++
          else if (f.properties.tiene_deuda === false) sinDeuda++
          else sinDato++
        })
        setLegend({ layer: 'tgr', tgrCounts: { deuda, sinDeuda, sinDato } })
      } else {
        setLegend(null)
      }

      const layer = L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style: (feature: any) => styleForProps(feature?.properties ?? {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEachFeature(feature: any, flayer: any) {
          const base = styleForProps(feature.properties ?? {})
          flayer.on('click', () => {
            const p = feature.properties
            onParcelClickRef.current?.({ rol: p.rol, sii_comuna_code: p.sii_comuna_code, comuna_name: p.comuna_name })
            flayer.setStyle({ ...base, fillOpacity: Math.min((base.fillOpacity ?? 0.1) + 0.25, 0.8), weight: 2.5 })
            setTimeout(() => flayer.setStyle(base), 1500)
          })
          flayer.on('mouseover', () => flayer.setStyle({ ...base, weight: 2.5, fillOpacity: Math.min((base.fillOpacity ?? 0.1) + 0.12, 0.75) }))
          flayer.on('mouseout',  () => flayer.setStyle(base))
          // Tooltip con el dato de la capa activa
          const p = feature.properties
          if (analytic === 'avaluo_m2' && p.avaluo_por_m2 != null) {
            flayer.bindTooltip(`${p.rol} · ${formatCLP(p.avaluo_por_m2)}/m²`, { sticky: true, direction: 'top' })
          } else if (analytic === 'tgr' && p.tiene_deuda != null) {
            flayer.bindTooltip(`${p.rol} · ${p.tiene_deuda ? 'CON deuda TGR' : 'sin deuda'}`, { sticky: true, direction: 'top' })
          }
        },
      }).addTo(map)

      parcelLayerRef.current = layer
      // La zona dibujada y el polígono seleccionado deben quedar por encima
      if (drawnItemsRef.current) drawnItemsRef.current.bringToFront?.()
      if (selectedPolyRef.current) selectedPolyRef.current.bringToFront?.()
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
        preferCanvas: true,
        inertia: true,
        inertiaDeceleration: 3500,
      })

      // Satélite híbrido de Google (lyrs=y: imagen + nombres de calles en una
      // sola capa), tiles estáticos gratis sin API key — mismo patrón que
      // ListingMatchMap. Sustituye a las dos capas Esri anteriores.
      L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        attribution: '© Google',
        maxZoom: 21,
        maxNativeZoom: 20,
        className: 'satellite-layer',
      }).addTo(map)

      // Control de dibujo para farming por zona (polígono/rect/círculo)
      if (enableDraw) {
        const drawnItems = new (L as any).FeatureGroup()
        map.addLayer(drawnItems)
        drawnItemsRef.current = drawnItems

        const drawControl = new (L as any).Control.Draw({
          position: 'topleft',
          edit: { featureGroup: drawnItems, remove: true },
          draw: {
            polygon: { shapeOptions: { color: '#22d3ee', fillOpacity: 0.1, weight: 2 } },
            circle: { shapeOptions: { color: '#22d3ee', fillOpacity: 0.1, weight: 2 } },
            rectangle: { shapeOptions: { color: '#22d3ee', fillOpacity: 0.1, weight: 2 } },
            polyline: false,
            marker: false,
            circlemarker: false,
          },
        })
        map.addControl(drawControl)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shapeFromLayer = (layer: any, layerType?: string): DrawnShape => {
          if (layerType === 'circle' || typeof layer.getRadius === 'function') {
            const c = layer.getLatLng()
            return { type: 'circle', center: [c.lat, c.lng], radius: layer.getRadius() }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords: [number, number][] = layer.getLatLngs()[0].map((ll: any) => [ll.lat, ll.lng])
          coords.push(coords[0])
          return { type: layerType === 'rectangle' ? 'rectangle' : 'polygon', coordinates: coords }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on((L as any).Draw.Event.CREATED, (e: any) => {
          drawnItems.clearLayers()
          drawnItems.addLayer(e.layer)
          onShapeDrawnRef.current?.(shapeFromLayer(e.layer, e.layerType))
        })
        map.on((L as any).Draw.Event.DELETED, () => onShapeDrawnRef.current?.(null))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on((L as any).Draw.Event.EDITED, (e: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          e.layers.eachLayer((layer: any) => onShapeDrawnRef.current?.(shapeFromLayer(layer)))
        })
      }

      mapRef.current = map

      // Cargar predios al mover/hacer zoom
      map.on('moveend zoomend', () => {
        const z = map.getZoom()
        setCurrentZoom(z)
        onZoomChangeRef.current?.(z)
        if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
        if (z >= MIN_ZOOM_PARCELS) loadParcels()
        else setLegend(null)
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

  // Recargar parcelas con el nuevo estilo cuando cambia la capa analítica
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
    if (analyticLayer === 'none') setLegend(null)
    if (map.getZoom() >= MIN_ZOOM_PARCELS) loadParcels()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyticLayer])

  // Limpiar la capa dibujada cuando el padre resetea la zona
  useEffect(() => {
    if (drawnShape == null && drawnItemsRef.current) drawnItemsRef.current.clearLayers()
  }, [drawnShape])

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

  const showLegend = analyticLayer !== 'none' && legend && currentZoom >= MIN_ZOOM_PARCELS

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Leyenda de la capa analítica */}
      {showLegend && legend.layer === 'avaluo_m2' && (
        <div className="absolute bottom-6 left-2 z-[1000] rounded-lg bg-black/70 backdrop-blur px-3 py-2 pointer-events-none">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-white/80 mb-1.5">Avalúo fiscal $/m²</p>
          {legend.breaks && legend.breaks.length > 0 ? (
            <div className="space-y-0.5">
              {SEQ_RAMP.map((color, i) => {
                const lo = i === 0 ? null : legend.breaks![i - 1]
                const hi = i < legend.breaks!.length ? legend.breaks![i] : null
                const label = lo == null ? `< ${formatCLP(hi!)}` : hi == null ? `≥ ${formatCLP(lo)}` : `${formatCLP(lo)} – ${formatCLP(hi)}`
                return (
                  <div key={color} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: color, opacity: 0.85 }} />
                    <span className="text-[10px] text-white/90">{label}</span>
                  </div>
                )
              })}
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="w-3 h-3 rounded-sm flex-shrink-0 border border-dashed" style={{ borderColor: NO_DATA }} />
                <span className="text-[10px] text-white/60">Sin dato SII</span>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-white/60">Muy pocos predios con dato en el viewport</p>
          )}
        </div>
      )}
      {showLegend && legend.layer === 'tgr' && legend.tgrCounts && (
        <div className="absolute bottom-6 left-2 z-[1000] rounded-lg bg-black/70 backdrop-blur px-3 py-2 pointer-events-none">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-white/80 mb-1.5">Deuda TGR (contribuciones)</p>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: TGR_DEBT }} />
              <span className="text-[10px] text-white/90">⚠ Con deuda · {legend.tgrCounts.deuda}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: TGR_CLEAN, opacity: 0.7 }} />
              <span className="text-[10px] text-white/90">✓ Sin deuda · {legend.tgrCounts.sinDeuda}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm flex-shrink-0 border border-dashed" style={{ borderColor: NO_DATA }} />
              <span className="text-[10px] text-white/60">Sin certificado · {legend.tgrCounts.sinDato}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
