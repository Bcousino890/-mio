import { useEffect, useState } from 'react'

export interface SiiRolePoint {
  rol: string | null
  lat: number
  lng: number
  direccion: string | null
  avaluo_fiscal_total: number | null
  codigo_destino_principal: string | null
  superficie_terreno_m2: number | null
}

export function useSiiRolePins(siiComunaCode: string | null) {
  const [rolePoints, setRolePoints] = useState<SiiRolePoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!siiComunaCode) {
      setRolePoints([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/chile/sii-roles-geojson?sii_comuna_code=${siiComunaCode}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
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
        } else {
          setError(data.error || 'Failed to load sii role pins')
          setRolePoints([])
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setRolePoints([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [siiComunaCode])

  return { rolePoints, loading, error }
}
