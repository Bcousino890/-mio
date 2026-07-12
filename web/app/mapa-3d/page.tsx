'use client'

import { useState, useCallback } from 'react'
import { APIProvider, Map, MapControl, ControlPosition, useMap } from '@vis.gl/react-google-maps'
import { Search } from 'lucide-react'

const DEFAULT_CENTER = { lat: 40.4168, lng: -3.7038 } // Madrid
const DEFAULT_ZOOM = 19

function AddressSearch() {
  const map = useMap()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)

  const search = useCallback(async () => {
    if (!map || !query.trim()) return
    setLoading(true)
    try {
      const geocoder = new google.maps.Geocoder()
      const { results } = await geocoder.geocode({ address: query })
      const loc = results[0]?.geometry?.location
      if (loc) {
        map.setCenter(loc)
        map.setZoom(20)
      }
    } finally {
      setLoading(false)
    }
  }, [map, query])

  return (
    <div className="flex items-center gap-1.5 bg-white/95 backdrop-blur border border-black/10 rounded-lg shadow-md px-2 py-1.5 m-2">
      <Search size={15} className="text-slate-500 shrink-0" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && search()}
        placeholder="Buscar dirección…"
        className="text-sm text-slate-800 outline-none bg-transparent w-56"
      />
      <button onClick={search} disabled={loading} className="text-xs font-medium text-blue-600 disabled:opacity-40 px-1">
        {loading ? '…' : 'Ir'}
      </button>
    </div>
  )
}

export default function Mapa3DPage() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-slate-100 mb-2">Mapa 3D</h1>
          <p className="text-sm text-slate-400">
            Falta configurar <code className="text-slate-300">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> en
            las variables de entorno.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--c-border-card)' }}>
        <h1 className="text-lg font-semibold text-slate-100">Mapa 3D</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Satélite (fotos reales) · usa Street View para orientarte a nivel de calle
        </p>
      </div>

      <div className="flex-1 relative">
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={DEFAULT_CENTER}
            defaultZoom={DEFAULT_ZOOM}
            mapTypeId="satellite"
            mapTypeControl
            fullscreenControl
            streetViewControl
            zoomControl
            gestureHandling="greedy"
            className="w-full h-full"
          >
            <MapControl position={ControlPosition.TOP_LEFT}>
              <AddressSearch />
            </MapControl>
          </Map>
        </APIProvider>
      </div>
    </div>
  )
}
