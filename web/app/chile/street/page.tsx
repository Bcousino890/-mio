'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import nextDynamic from 'next/dynamic'
import Link from 'next/link'
import {
  Search, X, ChevronLeft, Loader2, MapPin, Home, Building2,
  Landmark, AlertCircle, ArrowLeft, ExternalLink,
} from 'lucide-react'

const StreetViewMap = nextDynamic(() => import('@/components/map/StreetViewMap'), { ssr: false })

// ─── tipos ────────────────────────────────────────────────────────────────────

interface SiiResult {
  id: string
  sii_comuna_code: string
  comuna_nombre: string
  rol: string
  direccion: string | null
  avaluo_fiscal_total: number | null
  avaluo_exento: number | null
  contribucion_semestral: number | null
  superficie_terreno_m2: number | null
  codigo_destino_principal: string | null
  lat: number | null
  lng: number | null
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const DESTINO: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  A: 'Agrícola', B: 'Agroindustrial', D: 'Deporte/Recreación',
  E: 'Educación', F: 'Forestal', G: 'Hotel/Motel', L: 'Bodega',
  M: 'Minería', P: 'Administración Pública', Q: 'Culto',
  S: 'Salud', T: 'Transporte', V: 'Otros', W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

const DESTINO_ICON: Record<string, JSX.Element> = {
  H: <Home size={12} />,
  C: <Building2 size={12} />,
  O: <Building2 size={12} />,
}

function formatCLP(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function formatNum(n: number) {
  return n.toLocaleString('es-CL')
}

// Geocodifica una dirección usando Nominatim (OpenStreetMap) — sin API key.
// Rate limit: 1 req/s; dado que es interacción humana no hay problema.
async function geocode(address: string, comunaNombre: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const q = encodeURIComponent(`${address}, ${comunaNombre}, Chile`)
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=cl`, {
      headers: { 'Accept-Language': 'es', 'User-Agent': 'casafari-mio/1.0' },
    })
    const data = await res.json()
    if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch { /* si falla, usamos centro de la comuna */ }
  return null
}

// Centros aproximados de comunas populares para centrar el mapa cuando no
// hay coordenadas de la propiedad ni resultado de geocodificación.
const COMUNA_CENTERS: Record<string, { lat: number; lng: number }> = {
  'Las Condes':    { lat: -33.4100, lng: -70.5700 },
  'Vitacura':      { lat: -33.3900, lng: -70.5900 },
  'Providencia':   { lat: -33.4330, lng: -70.6100 },
  'Santiago':      { lat: -33.4569, lng: -70.6483 },
  'Ñuñoa':        { lat: -33.4540, lng: -70.5990 },
  'La Reina':      { lat: -33.4480, lng: -70.5330 },
  'Lo Barnechea':  { lat: -33.3560, lng: -70.5190 },
  'Colina':        { lat: -33.2050, lng: -70.6720 },
}

const DEFAULT_CENTER = { lat: -33.4569, lng: -70.6483 } // Santiago

// ─── componente ───────────────────────────────────────────────────────────────

export default function StreetPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SiiResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SiiResult | null>(null)
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER)
  const [mapZoom, setMapZoom] = useState(12)
  const [geocoding, setGeocoding] = useState(false)
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [pinGeojson, setPinGeojson] = useState<object | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── búsqueda con debounce ────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    if (q.length < 3) { setResults([]); setSearchError(null); return }
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch(`/api/chile/sii-search?q=${encodeURIComponent(q)}&limit=30`)
      const data = await res.json()
      if (data.success) setResults(data.results)
      else setSearchError(data.error ?? 'Error en búsqueda')
    } catch {
      setSearchError('Error de conexión')
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(query), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, runSearch])

  // ── seleccionar predio ───────────────────────────────────────────────────
  const selectResult = useCallback(async (r: SiiResult) => {
    setSelected(r)
    setPinCoords(null)
    setPinGeojson(null)

    // 1. Intentar polígono real desde cadastre_parcels_cl (GeoPackages catastral.cl)
    const polyRes = await fetch(`/api/chile/parcel-geojson?rol=${encodeURIComponent(r.rol)}&comuna=${r.sii_comuna_code}`)
    const polyData = await polyRes.json()
    if (polyData.success && polyData.parcel) {
      const { lat, lng, geojson } = polyData.parcel
      setMapCenter({ lat, lng })
      setMapZoom(19)
      setPinCoords({ lat, lng })
      setPinGeojson(geojson)
      return
    }

    // 2. Coords del propio SII (de catastral.cl con coordenadas)
    if (r.lat && r.lng) {
      setMapCenter({ lat: r.lat, lng: r.lng })
      setMapZoom(18)
      setPinCoords({ lat: r.lat, lng: r.lng })
      return
    }

    // 3. Centro de la comuna mientras geocodificamos
    const comunaCenter = COMUNA_CENTERS[r.comuna_nombre]
    if (comunaCenter) { setMapCenter(comunaCenter); setMapZoom(14) }

    // 4. Geocodificar dirección con Nominatim (fallback)
    if (r.direccion) {
      setGeocoding(true)
      const coords = await geocode(r.direccion, r.comuna_nombre)
      setGeocoding(false)
      if (coords) {
        setMapCenter(coords)
        setMapZoom(18)
        setPinCoords(coords)
      }
    }
  }, [])

  const clearSelection = useCallback(() => {
    setSelected(null)
    setPinCoords(null)
    setPinGeojson(null)
  }, [])

  return (
    <div className="flex h-screen bg-[var(--c-bg)] overflow-hidden">

      {/* ── panel izquierdo ──────────────────────────────────────────────── */}
      <div className="w-[380px] flex-shrink-0 flex flex-col border-r border-[var(--c-border-card)] bg-[var(--c-bg)] z-10">

        {/* header */}
        <div className="px-4 pt-4 pb-3 border-b border-[var(--c-border-card)]">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/chile" className="text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft size={14} />
            </Link>
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-blue-400" />
              <span className="text-sm font-semibold text-slate-200">Visor Catastral Chile</span>
            </div>
            <span className="ml-auto text-[10px] text-slate-600 bg-[var(--c-hover)] px-1.5 py-0.5 rounded">9.4M roles</span>
          </div>

          {/* buscador */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Dirección o rol (ej: 795-198)"
              className="w-full pl-8 pr-8 py-2 text-xs rounded-lg bg-[var(--c-hover)] border border-[var(--c-border)] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
              autoFocus
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); clearSelection() }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {searching && (
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
              <Loader2 size={11} className="animate-spin" />
              Buscando…
            </div>
          )}
          {searchError && (
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-red-400">
              <AlertCircle size={11} />
              {searchError}
            </div>
          )}
        </div>

        {/* ── ficha del predio seleccionado ────────────────────────────── */}
        {selected ? (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 border-b border-[var(--c-border-card)] flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Predio</span>
              <button onClick={clearSelection} className="text-slate-500 hover:text-slate-300">
                <ChevronLeft size={14} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* encabezado */}
              <div>
                <div className="flex items-start gap-2 mb-1">
                  <div className="mt-0.5 text-blue-400">
                    {DESTINO_ICON[selected.codigo_destino_principal ?? ''] ?? <Landmark size={12} />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-200 leading-tight">
                      {selected.direccion ?? 'Sin dirección'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {selected.comuna_nombre} · Rol {selected.sii_comuna_code}-{selected.rol}
                    </p>
                  </div>
                </div>

                {geocoding && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                    <Loader2 size={10} className="animate-spin" />
                    Geolocalización vía OpenStreetMap…
                  </div>
                )}
                {pinGeojson && (
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 mt-1">
                    <MapPin size={10} />
                    Polígono exacto del predio disponible
                  </div>
                )}
                {!geocoding && !pinCoords && !selected.lat && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-600 mt-1">
                    <AlertCircle size={10} />
                    Sin coordenadas — pendiente de GeoPackages catastral.cl
                  </div>
                )}
              </div>

              {/* destino */}
              {selected.codigo_destino_principal && (
                <div className="rounded-lg bg-[var(--c-hover)] px-3 py-2 flex items-center gap-2">
                  <span className="text-blue-400">
                    {DESTINO_ICON[selected.codigo_destino_principal] ?? <Landmark size={13} />}
                  </span>
                  <div>
                    <p className="text-[10px] text-slate-500">Destino</p>
                    <p className="text-xs font-medium text-slate-200">
                      {DESTINO[selected.codigo_destino_principal] ?? selected.codigo_destino_principal}
                    </p>
                  </div>
                </div>
              )}

              {/* avalúos */}
              <div className="grid grid-cols-2 gap-2">
                {selected.avaluo_fiscal_total != null && (
                  <div className="rounded-lg bg-[var(--c-hover)] px-3 py-2">
                    <p className="text-[10px] text-slate-500 mb-0.5">Avalúo fiscal</p>
                    <p className="text-xs font-semibold text-emerald-400">{formatCLP(selected.avaluo_fiscal_total)}</p>
                  </div>
                )}
                {selected.avaluo_exento != null && selected.avaluo_exento > 0 && (
                  <div className="rounded-lg bg-[var(--c-hover)] px-3 py-2">
                    <p className="text-[10px] text-slate-500 mb-0.5">Avalúo exento</p>
                    <p className="text-xs font-semibold text-amber-400">{formatCLP(selected.avaluo_exento)}</p>
                  </div>
                )}
                {selected.superficie_terreno_m2 != null && (
                  <div className="rounded-lg bg-[var(--c-hover)] px-3 py-2">
                    <p className="text-[10px] text-slate-500 mb-0.5">Superficie terreno</p>
                    <p className="text-xs font-semibold text-slate-200">{formatNum(selected.superficie_terreno_m2)} m²</p>
                  </div>
                )}
                {selected.contribucion_semestral != null && (
                  <div className="rounded-lg bg-[var(--c-hover)] px-3 py-2">
                    <p className="text-[10px] text-slate-500 mb-0.5">Contribución sem.</p>
                    <p className="text-xs font-semibold text-slate-200">{formatCLP(selected.contribucion_semestral)}</p>
                  </div>
                )}
              </div>

              {/* enlace SII */}
              <a
                href={`https://zeus.sii.cl/cvc_cgi/staj/PJBD2400`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                <ExternalLink size={11} />
                Ver en SII
              </a>
            </div>
          </div>
        ) : (

          /* ── lista de resultados ──────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto">
            {results.length === 0 && !searching && query.length >= 3 && (
              <div className="px-4 py-8 text-center text-[11px] text-slate-600">
                Sin resultados para &ldquo;{query}&rdquo;
              </div>
            )}

            {results.length === 0 && query.length < 3 && (
              <div className="px-4 py-8 text-center">
                <MapPin size={28} className="mx-auto text-slate-700 mb-3" />
                <p className="text-xs text-slate-500 mb-1">Busca cualquier predio de Chile</p>
                <p className="text-[11px] text-slate-700">Dirección: <span className="text-slate-500">Av. Apoquindo 3600</span></p>
                <p className="text-[11px] text-slate-700">Rol: <span className="text-slate-500">795-198</span></p>
                <p className="text-[11px] text-slate-700">Rol con código: <span className="text-slate-500">15108 795-198</span></p>
              </div>
            )}

            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => selectResult(r)}
                className="w-full text-left px-4 py-3 border-b border-[var(--c-border)] hover:bg-[var(--c-hover)] transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <MapPin size={12} className="mt-0.5 text-blue-400 flex-shrink-0 group-hover:text-blue-300" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">
                      {r.direccion ?? `Rol ${r.rol}`}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {r.comuna_nombre} · {r.sii_comuna_code}-{r.rol}
                      {r.codigo_destino_principal && (
                        <span className="ml-1.5 text-slate-600">
                          · {DESTINO[r.codigo_destino_principal] ?? r.codigo_destino_principal}
                        </span>
                      )}
                    </p>
                    {r.avaluo_fiscal_total && (
                      <p className="text-[10px] text-emerald-500 mt-0.5">
                        {formatCLP(r.avaluo_fiscal_total)}
                        {r.superficie_terreno_m2 && ` · ${formatNum(r.superficie_terreno_m2)} m²`}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}

            {results.length > 0 && (
              <p className="px-4 py-2 text-[10px] text-slate-700 text-center">
                {results.length} resultado{results.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── mapa ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        <StreetViewMap
          center={mapCenter}
          zoom={mapZoom}
          pin={pinCoords ? {
            lat: pinCoords.lat,
            lng: pinCoords.lng,
            label: selected?.direccion ?? selected?.rol ?? undefined,
            geojson: pinGeojson,
          } : null}
        />

        {/* badge sin datos de ubicación */}
        {!pinCoords && selected && !geocoding && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-amber-900/80 backdrop-blur border border-amber-700/50 text-amber-200 text-[11px] px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
            <AlertCircle size={11} />
            Sin coordenadas exactas — mostrando centro de {selected.comuna_nombre}
          </div>
        )}

        {/* créditos */}
        <div className="absolute bottom-6 right-4 z-[1000] text-[10px] text-white/50 bg-black/30 backdrop-blur px-2 py-1 rounded">
          Datos: SII catastral.cl S2-2025 · Mapa: Esri / OSM
        </div>
      </div>
    </div>
  )
}
