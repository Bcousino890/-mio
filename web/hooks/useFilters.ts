'use client'

import { useState, useCallback, useEffect } from 'react'
import type { FilterState } from '@/components/filters/FilterPanel'

const INITIAL_STATE: FilterState = {
  operation: 'all',
  advertiserType: 'all',
  propertyTypes: [],
  price: { min: null, max: null },
  squareMeters: { min: null, max: null },
  pricePerSqm: { min: null, max: null },
  bedrooms: { min: null, max: null },
  bathrooms: { min: null, max: null },
  yearBuilt: { min: null, max: null },
  daysOnMarket: { min: null, max: null },
  parcelSize: { min: null, max: null },
  floor: null,
  view: null,
  orientation: null,
  furnished: null,
  energyRating: null,
  characteristics: [],
  location: null,
  distance: null,
}

const STORAGE_KEY = 'casafari:filters:current'

/**
 * Hook para manejar el estado de filtros
 * Persiste en localStorage y permite compartir estado entre componentes
 */
export function useFilters(initialFilters?: Partial<FilterState>) {
  const [filters, setFilters] = useState<FilterState>(INITIAL_STATE)
  const [isLoaded, setIsLoaded] = useState(false)

  // Cargar filtros desde localStorage al montar
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        setFilters({ ...INITIAL_STATE, ...parsed, ...initialFilters })
      } else if (initialFilters) {
        setFilters({ ...INITIAL_STATE, ...initialFilters })
      }
    } catch (err) {
      console.error('Error loading filters from localStorage:', err)
    }
    setIsLoaded(true)
  }, [])

  // Guardar en localStorage cuando cambien
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
    }
  }, [filters, isLoaded])

  const updateFilters = useCallback((updates: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...updates }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(INITIAL_STATE)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const resetToDefaults = useCallback(() => {
    setFilters(INITIAL_STATE)
  }, [])

  // Construir query params para la API
  const toQueryParams = useCallback(() => {
    const params = new URLSearchParams()

    if (filters.operation !== 'all') params.set('operation', filters.operation)
    if (filters.advertiserType !== 'all') {
      const type = filters.advertiserType === 'particular' ? 'particular' : 'professional'
      params.set('advertiser_type', type)
    }
    if (filters.propertyTypes.length > 0) {
      params.set('property_types', filters.propertyTypes.join(','))
    }
    if (filters.price.min !== null) params.set('price_min', String(filters.price.min))
    if (filters.price.max !== null) params.set('price_max', String(filters.price.max))
    if (filters.squareMeters.min !== null) params.set('sqm_min', String(filters.squareMeters.min))
    if (filters.squareMeters.max !== null) params.set('sqm_max', String(filters.squareMeters.max))
    if (filters.pricePerSqm.min !== null) params.set('price_sqm_min', String(filters.pricePerSqm.min))
    if (filters.pricePerSqm.max !== null) params.set('price_sqm_max', String(filters.pricePerSqm.max))
    if (filters.bedrooms.min !== null) params.set('bedrooms_min', String(filters.bedrooms.min))
    if (filters.bedrooms.max !== null) params.set('bedrooms_max', String(filters.bedrooms.max))
    if (filters.bathrooms.min !== null) params.set('bathrooms_min', String(filters.bathrooms.min))
    if (filters.bathrooms.max !== null) params.set('bathrooms_max', String(filters.bathrooms.max))
    if (filters.yearBuilt.min !== null) params.set('year_built_min', String(filters.yearBuilt.min))
    if (filters.yearBuilt.max !== null) params.set('year_built_max', String(filters.yearBuilt.max))
    if (filters.daysOnMarket.min !== null) params.set('days_on_market_min', String(filters.daysOnMarket.min))
    if (filters.daysOnMarket.max !== null) params.set('days_on_market_max', String(filters.daysOnMarket.max))
    if (filters.parcelSize.min !== null) params.set('parcel_size_min', String(filters.parcelSize.min))
    if (filters.parcelSize.max !== null) params.set('parcel_size_max', String(filters.parcelSize.max))
    if (filters.location) params.set('location', filters.location)
    if (filters.distance !== null) params.set('distance_km', String(filters.distance))
    if (filters.floor) params.set('floor', filters.floor)
    if (filters.view) params.set('view', filters.view)
    if (filters.orientation) params.set('orientation', filters.orientation)
    if (filters.furnished !== null) params.set('furnished', String(filters.furnished))
    if (filters.energyRating) params.set('energy_rating', filters.energyRating)
    if (filters.characteristics.length > 0) {
      params.set('characteristics', filters.characteristics.join(','))
    }

    return params
  }, [filters])

  // Crear URL shareable
  const getShareableUrl = useCallback((baseUrl: string = '/anuncios') => {
    const params = toQueryParams()
    return params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl
  }, [toQueryParams])

  // Cargar filtros desde URL params
  const loadFromQueryParams = useCallback((params: URLSearchParams) => {
    const updates: Partial<FilterState> = {}

    const op = params.get('operation')
    if (op && ['all', 'sale', 'rent'].includes(op)) {
      updates.operation = op as 'all' | 'sale' | 'rent'
    }

    const advType = params.get('advertiser_type')
    if (advType && ['all', 'particular', 'professional'].includes(advType)) {
      updates.advertiserType = advType as 'all' | 'particular' | 'professional'
    }

    const propTypes = params.get('property_types')
    if (propTypes) {
      updates.propertyTypes = propTypes.split(',')
    }

    const priceMin = params.get('price_min')
    const priceMax = params.get('price_max')
    if (priceMin || priceMax) {
      updates.price = {
        min: priceMin ? parseInt(priceMin) : null,
        max: priceMax ? parseInt(priceMax) : null,
      }
    }

    // ... más parámetros según sea necesario

    if (Object.keys(updates).length > 0) {
      setFilters((prev) => ({ ...prev, ...updates }))
    }
  }, [])

  return {
    filters,
    updateFilters,
    clearFilters,
    resetToDefaults,
    toQueryParams,
    getShareableUrl,
    loadFromQueryParams,
  }
}
