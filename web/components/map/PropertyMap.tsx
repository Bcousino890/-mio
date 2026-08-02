'use client'

import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import { useEffect, useRef, useState } from 'react'
import type { Listing } from '@/lib/types'
import type { GeoShapeFilter } from '@/components/filters/FilterPanel'

interface Props {
  listings: Listing[]
  activeId?: string | null
  onMarkerClick?: (id: string) => void
  onMarkerHover?: (id: string | null) => void
  onShapeDrawn?: (shape: GeoShapeFilter | null) => void
  activeShape?: GeoShapeFilter | null
  /** 'carto' (por defecto, España, una sola capa fija) | 'satellite' (Chile:
   * tiles de Google sin API key, mismo patrón que StreetViewMap.tsx/
   * DetailMap.tsx, con un botón "Mapa"/"Satélite" para alternar entre las dos
   * vistas de Google — nunca Carto/OSM). */
  tileStyle?: 'carto' | 'satellite'
}

function fmtPrice(l: Listing) {
  const { price: n, operation: op, currency } = l
  if (currency === 'CLP') {
    // Precio TAL COMO LO PUBLICA el portal (mismo criterio que priceMain() en
    // PropertyClModal): en el barrio alto casi todo se publica en UF, y forzar
    // la conversión a CLP daba una precisión falsa además de no matchear lo
    // que el portal (y sus propios mapas) realmente muestran en el pin.
    if (l.price_uf != null) {
      const k = `UF ${Math.round(l.price_uf).toLocaleString('es-CL')}`
      return op === 'rent' ? `${k}/mes` : k
    }
    // CLP: montos altos (cientos de millones) — abreviar en M sin símbolo €.
    const k = n >= 1_000_000
      ? `$${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 0 })}M`
      : `$${n.toLocaleString('es-CL')}`
    return op === 'rent' ? `${k}/mes` : k
  }
  if (op === 'rent') return `${n.toLocaleString('es-ES')} €/mes`
  const k = n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString('es-ES', { minimumFractionDigits: n % 1_000_000 !== 0 ? 1 : 0, maximumFractionDigits: 1 })} M€`
    : `${Math.round(n / 1000)} K€`
  return k
}

function markerHtml(l: Listing, isActive: boolean) {
  const priceStr = fmtPrice(l)
  const isPartic = l.advertiser_type === 'particular'
  const bg = isActive ? '#3b82f6' : '#ffffff'
  const text = isActive ? '#ffffff' : '#0f172a'
  const border = isActive ? 'transparent' : 'rgba(0,0,0,0.12)'
  const shadow = isActive
    ? '0 4px 16px rgba(59,130,246,0.5)'
    : '0 2px 8px rgba(0,0,0,0.25)'
  const dot = isPartic && !isActive ? 'background:#f59e0b;' : ''
  const dotHtml = isPartic ? `<span style="width:6px;height:6px;border-radius:50%;${dot || 'background:#3b82f6;'}display:inline-block;flex-shrink:0"></span>` : ''

  return `<div class="cf-pin" style="
    background:${bg};
    color:${text};
    border:1px solid ${border};
    border-radius:999px;
    padding:4px 10px;
    font-size:12px;
    font-weight:700;
    font-family:system-ui,-apple-system,sans-serif;
    white-space:nowrap;
    box-shadow:${shadow};
    display:flex;
    align-items:center;
    gap:5px;
    cursor:pointer;
    letter-spacing:-0.01em;
  ">${dotHtml}${priceStr}</div>`
}

// leaflet.markercluster's UMD bundle reads the bare global `L` instead of
// importing it, so `window.L` must be set before it loads. Memoized so the
// load (and the global wiring) happens exactly once, even if effects that
// call this run more than once (e.g. React StrictMode's double-invoke).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let leafletPromise: Promise<any> | null = null
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = import('leaflet').then(async (L) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).L = L
      await import('leaflet.markercluster')
      await import('leaflet-draw')
      return L
    })
  }
  return leafletPromise
}

// Tiles de Google servidos directo (sin API key) — mismo patrón que
// StreetViewMap.tsx/DetailMap.tsx. roadmap = calles (equivalente al "Mapa" de
// Google Maps); satellite = híbrido (imagen + nombres de calles, lyrs=y).
const GOOGLE_TILE_URL = {
  roadmap: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
  satellite: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
}

// Píldora blanca "N unidades" — misma familia visual que el pin de precio
// (markerHtml) y el mismo formato que ya usa el mapa de Portal Inmobiliario
// para agrupar varios avisos en un punto cercano, en vez de un círculo con
// solo el número.
function clusterLabel(count: number) {
  return `${count.toLocaleString('es-CL')} unidad${count === 1 ? '' : 'es'}`
}

function clusterHtml(count: number) {
  return `<div class="cf-pin" style="
    background:#ffffff;
    color:#0f172a;
    border:1px solid rgba(0,0,0,0.12);
    border-radius:999px;
    padding:6px 12px;
    font-size:12px;
    font-weight:700;
    font-family:system-ui,-apple-system,sans-serif;
    white-space:nowrap;
    box-shadow:0 3px 10px rgba(0,0,0,0.3);
    display:flex;
    align-items:center;
    justify-content:center;
    cursor:pointer;
    letter-spacing:-0.01em;
  ">${clusterLabel(count)}</div>`
}

// Ancho aproximado de la píldora según el texto ("2 unidades" vs "128
// unidades") — un iconSize fijo o bien recortaba los números grandes o
// dejaba un div flotando de más en los chicos.
function clusterIconSize(count: number): [number, number] {
  const width = 26 + clusterLabel(count).length * 6.6
  return [Math.round(width), 28]
}

export default function PropertyMap({ listings, activeId, onMarkerClick, onMarkerHover, onShapeDrawn, activeShape, tileStyle = 'carto' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Record<string, any>>({})
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterGroupRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawnItemsRef = useRef<any>(null)
  const initializingRef = useRef(false)
  // El mapa se crea una sola vez (async: Leaflet se carga bajo demanda). Los
  // marcadores, en cambio, se rehacen cada vez que cambian los anuncios — por
  // eso hace falta saber cuándo el mapa ya existe.
  const [mapReady, setMapReady] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileLayerRef = useRef<any>(null)
  // Submodo de Google (tileStyle='satellite'): "Mapa" (roadmap) o "Satélite"
  // (híbrido) — las dos vistas que pide Chile, siempre tiles de Google, nunca
  // Carto. No aplica cuando tileStyle='carto' (España sigue con una sola capa).
  const [googleMapType, setGoogleMapType] = useState<'roadmap' | 'satellite'>('satellite')

  useEffect(() => {
    if (!containerRef.current) return
    if (initializingRef.current) return
    initializingRef.current = true

    let cancelled = false

    loadLeaflet().then(async (L) => {
      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        // Centro provisional (Madrid) solo hasta que haya anuncios: en cuanto
        // llegan, el efecto de marcadores encuadra el mapa sobre ELLOS. Sin
        // eso, /chile/anuncios abría el mapa en Madrid con los pines de
        // Santiago fuera de pantalla.
        center: [40.4300, -3.6900],
        zoom: 13,
        zoomControl: false,
        attributionControl: false,
      })

      if (tileStyle === 'satellite') {
        // Tiles de Google servidos directo, sin API key — mismo patrón que
        // StreetViewMap.tsx/DetailMap.tsx. Arranca en "Satélite"; el botón de
        // abajo cambia la URL de esta MISMA capa a "Mapa" (roadmap), sin
        // recrear el mapa ni perder marcadores/zoom/zona dibujada.
        tileLayerRef.current = L.tileLayer(GOOGLE_TILE_URL[googleMapType], {
          subdomains: ['0', '1', '2', '3'],
          attribution: '© Google',
          maxZoom: 21,
          maxNativeZoom: 20,
        }).addTo(map)
      } else {
        // Carto light for contrast with our dark UI
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '© OpenStreetMap © CARTO',
          maxZoom: 20,
        }).addTo(map)
      }

      // Custom zoom controls placement
      L.control.zoom({ position: 'topright' }).addTo(map)
      L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clusterGroup = (L as any).markerClusterGroup({
        maxClusterRadius: 60,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        // El click de cluster se maneja a mano (clusterclick, más abajo): un
        // edificio con varias unidades comparte la MISMA coordenada, así que
        // acercar el zoom (zoomToBoundsOnClick) nunca las separa — hacía
        // falta seguir haciendo zoom manualmente hasta el tope para que
        // spiderfyOnMaxZoom recién ahí las abriera.
        zoomToBoundsOnClick: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        iconCreateFunction: (cluster: any) => {
          const count = cluster.getChildCount()
          return L.divIcon({
            className: '',
            html: clusterHtml(count),
            iconSize: L.point(...clusterIconSize(count)),
          })
        },
      })

      // Mismo punto exacto (edificio/condominio con varias unidades) → abrir
      // en abanico DE UNA, sin importar el zoom, para poder elegir cuál ver.
      // Zona con propiedades cercanas pero distintas → acercar el zoom, igual
      // que antes (zoomToBoundsOnClick).
      clusterGroup.on('clusterclick', (e: any) => {
        const cluster = e.layer
        const children = cluster.getAllChildMarkers()
        const first = children[0]?.getLatLng()
        const samePoint = first && children.every((m: any) => m.getLatLng().distanceTo(first) < 1)
        if (samePoint) {
          cluster.spiderfy()
        } else {
          map.fitBounds(cluster.getBounds(), { padding: [64, 64], maxZoom: 18 })
        }
      })

      map.addLayer(clusterGroup)
      clusterGroupRef.current = clusterGroup
      mapRef.current = map
      setMapReady(true)

      // Draw feature group to hold drawn shapes
      const drawnItems = new (L as any).FeatureGroup()
      map.addLayer(drawnItems)
      drawnItemsRef.current = drawnItems

      const drawControl = new (L as any).Control.Draw({
        edit: { featureGroup: drawnItems, remove: true },
        draw: {
          polygon: {
            allowIntersection: false,
            shapeOptions: { color: '#3b82f6', fillOpacity: 0.12, weight: 2 },
          },
          circle: {
            shapeOptions: { color: '#3b82f6', fillOpacity: 0.12, weight: 2 },
          },
          rectangle: {
            shapeOptions: { color: '#3b82f6', fillOpacity: 0.12, weight: 2 },
          },
          polyline: false,
          marker: false,
          circlemarker: false,
        },
      })
      map.addControl(drawControl)

      // Handle draw:created
      map.on((L as any).Draw.Event.CREATED, (e: any) => {
        drawnItems.clearLayers()
        drawnItems.addLayer(e.layer)

        const layerType = e.layerType
        let shape: GeoShapeFilter | null = null

        if (layerType === 'circle') {
          const center = e.layer.getLatLng()
          const radius = e.layer.getRadius()
          shape = {
            type: 'circle',
            center: [center.lat, center.lng],
            radius,
          }
        } else if (layerType === 'polygon' || layerType === 'rectangle') {
          const latlngs = e.layer.getLatLngs()[0]
          const coordinates: [number, number][] = latlngs.map((ll: any) => [ll.lat, ll.lng])
          // Close the polygon
          coordinates.push(coordinates[0])
          shape = {
            type: layerType === 'rectangle' ? 'rectangle' : 'polygon',
            coordinates,
          }
        }

        onShapeDrawn?.(shape)
      })

      // Handle draw:deleted (clear all)
      map.on((L as any).Draw.Event.DELETED, () => {
        onShapeDrawn?.(null)
      })

      // Handle draw:edited
      map.on((L as any).Draw.Event.EDITED, (e: any) => {
        const layers = e.layers
        layers.eachLayer((layer: any) => {
          if (typeof layer.getRadius === 'function') {
            const center = layer.getLatLng()
            const radius = layer.getRadius()
            onShapeDrawn?.({ type: 'circle', center: [center.lat, center.lng], radius })
          } else {
            const latlngs = layer.getLatLngs()[0]
            const coordinates: [number, number][] = latlngs.map((ll: any) => [ll.lat, ll.lng])
            coordinates.push(coordinates[0])
            onShapeDrawn?.({ type: 'polygon', coordinates })
          }
        })
      })
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

  // Botón "Mapa"/"Satélite": cambia la URL de la MISMA capa de tiles (Leaflet
  // reutiliza la caché de tiles ya pedidos) en vez de quitar/agregar la capa.
  useEffect(() => {
    if (tileStyle !== 'satellite' || !tileLayerRef.current) return
    tileLayerRef.current.setUrl(GOOGLE_TILE_URL[googleMapType])
  }, [googleMapType, tileStyle])

  // Marcadores: se rehacen cada vez que cambia la lista (búsqueda, filtros,
  // página). Antes se creaban DENTRO del efecto de inicialización, que corre una
  // sola vez al montar: si los anuncios llegaban después —el caso normal, la
  // lista se pide por fetch— el mapa se quedaba para siempre sin un solo pin.
  // Al terminar se encuadra el mapa sobre los pines, así queda sobre la ciudad
  // de los resultados (Santiago en Chile) en vez del centro fijo de arranque.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !clusterGroupRef.current) return
    let cancelled = false

    loadLeaflet().then((L) => {
      if (cancelled || !mapRef.current || !clusterGroupRef.current) return
      const map = mapRef.current
      const clusterGroup = clusterGroupRef.current

      clusterGroup.clearLayers()
      markersRef.current = {}

      const points: [number, number][] = []

        listings.forEach((l) => {
          const icon = L.divIcon({
            className: '',
            html: markerHtml(l, false),
            iconAnchor: [0, 0],
          })

          const isClp = l.currency === 'CLP'
          const priceFull = isClp
            ? l.price.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
            : `${l.price.toLocaleString('es-ES')} €`
          const priceSqmFull = isClp
            ? `${l.price_sqm.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })}/m²`
            : `${l.price_sqm.toLocaleString('es-ES')} €/m²`
          const ufLine = isClp && l.price_uf != null
            ? `<div style="color:#64748b;font-size:11px;margin-top:1px">≈ ${l.price_uf.toLocaleString('es-CL')} UF</div>` : ''
          const marker = L.marker([l.latitude, l.longitude], { icon })
            .bindPopup(`
              <div style="min-width:200px;font-family:system-ui;font-size:13px;line-height:1.5;padding:2px">
                <div style="font-weight:700;font-size:14px;color:#0f172a">${priceFull}</div>
                ${ufLine}
                <div style="color:#64748b;font-size:11px;margin-top:1px">${priceSqmFull} · ${l.square_meters}m² · ${l.bedrooms > 0 ? l.bedrooms + 'h · ' : ''}${l.bathrooms}b</div>
                <div style="margin-top:5px;font-size:12px;color:#1e293b;font-weight:500">${l.title}</div>
                <div style="color:#94a3b8;font-size:11px;margin-top:1px">${l.zone_name}</div>
                ${l.listing_count > 1 ? `<div style="color:#3b82f6;font-size:11px;margin-top:3px;font-weight:600">${l.listing_count} fuentes</div>` : ''}
              </div>
            `, { maxWidth: 240, offset: [0, 4] })

          marker.on('click', () => {
            onMarkerClick?.(l.id)
          })
          marker.on('mouseover', () => onMarkerHover?.(l.id))
          marker.on('mouseout', () => onMarkerHover?.(null))

          markersRef.current[l.id] = marker
          clusterGroup.addLayer(marker)
          points.push([l.latitude, l.longitude])
        })

      if (points.length > 0) {
        // maxZoom: con un solo resultado, fitBounds se iría al zoom máximo y se
        // perdería el contexto del barrio.
        map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 })
      }
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, mapReady])

  // Update active marker style
  useEffect(() => {
    if (!mapRef.current) return
    loadLeaflet().then((L) => {
      Object.entries(markersRef.current).forEach(([id, marker]) => {
        const l = listings.find((x) => x.id === id)
        if (!l) return
        const isActive = id === activeId
        marker.setIcon(L.divIcon({
          className: '',
          html: markerHtml(l, isActive),
          iconAnchor: [0, 0],
        }))
        marker.setZIndexOffset(isActive ? 1000 : 0)
      })

      const activeMarker = activeId ? markersRef.current[activeId] : null
      if (activeMarker && clusterGroupRef.current) {
        // Reveals the marker first (zooming/spiderfying out of its cluster if needed)
        clusterGroupRef.current.zoomToShowLayer(activeMarker, () => {
          activeMarker.openPopup()
        })
      }
    })
  }, [activeId, listings])

  return (
    // `isolate` (contexto de apilamiento propio) es la parte que importa:
    // sin él, el z-index interno de Leaflet (los panes van de 200 a 700,
    // los controles ~1000) y el de los overlays de abajo (z-[1000]) se
    // comparan contra el resto de la PÁGINA entera en vez de quedarse
    // contenidos dentro del mapa — cualquier dropdown de la página con un
    // z-index menor (ej. el selector de orden, z-50) terminaba con el mapa
    // pintado ENCIMA en cuanto sus cajas se superponían, aunque el dropdown
    // estuviera "más arriba" en el documento.
    <div className="relative isolate w-full h-full">
      {/* Motion con criterio, no decoración: el hover de pin/cluster confirma
          que son clicables (mismo lift sutil que un mapa nativo), y el badge
          de zona dibujada entra con un fundido corto porque aparece como
          consecuencia directa de un gesto del usuario (dibujar) — no un
          elemento estático que no necesita anunciar su llegada. */}
      <style>{`
        .cf-pin { transition: transform .18s cubic-bezier(0.16,1,0.3,1), box-shadow .18s cubic-bezier(0.16,1,0.3,1); }
        .cf-pin:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.35); }
        @keyframes cf-badge-in { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
        .cf-badge-in { animation: cf-badge-in .22s cubic-bezier(0.16,1,0.3,1); }
      `}</style>
      <div ref={containerRef} className="w-full h-full" />
      {/* Draw mode indicator + clear button */}
      {activeShape && (
        <div className="cf-badge-in absolute top-3 left-1/2 z-[1000] flex items-center gap-2 bg-blue-600/90 backdrop-blur border border-blue-500/50 rounded-full px-3 py-1.5 text-xs text-white font-medium shadow-lg">
          <span>Zona dibujada activa</span>
          <button
            onClick={() => {
              drawnItemsRef.current?.clearLayers()
              onShapeDrawn?.(null)
            }}
            className="w-4 h-4 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            ×
          </button>
        </div>
      )}
      {/* Map legend */}
      <div className="absolute bottom-5 left-4 z-[1000] bg-white/95 backdrop-blur border border-black/8 rounded-xl px-3 py-2 text-xs text-slate-600 space-y-1 pointer-events-none shadow-md">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block flex-shrink-0" />
          Particular
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block flex-shrink-0" />
          Agencia / Portal
        </div>
      </div>
      {/* Mapa / Satélite — las dos vistas de Google, como el control nativo de
          Google Maps. Solo aplica en modo satellite (Chile); España sigue con
          una sola capa Carto fija. */}
      {tileStyle === 'satellite' && (
        <div className="absolute bottom-5 right-4 z-[1000] flex rounded-lg overflow-hidden shadow-lg border border-black/10">
          <button
            onClick={() => setGoogleMapType('roadmap')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${googleMapType === 'roadmap' ? 'bg-blue-600 text-white' : 'bg-white/95 text-slate-700 hover:bg-white'}`}
          >
            Mapa
          </button>
          <button
            onClick={() => setGoogleMapType('satellite')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${googleMapType === 'satellite' ? 'bg-blue-600 text-white' : 'bg-white/95 text-slate-700 hover:bg-white'}`}
          >
            Satélite
          </button>
        </div>
      )}
    </div>
  )
}
