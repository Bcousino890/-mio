import { useEffect, useState } from 'react'

export interface CadastreParcel {
  id: string
  rol: string | null
  source: 'ide_chile' | 'manual' | 'estimated'
  confidence: string | null
  geojson: any
  centroid: { lat: number; lng: number }
  direccion: string | null
  avaluo_fiscal_total: number | null
  codigo_destino_principal: string | null
  superficie_terreno_m2: number | null
  comuna: string
}

export function useCadastreParcels(siiComunaCode: string | null, comunaName: string = '') {
  const [parcels, setParcels] = useState<CadastreParcel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!siiComunaCode) {
      setParcels([])
      return
    }

    setLoading(true)
    setError(null)

    fetch(`/api/chile/cadastre-geojson?sii_comuna_code=${siiComunaCode}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.features) {
          const transformed: CadastreParcel[] = data.features.map((feature: any) => ({
            id: feature.id,
            rol: feature.properties?.rol ?? null,
            source: (feature.properties?.source as 'ide_chile' | 'manual' | 'estimated') || 'estimated',
            confidence: feature.properties?.confidence ?? null,
            geojson: feature.geometry,
            centroid:
              feature.geometry?.type === 'Point'
                ? { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] }
                : feature.geometry?.coordinates?.[0]?.[0]
                  ? { lat: feature.geometry.coordinates[0][0][1], lng: feature.geometry.coordinates[0][0][0] }
                  : { lat: -33.45, lng: -70.65 },
            direccion: feature.properties?.direccion ?? null,
            avaluo_fiscal_total: feature.properties?.avaluo_fiscal_total ?? null,
            codigo_destino_principal: feature.properties?.codigo_destino_principal ?? null,
            superficie_terreno_m2: feature.properties?.superficie_terreno_m2 ?? null,
            comuna: comunaName,
          }))
          setParcels(transformed)
        } else {
          setError(data.error || 'Failed to load cadastre data')
          setParcels([])
        }
      })
      .catch((err) => {
        setError(err.message)
        setParcels([])
      })
      .finally(() => setLoading(false))
  }, [siiComunaCode, comunaName])

  return { parcels, loading, error }
}
