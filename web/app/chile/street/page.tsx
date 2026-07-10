'use client'

import React from 'react'
import { useState, useCallback, useRef, useEffect } from 'react'
import nextDynamic from 'next/dynamic'
import Link from 'next/link'
import {
  Search, X, ChevronLeft, Loader2, MapPin, Home, Building2,
  Landmark, AlertCircle, ArrowLeft, ExternalLink, PanelLeftClose, PanelLeftOpen,
  Globe,
} from 'lucide-react'
import { googleEarthUrl } from '@/lib/map-links'

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
  source?: 'oficial' | 'mapasui_scrape'
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const DESTINO: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  A: 'Agrícola', B: 'Agroindustrial', D: 'Deporte/Recreación',
  E: 'Educación', F: 'Forestal', G: 'Hotel/Motel', L: 'Bodega',
  M: 'Minería', P: 'Administración Pública', Q: 'Culto',
  S: 'Salud', T: 'Transporte', V: 'Otros', W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

const DESTINO_ICON: Record<string, React.JSX.Element> = {
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
  const [panelOpen, setPanelOpen] = useState(true)
  const [mapZoomLevel, setMapZoomLevel] = useState(12)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setSearchError(null); return }
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch(`/api/chile/sii-search?q=${encodeURIComponent(q)}&limit=50`)
      const data = await res.json()
      if (data.success) {
        const sorted = (data.results || []).sort((a: SiiResult, b: SiiResult) => {
          if (a.direccion && !b.direccion) return -1
          if (!a.direccion && b.direccion) return 1
          return 0
        })
        setResults(sorted)
      } else {
        setSearchError(data.error ?? 'No se encontraron resultados')
      }
    } catch {
      setSearchError('Error al conectar — intenta nuevamente')
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(query), 280)
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
      <div
        className={`${panelOpen ? 'w-[380px]' : 'w-0'} flex-shrink-0 flex flex-col border-r border-[var(--c-border-card)] bg-[var(--c-bg)] z-10 overflow-hidden transition-[width] duration-200`}
      >

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

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Dir./rol: 'Av. Apoquindo 3600' o '795-198'"
              className="w-full pl-8 pr-8 py-2.5 text-xs rounded-lg bg-[var(--c-hover)] border border-[var(--c-border)] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30 transition-all"
              autoFocus
              spellCheck="false"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); clearSelection() }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                title="Limpiar búsqueda"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {searching && (
            <div className="flex items-center gap-2 mt-2.5 text-[11px] text-blue-400">
              <Loader2 size={12} className="animate-spin" />
              <span>Buscando predios…</span>
            </div>
          )}
          {searchError && (
            <div className="flex items-start gap-2 mt-2.5 text-[11px] text-amber-500">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{searchError}</span>
            </div>
          )}
          {query.length > 0 && query.length < 2 && !searching && (
            <div className="mt-2.5 text-[11px] text-slate-600">
              Escribe al menos 2 caracteres para buscar
            </div>
          )}
        </div>

        {/* ── ficha del predio seleccionado ────────────────────────────── */}
        {selected ? (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 border-b border-[var(--c-border-card)] flex items-center justify-between bg-[var(--c-hover)]/30">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Predio Seleccionado</span>
              <button
                onClick={clearSelection}
                className="text-slate-500 hover:text-slate-300 transition-colors p-1 hover:bg-[var(--c-hover)] rounded"
                title="Volver"
              >
                <ChevronLeft size={15} />
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              <div className="bg-[var(--c-hover)]/40 rounded-lg px-3 py-3 border border-[var(--c-border)]/30">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 text-blue-400 flex-shrink-0">
                    {DESTINO_ICON[selected.codigo_destino_principal ?? ''] ?? <Landmark size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-50 leading-tight break-words">
                      {selected.direccion ?? (
                        <span className="text-slate-500 italic font-normal">Sin dirección registrada</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 mt-1.5 font-medium">
                      {selected.comuna_nombre}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5 font-mono bg-black/20 px-2 py-1 rounded mt-1.5 inline-block">
                      Rol {selected.sii_comuna_code}-{selected.rol}
                    </p>
                  </div>
                </div>

                {geocoding && (
                  <div className="flex items-center gap-1.5 text-[10px] text-blue-400 mt-2.5 pt-2 border-t border-[var(--c-border)]/20">
                    <Loader2 size={10} className="animate-spin flex-shrink-0" />
                    <span>Localizando coordenadas exactas…</span>
                  </div>
                )}
                {pinGeojson && (
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 mt-2.5 pt-2 border-t border-[var(--c-border)]/20">
                    <MapPin size={10} className="flex-shrink-0" />
                    <span>Polígono catastral exacto disponible</span>
                  </div>
                )}
                {!geocoding && !pinCoords && !selected.lat && (
                  <div className="flex items-start gap-1.5 text-[10px] text-amber-500 mt-2.5 pt-2 border-t border-[var(--c-border)]/20">
                    <AlertCircle size={10} className="flex-shrink-0 mt-0.5" />
                    <span>Mostrando centro de {selected.comuna_nombre} — coordenadas exactas pendientes</span>
                  </div>
                )}
              </div>

              {selected.codigo_destino_principal && (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2.5 flex items-center gap-2">
                  <span className="text-blue-400">
                    {DESTINO_ICON[selected.codigo_destino_principal] ?? <Landmark size={14} />}
                  </span>
                  <div className="flex-1">
                    <p className="text-[9px] text-blue-400 font-semibold uppercase tracking-wide">Uso del Suelo</p>
                    <p className="text-xs font-semibold text-slate-100 mt-0.5">
                      {DESTINO[selected.codigo_destino_principal] ?? selected.codigo_destino_principal}
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {(selected.avaluo_fiscal_total || selected.superficie_terreno_m2 || selected.avaluo_exento) && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
                    <p className="text-[9px] text-emerald-400 font-semibold uppercase tracking-wide mb-1.5">Valuación</p>
                    <div className="space-y-1">
                      {selected.avaluo_fiscal_total != null && (
                        <div className="flex items-baseline justify-between">
                          <span className="text-[10px] text-slate-400">Avalúo fiscal:</span>
                          <span className="text-xs font-semibold text-emerald-300">{formatCLP(selected.avaluo_fiscal_total)}</span>
                        </div>
                      )}
                      {selected.avaluo_exento != null && selected.avaluo_exento > 0 && (
                        <div className="flex items-baseline justify-between">
                          <span className="text-[10px] text-slate-400">Avalúo exento:</span>
                          <span className="text-xs font-semibold text-amber-300">{formatCLP(selected.avaluo_exento)}</span>
                        </div>
                      )}
                      {selected.superficie_terreno_m2 != null && (
                        <div className="flex items-baseline justify-between">
                          <span className="text-[10px] text-slate-400">Superficie:</span>
                          <span className="text-xs font-semibold text-slate-200">{formatNum(selected.superficie_terreno_m2)} m²</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {selected.contribucion_semestral != null && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                    <p className="text-[9px] text-amber-400 font-semibold uppercase tracking-wide mb-1.5">Contribución Predial</p>
                    <p className="text-sm font-bold text-amber-200">{formatCLP(selected.contribucion_semestral)}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Semestral</p>
                  </div>
                )}
              </div>

              <a
                href={`https://zeus.sii.cl/cvc_cgi/staj/PJBD2400`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-[11px] font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-lg px-3 py-2.5 transition-all hover:shadow-lg"
              >
                <ExternalLink size={13} />
                Ver detalles en SII
              </a>

              {(pinCoords || (selected.lat != null && selected.lng != null)) && (
                <a
                  href={googleEarthUrl(pinCoords?.lat ?? selected.lat!, pinCoords?.lng ?? selected.lng!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 rounded-lg px-3 py-2.5 transition-all"
                >
                  <Globe size={13} />
                  Ver en Google Earth
                </a>
              )}
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
                className="w-full text-left px-4 py-2.5 border-b border-[var(--c-border)]/40 hover:bg-[var(--c-hover)]/60 transition-colors group"
              >
                <div className="flex items-start gap-2.5">
                  <div className="flex-shrink-0 mt-0.5">
                    {DESTINO_ICON[r.codigo_destino_principal ?? ''] ? (
                      <span className="text-blue-400 group-hover:text-blue-300 transition-colors">
                        {DESTINO_ICON[r.codigo_destino_principal ?? '']}
                      </span>
                    ) : (
                      <MapPin size={12} className="text-blue-400 group-hover:text-blue-300 transition-colors" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 justify-between">
                      <p className="text-xs font-semibold text-slate-100 truncate">
                        {r.direccion ? (
                          r.direccion.length > 35 ? r.direccion.slice(0, 35) + '…' : r.direccion
                        ) : (
                          <span className="text-slate-500 italic">Sin dirección</span>
                        )}
                      </p>
                      <span className="text-[9px] text-slate-500 whitespace-nowrap flex-shrink-0 font-mono">
                        {r.sii_comuna_code}-{r.rol}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {r.comuna_nombre}
                      {r.source === 'mapasui_scrape' && (
                        <span className="ml-1.5 px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[9px] align-middle" title="Dato obtenido por scraping de mapasui, no del archivo oficial descargado — verificar antes de usar comercialmente">
                          no oficial
                        </span>
                      )}
                      {r.codigo_destino_principal && (
                        <> · {DESTINO[r.codigo_destino_principal] ?? r.codigo_destino_principal}</>
                      )}
                    </p>
                    {(r.avaluo_fiscal_total || r.superficie_terreno_m2) && (
                      <p className="text-[10px] text-emerald-500/80 mt-1">
                        {r.avaluo_fiscal_total && formatCLP(r.avaluo_fiscal_total)}
                        {r.superficie_terreno_m2 && (
                          <> · {formatNum(r.superficie_terreno_m2)} m²</>
                        )}
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
        {/* toggle panel */}
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="absolute top-4 left-4 z-[1000] bg-black/60 backdrop-blur border border-white/10 text-white/80 hover:text-white hover:bg-black/80 rounded-lg p-2 transition-colors shadow-lg"
          title={panelOpen ? 'Ocultar panel' : 'Mostrar panel'}
        >
          {panelOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
        <StreetViewMap
          center={mapCenter}
          zoom={mapZoom}
          comunaCode={selected?.sii_comuna_code ?? null}
          onZoomChange={setMapZoomLevel}
          onParcelClick={async ({ rol, sii_comuna_code }) => {
            try {
              const res = await fetch(`/api/chile/sii-search?q=${encodeURIComponent(rol)}&comuna=${sii_comuna_code}&limit=1`)
              const data = await res.json()
              if (data.success && data.results?.[0]) selectResult(data.results[0])
            } catch { /* ignore */ }
          }}
          pin={pinCoords ? {
            lat: pinCoords.lat,
            lng: pinCoords.lng,
            label: selected?.direccion ?? selected?.rol ?? undefined,
            geojson: pinGeojson,
          } : null}
        />

        {mapZoomLevel < 15 && !selected && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[1000] bg-gradient-to-r from-blue-600 to-blue-500 backdrop-blur border border-blue-400/40 text-white text-[11px] font-semibold px-4 py-2 rounded-full flex items-center gap-2 shadow-lg pointer-events-none animate-pulse">
            <MapPin size={12} />
            Acerca el mapa para ver los predios (zoom {mapZoomLevel})
          </div>
        )}

        {!pinCoords && selected && !geocoding && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] bg-gradient-to-r from-amber-600 to-amber-500 backdrop-blur border border-amber-400/40 text-white text-[11px] font-semibold px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
            <AlertCircle size={12} />
            Mostrando centro de {selected.comuna_nombre} — coordenadas exactas pendientes
          </div>
        )}

        <div className="absolute bottom-6 right-4 z-[1000] text-[10px] text-white/60 bg-black/40 backdrop-blur px-2.5 py-1.5 rounded-lg border border-white/10">
          Datos: SII catastral.cl · Mapa: Google
        </div>
      </div>
    </div>
  )
}
