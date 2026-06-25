import { useEffect, useState, useCallback, useRef } from 'react'

export interface SiiRolePoint {
  rol: string | null
  lat: number
  lng: number
  direccion: string | null
  avaluo_fiscal_total: number | null
  codigo_destino_principal: string | null
  superficie_terreno_m2: number | null
}

export interface MapBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export function useSiiRolePins(siiComunaCode: string | null, bounds?: MapBounds | null) {
  const [rolePoints, setRolePoints] = useState<SiiRolePoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchRoles = useCallback(() => {
    if (!siiComunaCode) {
      setRolePoints([])
      return
    }

    // Cancel previous request
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ sii_comuna_code: siiComunaCode })
    if (bounds) {
      params.set('min_lat', String(bounds.minLat))
      params.set('max_lat', String(bounds.maxLat))
      params.set('min_lng', String(bounds.minLng))
      params.set('max_lng', String(bounds.maxLng))
    }

    fetch(`/api/chile/sii-roles-geojson?${params}`, { signal: abortRef.current.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.features) {
          const transformed: SiiRolePoint[] = data.features.map((feature: any) => ({
            rol: feature.properties?.rol ?? null,
            lat: feature.geometry.coordinates[1],
            lng: feature.geometry.coordinates[0],
            direccion: feature.properties?.direccion ?? null,
            avaluo_fiscal_total: feature.properties?.avaluo_fiscal_total ?? null,
            codigo_destino_principal: feature.properties?.codigo_destino_principal ?? null,
            superficie_terreno_m2: feature.properties?.superficie_terreno_m2 ?? null,
          }))
          setRolePoints(transformed)
          setTruncated(!!data.truncated)
        } else {
          setError(data.error || 'Failed to load sii role pins')
          setRolePoints([])
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setRolePoints([])
      })
      .finally(() => {
        setLoading(false)
      })
  }, [siiComunaCode, bounds?.minLat, bounds?.maxLat, bounds?.minLng, bounds?.maxLng])

  useEffect(() => {
    fetchRoles()
    return () => { abortRef.current?.abort() }
  }, [fetchRoles])

  return { rolePoints, loading, error, truncated, refetch: fetchRoles }
}
