'use client'

import { useState, useCallback, useRef } from 'react'
import {
  APIProvider,
  Map,
  Map3D,
  MapMode,
  type Map3DRef,
  MapControl,
  ControlPosition,
  useMap,
} from '@vis.gl/react-google-maps'
import { Search, RotateCcw, RotateCw, ChevronUp, ChevronDown } from 'lucide-react'

const DEFAULT_CENTER = { lat: 40.4168, lng: -3.7038 } // Madrid
const DEFAULT_3D = { lat: 40.4168, lng: -3.7038, altitude: 0 }

type ViewMode = 'mapa' | 'satelite' | '3d'

function AddressSearch({ onResult }: { onResult: (loc: google.maps.LatLng) => void }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)

  const search = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const geocoder = new google.maps.Geocoder()
      const { results } = await geocoder.geocode({ address: query })
      const loc = results[0]?.geometry?.location
      if (loc) onResult(loc)
    } finally {
      setLoading(false)
    }
  }, [query, onResult])

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

function AddressSearch2D() {
  const map = useMap()
  return (
    <AddressSearch
      onResult={(loc) => {
        map?.setCenter(loc)
        map?.setZoom(20)
      }}
    />
  )
}

function AddressSearch3D({ mapRef }: { mapRef: React.RefObject<Map3DRef | null> }) {
  return (
    <AddressSearch
      onResult={(loc) => {
        mapRef.current?.flyCameraTo({
          endCamera: { center: { lat: loc.lat(), lng: loc.lng(), altitude: 80 }, tilt: 60, range: 300, heading: 0 },
          durationMillis: 1200,
        })
      }}
    />
  )
}

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const opt = (v: ViewMode, label: string) => (
    <button
      onClick={() => onChange(v)}
      className={`px-3 py-2 text-sm font-medium ${mode === v ? 'bg-slate-900 text-white' : 'text-slate-700'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex bg-white/95 backdrop-blur border border-black/10 rounded-lg shadow-md overflow-hidden m-2 w-fit">
      {opt('mapa', 'Mapa')}
      {opt('satelite', 'Satélite')}
      {opt('3d', 'Satélite 3D')}
    </div>
  )
}

function TiltRotateControls({ mapRef }: { mapRef: React.RefObject<Map3DRef | null> }) {
  const nudge = useCallback((deltaHeading: number, deltaTilt: number) => {
    const map3d = mapRef.current?.map3d
    if (!map3d) return
    mapRef.current?.flyCameraTo({
      endCamera: {
        center: map3d.center ?? DEFAULT_3D,
        heading: (map3d.heading ?? 0) + deltaHeading,
        tilt: Math.min(85, Math.max(0, (map3d.tilt ?? 60) + deltaTilt)),
        range: map3d.range ?? 300,
      },
      durationMillis: 300,
    })
  }, [mapRef])

  return (
    <div className="flex flex-col gap-1.5 bg-white/95 backdrop-blur border border-black/10 rounded-lg shadow-md p-1.5 m-2 w-fit">
      <div className="flex items-center gap-1">
        <button onClick={() => nudge(-30, 0)} title="Rotar izquierda" className="p-1.5 hover:bg-slate-100 rounded">
          <RotateCcw size={16} className="text-slate-700" />
        </button>
        <button onClick={() => nudge(30, 0)} title="Rotar derecha" className="p-1.5 hover:bg-slate-100 rounded">
          <RotateCw size={16} className="text-slate-700" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => nudge(0, -15)} title="Inclinar menos" className="p-1.5 hover:bg-slate-100 rounded">
          <ChevronUp size={16} className="text-slate-700" />
        </button>
        <button onClick={() => nudge(0, 15)} title="Inclinar más" className="p-1.5 hover:bg-slate-100 rounded">
          <ChevronDown size={16} className="text-slate-700" />
        </button>
      </div>
    </div>
  )
}

const HINTS: Record<ViewMode, string> = {
  mapa: 'Callejero estándar',
  satelite: 'Fotos satelitales reales, vista cenital · mejor cobertura y actualización en Chile',
  '3d': 'Malla 3D fotorrealista · rota e inclina la cámara · cobertura desigual fuera de grandes ciudades',
}

export default function Mapa3DPage() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const [mode, setMode] = useState<ViewMode>('satelite')
  const map3dRef = useRef<Map3DRef>(null)

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
        <p className="text-xs text-slate-500 mt-0.5">{HINTS[mode]}</p>
      </div>

      <div className="flex-1 relative">
        <APIProvider apiKey={apiKey}>
          {mode !== '3d' ? (
            <Map
              defaultCenter={DEFAULT_CENTER}
              defaultZoom={19}
              mapTypeId={mode === 'satelite' ? 'satellite' : 'roadmap'}
              mapTypeControl={false}
              fullscreenControl
              streetViewControl
              zoomControl
              gestureHandling="greedy"
              className="w-full h-full"
            >
              <MapControl position={ControlPosition.TOP_LEFT}>
                <div className="flex flex-col">
                  <ViewToggle mode={mode} onChange={setMode} />
                  <AddressSearch2D />
                </div>
              </MapControl>
            </Map>
          ) : (
            <Map3D
              ref={map3dRef}
              mode={MapMode.HYBRID}
              defaultCenter={DEFAULT_3D}
              defaultTilt={60}
              defaultRange={400}
              defaultHeading={0}
              className="w-full h-full"
            >
              <MapControl position={ControlPosition.TOP_LEFT}>
                <div className="flex flex-col">
                  <ViewToggle mode={mode} onChange={setMode} />
                  <AddressSearch3D mapRef={map3dRef} />
                </div>
              </MapControl>
              <MapControl position={ControlPosition.BOTTOM_LEFT}>
                <TiltRotateControls mapRef={map3dRef} />
              </MapControl>
            </Map3D>
          )}
        </APIProvider>
      </div>
    </div>
  )
}
