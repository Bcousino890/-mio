'use client'

import React from 'react'
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
  return Math.round(n).toLocaleString('es-CL')
}

// ─── página ───────────────────────────────────────────────────────────────────

export default function StreetPage() {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<SiiResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<SiiResult | null>(null)
  const [mapCenter, setMapCenter] = useState<[number, number]>([-33.8688, -51.2093])
  const [mapZoom, setMapZoom] = useState(13)
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [pinGeojson, setPinGeojson] = useState<any>(null)
  const [geocoding, setGeocoding] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleSearch = useCallback(async () => {
    if (!search.trim()) return
    setLoading(true)
    setResults([])
    setSelected(null)

    try {
      const res = await fetch(`/api/chile/sii-roles-list?search=${encodeURIComponent(search)}`)
      const data = await res.json()
      setResults(data.roles || [])
    } catch (err) {
      console.error('Error searching:', err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [search])

  const handleSelectResult = useCallback(async (result: SiiResult) => {
    setSelected(result)
    setMapCenter([result.lat ?? -33.8688, result.lng ?? -51.2093])
    setMapZoom(18)
    setPinGeojson(null)

    if (result.lat && result.lng) {
      setPinCoords({ lat: result.lat, lng: result.lng })
      setGeocoding(false)
    } else {
      setPinCoords(null)
      setGeocoding(true)

      try {
        const res = await fetch(`/api/chile/cadastre-geojson?rol=${encodeURIComponent(result.rol)}`)
        const geojson = await res.json()
        if (geojson?.features?.length > 0) {
          const feature = geojson.features[0]
          const coords = feature.geometry?.coordinates
          if (coords) {
            const lon = coords[0]
            const lat = coords[1]
            setPinCoords({ lat, lng: lon })
            setMapCenter([lat, lon])
            setPinGeojson(geojson)
          }
        }
      } catch (err) {
        console.error('Error fetching geojson:', err)
      } finally {
        setGeocoding(false)
      }
    }
  }, [])

  return (
    <div className="flex h-screen bg-slate-950">
      {/* ── panel lateral ─────────────────────────────────────────────────────────── */}
      <div className="w-96 flex flex-col border-r border-slate-800 bg-slate-900">
        {/* búsqueda */}
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <Link href="/chile" className="text-slate-400 hover:text-slate-200 transition-colors">
              <ArrowLeft size={16} />
            </Link>
            <h1 className="text-sm font-semibold text-slate-200">Street View Catastral</h1>
            <div className="w-4" />
          </div>

          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 focus-within:bg-slate-700 transition-colors">
              <Search size={14} className="text-slate-500" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Buscar por rol, dirección, etc."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 bg-transparent outline-none text-slate-200 text-sm placeholder:text-slate-600"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch('')
                    setResults([])
                    setSelected(null)
                    searchInputRef.current?.focus()
                  }}
                  className="text-slate-500 hover:text-slate-300"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={!search.trim() || loading}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            </button>
          </div>
        </div>

        {/* resultado seleccionado */}
        {selected && (
          <div className="p-4 border-b border-slate-800 bg-slate-800/50">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Seleccionado</p>
              <div className="space-y-1">
                <p className="font-semibold text-slate-200 text-sm">{selected.rol}</p>
                {selected.direccion && <p className="text-xs text-slate-400">{selected.direccion}</p>}
                <p className="text-xs text-slate-500">{selected.comuna_nombre}</p>
              </div>
              {selected.codigo_destino_principal && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700">
                  {DESTINO_ICON[selected.codigo_destino_principal]}
                  <span className="text-xs text-slate-400">
                    {DESTINO[selected.codigo_destino_principal] || 'Otro'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* listado de resultados */}
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 && search && !loading && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Sin resultados</p>
          )}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-slate-600" />
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-1 p-2">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleSelectResult(r)}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                    selected?.id === r.id
                      ? 'bg-blue-600/30 border border-blue-500 text-slate-200'
                      : 'bg-slate-800/50 hover:bg-slate-700 text-slate-300'
                  }`}
                >
                  <p className="font-semibold truncate">{r.rol}</p>
                  {r.direccion && <p className="text-slate-400 truncate">{r.direccion}</p>}
                  <p className="text-slate-500 text-[10px]">{r.comuna_nombre}</p>
                  {r.avaluo_fiscal_total && (
                    <p className="text-[10px] text-emerald-500 mt-0.5">
                      {formatCLP(r.avaluo_fiscal_total)}
                      {r.superficie_terreno_m2 && ` · ${formatNum(r.superficie_terreno_m2)} m²`}
                    </p>
                  )}
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
