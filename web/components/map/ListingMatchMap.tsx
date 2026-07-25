'use client'

import 'leaflet/dist/leaflet.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeClRol } from '@/lib/rol-format'

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

/** Parcela del catastro gráfico clicada en el mapa. */
export interface ParcelPick {
  rol: string
  sii_comuna_code: string | null
  comuna_name: string | null
  avaluo_fiscal_total: number | null
  superficie_terreno_m2: number | null
  /** true si el rol ya venía en la lista de candidatos scoreados. */
  is_candidate: boolean
}

interface Props {
  listingLat: number
  listingLng: number
  candidates: MatchCandidate[]
  selectedRol?: string | null
  onSelectCandidate?: (rol: string) => void
  /** Comuna SII del anuncio — acota la capa de parcelas del catastro. */
  comunaCode?: string | null
  /** Clic sobre una parcela del catastro (sea candidata o no). */
  onSelectParcel?: (parcel: ParcelPick) => void
}

// Zoom mínimo para pedir parcelas (mismo criterio que el visor de Catastro).
const MIN_ZOOM_PARCELS = 15

const CONFIRMED_COLOR = '#22d3ee' // cian — el rol fijado en la ficha

/** Colores por probabilidad, en la MISMA escala 0..1 que devuelve el matcher y
 *  que anuncia la leyenda. Antes comparaba contra 75/45 sobre un valor 0..1, así
 *  que todos los candidatos salían rojos aunque el match fuera del 99%. */
function scoreColor(score: number) {
  if (score >= 0.92) return '#10b981' // emerald — alta coincidencia
  if (score >= 0.65) return '#f59e0b' // amber — revisar
  return '#ef4444' // red — baja coincidencia
}

function fmtCLP(n: number | null | undefined) {
  if (n == null) return null
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`
  return `$${Number(n).toLocaleString('es-CL')}`
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
}

/**
 * Mapa de confirmación del match: pin azul = ubicación declarada por el
 * anuncio, pines de color = roles SII candidatos coloreados por probabilidad, y
 * — como en el visor de Catastro — los polígonos de las parcelas del catastro
 * gráfico. Poder ver el predio dibujado es lo que permite decidir: la lista de
 * candidatos ordena por texto y distancia, pero el terreno se reconoce mirando
 * la forma de la parcela contra la foto satelital.
 *
 * Cualquier parcela es clicable, no solo las candidatas: cuando la
 * recomendación automática está equivocada, señalar el predio correcto en el
 * mapa es la salida (antes la ficha solo dejaba elegir entre candidatos malos).
 */
export default function ListingMatchMap({
  listingLat, listingLng, candidates, selectedRol, onSelectCandidate,
  comunaCode, onSelectParcel,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidateMarkersRef = useRef<Record<string, any>>({})
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parcelLayerRef = useRef<any>(null)
  const loadingRef = useRef(false)

  const [showParcels, setShowParcels] = useState(true)
  const [zoom, setZoom] = useState(17)
  const [parcelCount, setParcelCount] = useState<number | null>(null)

  // Refs para que loadParcels (capturado por el listener de moveend, que se
  // registra una sola vez) vea siempre los valores actuales.
  const comunaCodeRef = useRef(comunaCode)
  comunaCodeRef.current = comunaCode
  const showParcelsRef = useRef(showParcels)
  showParcelsRef.current = showParcels
  const onSelectParcelRef = useRef(onSelectParcel)
  onSelectParcelRef.current = onSelectParcel
  const onSelectCandidateRef = useRef(onSelectCandidate)
  onSelectCandidateRef.current = onSelectCandidate
  const selectedRolRef = useRef(selectedRol)
  selectedRolRef.current = selectedRol
  // Score por rol normalizado — para pintar la parcela candidata con el mismo
  // color que su pin.
  const scoreByRolRef = useRef<Record<string, number>>({})
  scoreByRolRef.current = Object.fromEntries(
    candidates.filter((c) => c.rol).map((c) => [normalizeClRol(c.rol), c.match_score]),
  )

  const styleForParcel = useCallback((rolRaw: string | null) => {
    const rol = rolRaw ? normalizeClRol(rolRaw) : null
    const sel = selectedRolRef.current ? normalizeClRol(selectedRolRef.current) : null
    if (rol && sel && rol === sel) {
      return { color: CONFIRMED_COLOR, weight: 3, fillColor: CONFIRMED_COLOR, fillOpacity: 0.35, opacity: 1 }
    }
    const score = rol != null ? scoreByRolRef.current[rol] : undefined
    if (score != null) {
      const c = scoreColor(score)
      return { color: c, weight: 2, fillColor: c, fillOpacity: 0.25, opacity: 0.95 }
    }
    // Resto del catastro: contorno tenue, suficiente para leer los límites del
    // predio sobre el satélite sin competir con los candidatos.
    return { color: '#fbbf24', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.06, opacity: 0.75 }
  }, [])

  const loadParcels = useCallback(async () => {
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L
    if (!map || !L || loadingRef.current) return
    if (!showParcelsRef.current || map.getZoom() < MIN_ZOOM_PARCELS) return

    const b = map.getBounds()
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`
    const comuna = comunaCodeRef.current
    loadingRef.current = true
    try {
      const res = await fetch(`/api/chile/parcels-bbox?bbox=${bbox}${comuna ? `&comuna=${comuna}` : ''}&enrich=1`)
      const data = await res.json()
      if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
      if (!data.success || !data.features?.length) { setParcelCount(0); return }
      setParcelCount(data.features.length)

      const layer = L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style: (feature: any) => styleForParcel(feature?.properties?.rol ?? null),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEachFeature(feature: any, flayer: any) {
          const p = feature.properties ?? {}
          const rol: string | null = p.rol ?? null
          const rolNorm = rol ? normalizeClRol(rol) : null
          const isCandidate = rolNorm != null && scoreByRolRef.current[rolNorm] != null
          const avaluo = fmtCLP(p.avaluo_fiscal_total)
          flayer.bindTooltip(
            `${escapeHtml(rol ?? '—')}${avaluo ? ` · ${avaluo}` : ''}${p.superficie_terreno_m2 ? ` · ${p.superficie_terreno_m2} m²` : ''}`,
            { sticky: true, direction: 'top' },
          )
          flayer.on('mouseover', () => flayer.setStyle({ ...styleForParcel(rol), weight: 3, fillOpacity: 0.4 }))
          flayer.on('mouseout', () => flayer.setStyle(styleForParcel(rol)))
          flayer.on('click', () => {
            if (!rol) return
            if (isCandidate) onSelectCandidateRef.current?.(rol)
            onSelectParcelRef.current?.({
              rol,
              sii_comuna_code: p.sii_comuna_code ?? null,
              comuna_name: p.comuna_name ?? null,
              avaluo_fiscal_total: p.avaluo_fiscal_total ?? null,
              superficie_terreno_m2: p.superficie_terreno_m2 ?? null,
              is_candidate: isCandidate,
            })
          })
        },
      })
      // Debajo de los marcadores (el panel de overlays de Leaflet ya lo
      // garantiza) pero por encima del tile satelital.
      layer.addTo(map)
      parcelLayerRef.current = layer
    } catch {
      /* la capa de parcelas es un apoyo: si falla, el mapa sigue usable */
    } finally {
      loadingRef.current = false
    }
  }, [styleForParcel])

  useEffect(() => {
    if (!containerRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((containerRef.current as any)._leaflet_id) return

    const geoCandidates = candidates.filter((c) => c.lat != null && c.lng != null)
    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).L = L

      const map = L.map(containerRef.current, {
        center: [listingLat, listingLng],
        zoom: 17,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
      })

      // Satélite híbrido de Google (imagen + nombres de calles), igual que el
      // visor de Catastro: los límites de parcela solo se leen sobre satélite.
      L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        attribution: '© Google',
        maxZoom: 21,
        maxNativeZoom: 20,
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
          interactive: false, // no debe robarle el clic a las parcelas
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
              <div style="font-weight:700;color:#0f172a">#${number} · Rol ${escapeHtml(c.rol)}</div>
              <div style="color:#64748b;font-size:11px;margin-top:1px">${escapeHtml(c.direccion ?? '—')}</div>
              ${c.distance_m ? `<div style="color:#64748b;font-size:11px;margin-top:2px">Distancia: ${(c.distance_m / 1000).toFixed(2)}km</div>` : ''}
              ${c.superficie_terreno_m2 ? `<div style="color:#64748b;font-size:11px">Sup. terreno: ${c.superficie_terreno_m2}m²</div>` : ''}
              ${c.superficie_construida_m2 ? `<div style="color:#64748b;font-size:11px">Sup. construida: ${c.superficie_construida_m2}m²</div>` : ''}
              <div style="margin-top:6px;font-weight:600;color:${color}">${(c.match_score * 100).toFixed(0)}% coincidencia</div>
            </div>
          `)
        marker.on('click', () => onSelectCandidateRef.current?.(c.rol))
        marker.addTo(map)
        candidateMarkersRef.current[c.rol] = marker
        bounds.extend([c.lat as number, c.lng as number])
      }

      if (geoCandidates.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 })
      }

      mapRef.current = map
      setZoom(map.getZoom())

      map.on('moveend zoomend', () => {
        const z = map.getZoom()
        setZoom(z)
        if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
        if (z >= MIN_ZOOM_PARCELS) loadParcels()
        else setParcelCount(null)
      })

      loadParcels()
    })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      parcelLayerRef.current = null
      candidateMarkersRef.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mostrar/ocultar la capa de parcelas
  useEffect(() => {
    if (!mapRef.current) return
    if (!showParcels) {
      if (parcelLayerRef.current) { parcelLayerRef.current.remove(); parcelLayerRef.current = null }
      setParcelCount(null)
      return
    }
    loadParcels()
  }, [showParcels, loadParcels])

  // Repintar la capa cuando cambia el rol elegido, sin volver a pedirla
  useEffect(() => {
    const layer = parcelLayerRef.current
    if (!layer) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layer.eachLayer((flayer: any) => {
      flayer.setStyle(styleForParcel(flayer.feature?.properties?.rol ?? null))
    })
  }, [selectedRol, candidates, styleForParcel])

  // Resalta el marcador seleccionado abriendo su popup
  useEffect(() => {
    if (!selectedRol) return
    const marker = candidateMarkersRef.current[selectedRol]
    if (marker) marker.openPopup()
  }, [selectedRol])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      <button
        type="button"
        onClick={() => setShowParcels((v) => !v)}
        title="Polígonos del catastro (predios)"
        className={`absolute top-3 left-3 z-[1000] text-[11px] font-medium px-2.5 py-1.5 rounded-lg backdrop-blur transition-colors ${
          showParcels ? 'bg-cyan-600/90 text-white hover:bg-cyan-500' : 'bg-black/60 text-white/80 hover:bg-black/80'
        }`}
      >
        Parcelas {showParcels ? 'ON' : 'OFF'}
        {showParcels && parcelCount != null && <span className="opacity-70"> · {parcelCount}</span>}
      </button>

      {showParcels && zoom < MIN_ZOOM_PARCELS && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] text-[11px] bg-black/70 text-white/90 px-2.5 py-1.5 rounded-lg backdrop-blur">
          Acerca el mapa para ver los predios del catastro
        </div>
      )}

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
        {onSelectParcel && (
          <div className="flex items-center gap-1.5 pt-1 border-t border-black/10 text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm border-2 inline-block flex-shrink-0" style={{ borderColor: CONFIRMED_COLOR }} />
            Clic en una parcela para usar su rol
          </div>
        )}
      </div>
    </div>
  )
}
