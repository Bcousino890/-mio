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
//
// ── Giro del mapa (brújula) ──────────────────────────────────────────────────
// Leaflet no sabe rotar. Se resuelve sin plugin (leaflet-rotate es GPL-3.0 y
// contagiaría la licencia de toda la app) girando por CSS el contenedor de
// Leaflet dentro de un recuadro que recorta:
//
//   · El contenedor es un CUADRADO del tamaño de la diagonal del recuadro
//     visible, centrado en él: así, gire lo que gire, nunca se ven esquinas
//     vacías. `syncSize` lo recalcula en cada resize.
//   · Leaflet sigue trabajando en su espacio SIN girar (el del cuadrado), que
//     es justo lo que necesitan sus capas, el canvas y los tiles. Solo hay que
//     traducir lo que viene del ratón:
//       – `mouseEventToContainerPoint` se parchea en la INSTANCIA del mapa
//         (nunca en el prototipo: otros mapas de la app comparten el mismo L)
//         para deshacer el giro. De ahí cuelgan clic, dblclick, hit-test del
//         canvas de parcelas y el zoom con rueda.
//       – Los dos `L.Draggable` en juego (arrastre del mapa y del pin real)
//         mueven según el desplazamiento en pantalla: se les gira el delta.
//   · Los pines y los tooltips se contra-giran con la variable CSS
//     `--map-bearing-inv` para que el texto siga leyéndose derecho.
// ─────────────────────────────────────────────────────────────────────────────

import 'leaflet/dist/leaflet.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Minus, Maximize2, Minimize2, Crosshair, Layers } from 'lucide-react'
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
  /** Alterna la capa de parcelas. Si falta, no se dibuja el botón dentro del mapa. */
  onToggleParcels?: () => void
  /** Código de comuna SII: las parcelas se cargan ya filtradas por comuna. */
  comunaCode?: string | null
  /** El mapa está a pantalla completa (lo decide el padre, que agranda el contenedor). */
  expanded?: boolean
  /** Alterna pantalla completa. Si falta, no se dibuja el botón de agrandar. */
  onToggleExpand?: () => void
}

const MIN_ZOOM_PARCELS = 16

// Estilo de las parcelas: mismo naranja del visor de catastro (StreetViewMap).
const PARCEL_STYLE = { color: '#fbbf24', weight: 1, fillColor: '#fbbf24', fillOpacity: 0.05, opacity: 0.85 }
// Parcela resuelta bajo el pin real: verde, para asociarla con el pin real.
const HIGHLIGHT_STYLE = { color: '#22c55e', weight: 3, fillColor: '#22c55e', fillOpacity: 0.28, opacity: 1 }

// Límites de zoom del mapa. Se fijan explícitamente (antes se heredaban del
// tile layer) para que los botones + / − sepan cuándo deshabilitarse.
const MIN_ZOOM = 10
const MAX_ZOOM = 21

// Contra-giro: todo lo que lleva TEXTO dentro del mapa (pines, tooltips) usa
// esta transformación para quedarse derecho aunque el mapa esté girado. El
// valor de la variable lo pone `applyBearing` sobre el contenedor de Leaflet.
const UPRIGHT = 'transform:rotate(var(--map-bearing-inv,0deg))'

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
}

/** Contenido de tooltip que se mantiene horizontal aunque el mapa esté girado. */
function upright(html: string) {
  return `<span style="display:inline-block;${UPRIGHT}">${html}</span>`
}

/** Grados normalizados a [0, 360). */
function normalizeBearing(deg: number) {
  return ((deg % 360) + 360) % 360
}

/**
 * Brújula: muestra hacia dónde quedaron el norte/sur/este/oeste tras girar el
 * mapa, y sirve de mando para girarlo (arrastrar la aguja hacia donde se quiere
 * que apunte el norte). Un clic sin arrastrar vuelve al norte arriba.
 */
function CompassDial({ bearing, onBearing }: { bearing: number; onBearing: (deg: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const draggedRef = useRef(false)

  // Ángulo del puntero respecto al centro del dial, en la misma convención que
  // el `rotate()` del mapa: 0 = arriba, positivo = horario.
  const angleAt = (clientX: number, clientY: number) => {
    const el = ref.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    const dx = clientX - (r.left + r.width / 2)
    const dy = clientY - (r.top + r.height / 2)
    return (Math.atan2(dx, -dy) * 180) / Math.PI
  }

  const rotated = Math.round(bearing) % 360 !== 0

  return (
    <div className="absolute bottom-2 right-2 z-[900] flex items-center gap-1.5">
      {rotated && (
        <span className="px-1.5 py-0.5 rounded-md bg-black/65 backdrop-blur-sm border border-white/15 text-[10px] font-medium text-white/85 tabular-nums">
          {Math.round(bearing)}°
        </span>
      )}
      <button
        ref={ref}
        type="button"
        title="Brújula — arrastra para girar el mapa (la aguja roja marca el norte). Clic para volver al norte arriba."
        aria-label={`Girar el mapa. Orientación actual: ${Math.round(bearing)} grados`}
        className="w-12 h-12 rounded-full bg-black/65 backdrop-blur-sm border border-white/15 shadow-lg cursor-grab active:cursor-grabbing touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        onPointerDown={(e) => {
          // preventDefault corta la selección de texto al arrastrar, pero también
          // el foco: se pide a mano para no perder el manejo por teclado.
          e.preventDefault()
          draggedRef.current = false
          ref.current?.focus()
          ref.current?.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!ref.current?.hasPointerCapture(e.pointerId)) return
          draggedRef.current = true
          onBearing(angleAt(e.clientX, e.clientY))
        }}
        onPointerUp={(e) => {
          if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId)
          // Clic seco = "vuelve a poner el norte arriba".
          if (!draggedRef.current) onBearing(0)
        }}
        onKeyDown={(e) => {
          // Teclado: pasos de 5° para afinar sin pulso, Inicio para reencuadrar.
          if (e.key === 'ArrowLeft') { e.preventDefault(); onBearing(bearing - 5) }
          else if (e.key === 'ArrowRight') { e.preventDefault(); onBearing(bearing + 5) }
          else if (e.key === 'Home') { e.preventDefault(); onBearing(0) }
        }}
      >
        {/* La rosa gira con el mapa: la N acaba apuntando al norte real en pantalla. */}
        <svg viewBox="0 0 48 48" className="w-full h-full pointer-events-none" style={{ transform: `rotate(${bearing}deg)` }}>
          <circle cx="24" cy="24" r="21.5" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="1" />
          <polygon points="24,11 28.5,25.5 19.5,25.5" fill="#f43f5e" />
          <polygon points="24,37 28.5,25.5 19.5,25.5" fill="rgba(255,255,255,.7)" />
          <circle cx="24" cy="25.5" r="1.8" fill="#0f172a" stroke="rgba(255,255,255,.6)" strokeWidth="0.8" />
          <g fontSize="7.5" fontWeight="700" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">
            <text x="24" y="8" fill="#fb7185">N</text>
            <text x="24" y="46" fill="rgba(255,255,255,.6)">S</text>
            <text x="43" y="27" fill="rgba(255,255,255,.6)">E</text>
            <text x="5" y="27" fill="rgba(255,255,255,.6)">O</text>
          </g>
        </svg>
      </button>
    </div>
  )
}

export default function PropertyLocationMap({
  latitude, longitude, corredoraPins, realPin, onRealPinChange, highlightGeojson,
  showParcels = false, onToggleParcels, comunaCode,
  expanded = false, onToggleExpand,
}: Props) {
  // Recuadro visible (recorta) y, dentro, el cuadrado de Leaflet que gira.
  const viewportRef = useRef<HTMLDivElement>(null)
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
  const wheelAccRef = useRef(0)
  const wheelCleanupRef = useRef<(() => void) | null>(null)
  // Leaflet se carga con import() dinámico: hasta que resuelve no hay mapa. Sin
  // esta señal, los efectos que pintan capas corrían una sola vez con el mapa
  // todavía en null, salían por el early-return y —al no cambiar sus deps— ya
  // no volvían a correr: los pines de corredora NUNCA llegaban a dibujarse.
  const [ready, setReady] = useState(false)
  // Zoom actual: alimenta el estado deshabilitado de los botones + / −, para que
  // se vea que el mapa llegó al tope en vez de dejar de responder sin más.
  const [zoom, setZoom] = useState(18)
  // Nº de parcelas dibujadas: el botón "Parcelas" lo muestra, y sirve para
  // distinguir "no hay catastro aquí" de "todavía no cargó".
  const [parcelCount, setParcelCount] = useState<number | null>(null)
  // Giro del mapa en grados (horario, 0 = norte arriba).
  const [bearing, setBearing] = useState(0)
  const bearingRef = useRef(0)
  // Medidas vigentes del recuadro visible (w × h) y del cuadrado de Leaflet (s).
  const sizeRef = useRef({ w: 0, h: 0, s: 0 })
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

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
  const corredoraPinsRef = useRef(corredoraPins)
  corredoraPinsRef.current = corredoraPins

  // ── Giro ────────────────────────────────────────────────────────────────────
  // El cuadrado de Leaflet debe cubrir el recuadro visible en CUALQUIER ángulo:
  // basta con que su lado sea la diagonal del recuadro (así el círculo inscrito
  // del cuadrado ya contiene al recuadro entero). Se centra sobre él.
  const syncSize = useCallback(() => {
    const vp = viewportRef.current
    const el = containerRef.current
    if (!vp || !el) return
    const w = vp.clientWidth
    const h = vp.clientHeight
    if (!w || !h) return
    const s = Math.ceil(Math.sqrt(w * w + h * h))
    if (sizeRef.current.w === w && sizeRef.current.h === h) return
    sizeRef.current = { w, h, s }
    el.style.width = `${s}px`
    el.style.height = `${s}px`
    el.style.left = `${Math.round((w - s) / 2)}px`
    el.style.top = `${Math.round((h - s) / 2)}px`
    mapRef.current?.invalidateSize({ animate: false })
  }, [])

  const applyBearing = useCallback((deg: number) => {
    const b = normalizeBearing(deg)
    bearingRef.current = b
    const el = containerRef.current
    if (el) {
      el.style.transform = b ? `rotate(${b}deg)` : ''
      // La heredan pines y tooltips para contra-girarse y seguir legibles.
      el.style.setProperty('--map-bearing-inv', `${-b}deg`)
    }
    setBearing(b)
  }, [])

  // Encuadrar TODOS los pines (los de corredora + el real). Lo usan el efecto
  // que los dibuja y el botón "recentrar": tras explorar el mapa a mano, volver
  // a los pines obligaba si no a cerrar y reabrir la ficha.
  //
  // El padding compensa que el mapa de Leaflet (el cuadrado) es MÁS GRANDE que
  // lo que se ve: sin esto, `fitBounds` encuadraría contra el cuadrado entero y
  // los pines podrían caer en la zona recortada. Girado, el área garantizada es
  // el círculo inscrito, así que se acota por el lado menor.
  const fitPadding = useCallback((): [number, number] => {
    const { w, h, s } = sizeRef.current
    if (!s) return [40, 40]
    const visW = bearingRef.current ? Math.min(w, h) : w
    const visH = bearingRef.current ? Math.min(w, h) : h
    const cap = Math.max(0, s / 2 - 24) // fitBounds necesita área útil > 0
    return [
      Math.min(cap, Math.round((s - visW) / 2) + 40),
      Math.min(cap, Math.round((s - visH) / 2) + 40),
    ]
  }, [])

  const fitAllPins = useCallback(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return
    const pts: [number, number][] = (corredoraPinsRef.current ?? []).map((p) => [p.latitude, p.longitude])
    const rp = realPinRef.current
    if (rp) pts.push([rp.latitude, rp.longitude])
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: fitPadding(), maxZoom: 18 })
    else if (pts.length === 1) map.setView(pts[0], 18)
  }, [fitPadding])

  // Mover el pin real por clic, con freno al doble clic. Un doble clic (la forma
  // más natural de acercar) llega a Leaflet como dos 'click' + un 'dblclick':
  // sin este retardo, acercar así ARRASTRABA el pin real al punto clicado. Se
  // espera un instante y, si llega el 'dblclick', el movimiento se cancela y
  // solo queda el zoom. Lo usan tanto el clic en el mapa como el clic en parcela.
  //
  // `onlyIfExists` distingue los dos orígenes: clicar una parcela PUEDE crear el
  // pin, clicar el mapa a secas solo lo mueve si ya existe (si no, explorar el
  // mapa soltaría pines sin querer). Con `preferCanvas`, clicar una parcela
  // dispara además el click del mapa, así que las dos llegan por el mismo punto
  // y se fusionan: manda la más permisiva, o crear el pin desde una parcela
  // dejaría de funcionar al pisarla la del mapa.
  const pendingClickRef = useRef<{ timer: ReturnType<typeof setTimeout>; onlyIfExists: boolean } | null>(null)
  const requestRealPinMove = useCallback((pos: LatLng, onlyIfExists: boolean) => {
    const prev = pendingClickRef.current
    if (prev) clearTimeout(prev.timer)
    const merged = prev ? prev.onlyIfExists && onlyIfExists : onlyIfExists
    const timer = setTimeout(() => {
      pendingClickRef.current = null
      if (merged && !realPinRef.current) return
      onRealPinChangeRef.current?.(pos)
    }, 260)
    pendingClickRef.current = { timer, onlyIfExists: merged }
  }, [])
  const cancelPendingPinMove = useCallback(() => {
    if (pendingClickRef.current) { clearTimeout(pendingClickRef.current.timer); pendingClickRef.current = null }
  }, [])

  // `L.Draggable` mueve el elemento por el desplazamiento del puntero EN
  // PANTALLA, pero el elemento vive dentro del contenedor girado: sin corregir,
  // arrastrar el mapa (o el pin real) se iba en diagonal. Se parchea la
  // instancia —no el prototipo, que es compartido con los demás mapas— para
  // girar el delta al espacio del mapa antes de delegar en el original.
  const patchDraggable = useCallback((draggable: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = draggable as any
    if (!d || d.__rotationPatched) return
    d.__rotationPatched = true
    const original = Object.getPrototypeOf(d)._onMove
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d._onMove = function (this: any, e: any) {
      // El contenedor girado engaña a `DomUtil.getScale` (su caja envolvente
      // crece con el giro) y Leaflet dividiría el delta por esa escala falsa.
      this._parentScale = { x: 1, y: 1 }
      const b = bearingRef.current
      if (!b || !this._startPoint) return original.call(this, e)
      const touch = e.touches && e.touches.length === 1 ? e.touches[0] : null
      if (e.touches && e.touches.length > 1) return original.call(this, e)
      const src = touch ?? e
      const rad = (-b * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const dx = src.clientX - this._startPoint.x
      const dy = src.clientY - this._startPoint.y
      const clientX = this._startPoint.x + dx * cos - dy * sin
      const clientY = this._startPoint.y + dx * sin + dy * cos
      // Proxy en vez de copia: `_onMove` guarda el evento y llama a
      // preventDefault() sobre él, así que tiene que seguir siendo el real.
      const proxy = new Proxy(e, {
        get(target, prop) {
          if (prop === 'clientX') return clientX
          if (prop === 'clientY') return clientY
          if (prop === 'touches') return touch ? [{ clientX, clientY }] : target.touches
          const value = Reflect.get(target, prop)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      return original.call(this, proxy)
    }
  }, [])

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
      if (!data.success || !data.features?.length) { setParcelCount(0); return }
      if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
      setParcelCount(data.features.length)
      const layer = L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
        style: PARCEL_STYLE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEachFeature(feature: any, flayer: any) {
          if (feature.properties?.rol) {
            flayer.bindTooltip(upright(`Rol ${escapeHtml(String(feature.properties.rol))}`), { sticky: true, direction: 'top' })
          }
          flayer.on('mouseover', () => flayer.setStyle({ ...PARCEL_STYLE, weight: 2, fillOpacity: 0.15 }))
          flayer.on('mouseout', () => flayer.setStyle(PARCEL_STYLE))
          // Clic en una parcela = "el inmueble real es este": pone/mueve el pin
          // real ahí (el padre resuelve el rol desde esa posición).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          flayer.on('click', (e: any) => {
            requestRealPinMove({ latitude: e.latlng.lat, longitude: e.latlng.lng }, false)
          })
          // Doble clic sobre la parcela = acercar, no mover el pin.
          flayer.on('dblclick', cancelPendingPinMove)
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

    // El cuadrado tiene que estar dimensionado ANTES de crear el mapa: Leaflet
    // lee el tamaño del contenedor al inicializarse.
    syncSize()

    import('leaflet').then((L) => {
      if (!containerRef.current) return
      LRef.current = L

      const map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom: 18,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        zoomControl: false,   // los + / − los dibuja React abajo, junto a "agrandar"
        attributionControl: false,
        // La rueda la maneja el listener de abajo: dentro de la ficha (que
        // scrollea) el zoom por rueda a secas se comía el scroll de la página.
        scrollWheelZoom: false,
        zoomSnap: 0.5,        // pasos más finos: el salto entero se pasaba de largo
        preferCanvas: true,
      })

      // Traducción puntero → mapa deshaciendo el giro CSS del contenedor. De
      // aquí cuelga TODO lo que reacciona al ratón (clic, dblclick, hit-test de
      // las parcelas en canvas, zoom con rueda), así que con esto solo el mapa
      // ya responde bien girado. Con bearing 0 equivale al cálculo original.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.mouseEventToContainerPoint = (e: any) => {
        const el = containerRef.current
        if (!el) return new L.Point(0, 0)
        const rect = el.getBoundingClientRect()
        // El giro es alrededor del centro, así que el centro de la caja
        // envolvente sigue siendo el centro del contenedor.
        const dx = e.clientX - (rect.left + rect.width / 2)
        const dy = e.clientY - (rect.top + rect.height / 2)
        const rad = (-bearingRef.current * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        return new L.Point(
          dx * cos - dy * sin + el.offsetWidth / 2,
          dx * sin + dy * cos + el.offsetHeight / 2,
        )
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      patchDraggable((map as any).dragging?._draggable)

      // Satélite híbrido de Google (imagen + calles), sin API key — mismo patrón
      // que StreetViewMap/catastro. Google solo sirve mt0-mt3.
      L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        attribution: '',
        maxZoom: 21,
        maxNativeZoom: 20,
      }).addTo(map)
      // Clic en el mapa (fuera de una parcela): mueve el pin real SI ya existe.
      // La creación se hace con el botón "Agregar pin" o clicando una parcela —
      // así un clic al explorar no suelta un pin sin querer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on('click', (e: any) => {
        requestRealPinMove({ latitude: e.latlng.lat, longitude: e.latlng.lng }, true)
      })
      map.on('dblclick', cancelPendingPinMove)

      // Recargar predios al mover/hacer zoom (solo con showParcels y zoom alto).
      map.on('moveend zoomend', () => {
        if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
        loadParcels()
      })
      map.on('zoomend', () => setZoom(map.getZoom()))

      // ── Zoom con la rueda / trackpad ──────────────────────────────────────
      // `scrollWheelZoom` de Leaflet es todo-o-nada y la ficha es una columna
      // que scrollea: activarlo secuestraba la rueda y no se podía bajar por la
      // ficha con el cursor sobre el mapa. Así que se maneja a mano:
      //
      //   · A pantalla completa no hay nada detrás que scrollear → la rueda
      //     hace zoom directo.
      //   · En el mapa chico, la rueda a secas scrollea la ficha (como antes) y
      //     el zoom pide Ctrl/⌘. El pinch del trackpad llega justamente como
      //     wheel + ctrlKey, así que pellizcar para acercar funciona solo.
      //
      // El zoom es alrededor del cursor, no del centro: acercar sobre una
      // parcela concreta obligaba si no a reencuadrar a mano cada vez.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onWheel = (e: any) => {
        const pinch = e.ctrlKey || e.metaKey
        if (!expandedRef.current && !pinch) return   // deja pasar el scroll de la ficha
        e.preventDefault()
        // El trackpad emite muchos deltas diminutos: se acumulan y solo se
        // aplica zoom al superar el umbral, si no el mapa da saltos nerviosos.
        wheelAccRef.current += e.deltaY
        if (Math.abs(wheelAccRef.current) < 24) return
        const step = wheelAccRef.current < 0 ? 0.5 : -0.5
        wheelAccRef.current = 0
        const at = map.containerPointToLatLng(map.mouseEventToContainerPoint(e))
        map.setZoomAround(at, map.getZoom() + step)
      }
      containerRef.current.addEventListener('wheel', onWheel, { passive: false })
      wheelCleanupRef.current = () => containerRef.current?.removeEventListener('wheel', onWheel)

      mapRef.current = map
      setZoom(map.getZoom())

      // El recuadro cambia de tamaño al "agrandar" la ficha: hay que rehacer el
      // cuadrado girable y avisar a Leaflet (diferido a rAF, para que corra tras
      // el relayout) o el mapa queda cortado.
      const ro = new ResizeObserver(() => requestAnimationFrame(syncSize))
      if (viewportRef.current) {
        ro.observe(viewportRef.current)
        resizeObserverRef.current = ro
      }

      loadParcels()
      setReady(true)
    })

    return () => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      wheelCleanupRef.current?.()
      wheelCleanupRef.current = null
      cancelPendingPinMove()
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
      setParcelCount(null)
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
        html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.55);color:#fff;font:700 12px/22px system-ui,-apple-system,sans-serif;text-align:center;${UPRIGHT}">${i + 1}</div>`,
      })
      const m = L.marker([p.latitude, p.longitude], { icon, zIndexOffset: 400 })
      m.bindTooltip(upright(`${i + 1} · ${escapeHtml(p.label)}`), { direction: 'top', offset: [0, -14] })
      group.addLayer(m)
    })
    group.addTo(map)
    corredoraLayerRef.current = group

    // Con varias corredoras los pines pueden caer fuera del encuadre inicial
    // (zoom 18 sobre el pin principal) y parecía que "no había pines". Encuadrar
    // todos garantiza que se vean; maxZoom evita acercarse de más si están juntos.
    if (corredoraPins.length > 1) fitAllPins()
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
      html: `<div style="display:flex;flex-direction:column;align-items:center;cursor:grab;${UPRIGHT}">
        <div style="width:28px;height:28px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.55)"></div>
        <div style="margin-top:3px;padding:1px 6px;border-radius:6px;background:#22c55e;border:1px solid rgba(255,255,255,.85);color:#052e16;font:700 9px/1.5 system-ui,-apple-system,sans-serif;letter-spacing:.05em;white-space:nowrap">REAL</div>
      </div>`,
    })
    const marker = L.marker([realPin.latitude, realPin.longitude], { icon, draggable: true, zIndexOffset: 1000 }).addTo(map)
    marker.bindTooltip(upright('Pin real · arrástralo para corregir'), { direction: 'top', offset: [0, -18] })
    marker.on('dragend', () => {
      const pos = marker.getLatLng()
      onRealPinChangeRef.current?.({ latitude: pos.lat, longitude: pos.lng })
    })
    // Su arrastre también trabaja en pantalla: hay que girarle el delta.
    patchDraggable(marker.dragging?._draggable)
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

  // Al pasar a pantalla completa el recuadro cambia de tamaño: el
  // ResizeObserver ya rehace el cuadrado, pero Leaflet también necesita
  // recalcular los límites de arrastre, o al agrandar el mapa quedaba "trabado"
  // dentro del encuadre chico.
  useEffect(() => {
    if (!mapRef.current) return
    const id = requestAnimationFrame(() => {
      syncSize()
      mapRef.current?.invalidateSize({ animate: false })
    })
    return () => cancelAnimationFrame(id)
  }, [expanded, ready, syncSize])

  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, map.getZoom() + delta)))
  }, [])

  // Controles en UN solo stack arriba a la derecha. Antes el botón de agrandar
  // era un <button> del padre puesto encima del control de zoom de Leaflet, así
  // que TAPABA el "+": solo se podía alejar, nunca acercar — y a pantalla
  // completa pasaba igual. Al dibujarlos juntos aquí no se pueden solapar.
  const btn = 'w-8 h-8 flex items-center justify-center text-white transition-colors hover:bg-white/15 disabled:opacity-35 disabled:hover:bg-transparent'

  return (
    <>
      {/* Recuadro visible: recorta el cuadrado girado, que sobresale por los lados. */}
      <div ref={viewportRef} className="absolute inset-0 overflow-hidden">
        <div ref={containerRef} className="absolute" style={{ transformOrigin: '50% 50%' }} />
      </div>

      {/* "Parcelas" vive DENTRO del mapa: es un control del mapa, no de la ficha
          — arriba, en la cabecera de Ubicación, quedaba lejos de lo que enciende
          y desaparecía al agrandar el mapa a pantalla completa. */}
      {onToggleParcels && (
        <div className="absolute top-2 left-2 z-[900] flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={onToggleParcels}
            title="Mostrar las parcelas del catastro SII sobre el satélite (como en /chile/catastro)"
            className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1.5 rounded-lg backdrop-blur-sm border shadow-lg transition-colors ${
              showParcels
                ? 'bg-amber-500/85 border-amber-300/40 text-slate-950 hover:bg-amber-400'
                : 'bg-black/65 border-white/15 text-white/80 hover:bg-black/80'
            }`}
          >
            <Layers size={12} /> Parcelas {showParcels ? 'ON' : 'OFF'}
            {showParcels && parcelCount != null && zoom >= MIN_ZOOM_PARCELS && (
              <span className="opacity-70">· {parcelCount}</span>
            )}
          </button>
          {/* Sin este aviso, encender "Parcelas" lejos no hacía nada visible. */}
          {showParcels && zoom < MIN_ZOOM_PARCELS && (
            <span className="px-2 py-1 rounded-md bg-black/65 backdrop-blur-sm border border-white/15 text-[10px] text-white/75">
              Acerca el mapa para ver las parcelas
            </span>
          )}
        </div>
      )}

      <div className="absolute top-2 right-2 z-[900] flex flex-col rounded-lg overflow-hidden bg-black/65 backdrop-blur-sm border border-white/15 divide-y divide-white/15 shadow-lg">
        {onToggleExpand && (
          <button type="button" onClick={onToggleExpand} className={btn}
            title={expanded ? 'Achicar mapa' : 'Agrandar mapa'}
            aria-label={expanded ? 'Achicar mapa' : 'Agrandar mapa'}>
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        )}
        <button type="button" onClick={() => zoomBy(1)} disabled={zoom >= MAX_ZOOM} className={btn}
          title="Acercar" aria-label="Acercar"><Plus size={16} /></button>
        <button type="button" onClick={() => zoomBy(-1)} disabled={zoom <= MIN_ZOOM} className={btn}
          title="Alejar" aria-label="Alejar"><Minus size={16} /></button>
        <button type="button" onClick={fitAllPins} className={btn}
          title="Centrar en los pines" aria-label="Centrar en los pines"><Crosshair size={15} /></button>
      </div>

      <CompassDial bearing={bearing} onBearing={applyBearing} />

      {/* Sin este aviso, la rueda sobre el mapa chico "no hacía nada": es a
          propósito, para poder seguir bajando por la ficha con el cursor encima. */}
      {!expanded && (
        <div className="absolute bottom-2 left-2 z-[900] px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-[10px] text-white/75 pointer-events-none">
          Ctrl/⌘ + rueda para hacer zoom
        </div>
      )}
    </>
  )
}
