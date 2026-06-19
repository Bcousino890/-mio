'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface District {
  id: string
  name: string
  slug: string
  code: string
}

export interface Zone {
  id: string
  name: string
  slug: string
}

export interface Subzone {
  id: string
  name: string
  slug: string
}

export interface LocationOptions {
  districts: District[]
  zones: Zone[]
  subzones: Subzone[]
  loading: {
    districts: boolean
    zones: boolean
    subzones: boolean
  }
  error: {
    districts?: string
    zones?: string
    subzones?: string
  }
}

/**
 * Hook para cargar opciones de ubicación normalizada en cascada (migración 0019)
 * Maneja loading, caching y cambios dinámicos de zona/subzona
 */
export function useLocationOptions(
  selectedDistrictId: string | null,
  selectedZoneId: string | null
) {
  const [options, setOptions] = useState<LocationOptions>({
    districts: [],
    zones: [],
    subzones: [],
    loading: { districts: true, zones: false, subzones: false },
    error: {},
  })

  // Usar refs para cachear resultados y evitar fetches innecesarios
  const districtsCache = useRef<District[]>([])
  const zonesCache = useRef<Map<string, Zone[]>>(new Map())
  const subzonesCache = useRef<Map<string, Subzone[]>>(new Map())

  // Cargar distritos (una sola vez)
  useEffect(() => {
    if (districtsCache.current.length > 0) {
      setOptions((prev) => ({
        ...prev,
        districts: districtsCache.current,
        loading: { ...prev.loading, districts: false },
      }))
      return
    }

    const fetchDistricts = async () => {
      try {
        const response = await fetch('/api/locations/districts')
        if (!response.ok) throw new Error('Failed to fetch districts')
        const data = await response.json()
        if (data.success) {
          districtsCache.current = data.data
          setOptions((prev) => ({
            ...prev,
            districts: data.data,
            loading: { ...prev.loading, districts: false },
          }))
        }
      } catch (error) {
        console.error('Error fetching districts:', error)
        setOptions((prev) => ({
          ...prev,
          loading: { ...prev.loading, districts: false },
          error: { ...prev.error, districts: 'No se pudieron cargar los distritos' },
        }))
      }
    }

    fetchDistricts()
  }, [])

  // Cargar zonas cuando cambia el distrito
  useEffect(() => {
    if (!selectedDistrictId) {
      setOptions((prev) => ({
        ...prev,
        zones: [],
        subzones: [],
        loading: { ...prev.loading, zones: false, subzones: false },
        error: { ...prev.error, zones: undefined, subzones: undefined },
      }))
      return
    }

    // Verificar cache
    if (zonesCache.current.has(selectedDistrictId)) {
      const cached = zonesCache.current.get(selectedDistrictId)!
      setOptions((prev) => ({
        ...prev,
        zones: cached,
        loading: { ...prev.loading, zones: false },
      }))
      return
    }

    const fetchZones = async () => {
      setOptions((prev) => ({
        ...prev,
        loading: { ...prev.loading, zones: true },
      }))

      try {
        const response = await fetch(
          `/api/locations/zones?district_id=${encodeURIComponent(selectedDistrictId)}`
        )
        if (!response.ok) throw new Error('Failed to fetch zones')
        const data = await response.json()
        if (data.success) {
          zonesCache.current.set(selectedDistrictId, data.data)
          setOptions((prev) => ({
            ...prev,
            zones: data.data,
            subzones: [], // Limpiar subzonas al cambiar distrito
            loading: { ...prev.loading, zones: false, subzones: false },
            error: { ...prev.error, zones: undefined, subzones: undefined },
          }))
        }
      } catch (error) {
        console.error('Error fetching zones:', error)
        setOptions((prev) => ({
          ...prev,
          zones: [],
          loading: { ...prev.loading, zones: false },
          error: { ...prev.error, zones: 'No se pudieron cargar las zonas' },
        }))
      }
    }

    fetchZones()
  }, [selectedDistrictId])

  // Cargar subzonas cuando cambia la zona
  useEffect(() => {
    if (!selectedZoneId) {
      setOptions((prev) => ({
        ...prev,
        subzones: [],
        loading: { ...prev.loading, subzones: false },
        error: { ...prev.error, subzones: undefined },
      }))
      return
    }

    // Verificar cache
    if (subzonesCache.current.has(selectedZoneId)) {
      const cached = subzonesCache.current.get(selectedZoneId)!
      setOptions((prev) => ({
        ...prev,
        subzones: cached,
        loading: { ...prev.loading, subzones: false },
      }))
      return
    }

    const fetchSubzones = async () => {
      setOptions((prev) => ({
        ...prev,
        loading: { ...prev.loading, subzones: true },
      }))

      try {
        const response = await fetch(
          `/api/locations/subzones?zone_id=${encodeURIComponent(selectedZoneId)}`
        )
        if (!response.ok) throw new Error('Failed to fetch subzones')
        const data = await response.json()
        if (data.success) {
          subzonesCache.current.set(selectedZoneId, data.data)
          setOptions((prev) => ({
            ...prev,
            subzones: data.data,
            loading: { ...prev.loading, subzones: false },
            error: { ...prev.error, subzones: undefined },
          }))
        }
      } catch (error) {
        console.error('Error fetching subzones:', error)
        setOptions((prev) => ({
          ...prev,
          subzones: [],
          loading: { ...prev.loading, subzones: false },
          error: { ...prev.error, subzones: 'No se pudieron cargar las subzonas' },
        }))
      }
    }

    fetchSubzones()
  }, [selectedZoneId])

  // Función para buscar ubicaciones por texto
  const searchLocations = useCallback(async (query: string) => {
    if (!query || query.length < 2) return null

    try {
      const response = await fetch(
        `/api/locations/search?q=${encodeURIComponent(query)}`
      )
      if (!response.ok) throw new Error('Failed to search locations')
      const data = await response.json()
      if (data.success) {
        return data.data
      }
    } catch (error) {
      console.error('Error searching locations:', error)
    }
    return null
  }, [])

  return {
    options,
    searchLocations,
  }
}
