/**
 * EJEMPLOS DE USO - FilterAdvertiserSection
 *
 * Este archivo contiene ejemplos prácticos de cómo usar el nuevo
 * filtro mejorado "Particular | Agencia"
 */

import { useState, useEffect } from 'react'
import { useFilters } from '@/hooks/useFilters'
import FilterPanel from './FilterPanel'
import type { AdvertiserFilterState } from './FilterAdvertiserSection'

// ═════════════════════════════════════════════════════════════════════════════
// EJEMPLO 1: Componente básico con FilterPanel
// ═════════════════════════════════════════════════════════════════════════════

export function Example1_BasicFilterPanel() {
  const { filters, updateFilters, clearFilters, toQueryParams } = useFilters()
  const [isOpen, setIsOpen] = useState(false)
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([])
  const [isLoadingAgencies, setIsLoadingAgencies] = useState(false)

  // Cargar agencias
  useEffect(() => {
    const fetchAgencies = async () => {
      setIsLoadingAgencies(true)
      try {
        // TODO: Reemplazar con endpoint real
        const response = await fetch('/api/agencies')
        const data = await response.json()
        setAgencies(data.map((a: any) => ({ id: a.id, name: a.name })))
      } catch (error) {
        console.error('Error loading agencies:', error)
      } finally {
        setIsLoadingAgencies(false)
      }
    }
    fetchAgencies()
  }, [])

  const handleApply = () => {
    const params = toQueryParams()
    // Navegar o hacer request a API
    console.log('Applying filters:', params.toString())
    setIsOpen(false)
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg"
      >
        Abrir Filtros
      </button>

      <FilterPanel
        filters={filters}
        onFilterChange={updateFilters}
        onApply={handleApply}
        onClear={clearFilters}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        agencies={agencies}
        isLoadingAgencies={isLoadingAgencies}
      />

      {/* Mostrar filtros aplicados */}
      <pre className="p-4 bg-slate-900 rounded text-xs overflow-auto">
        {JSON.stringify(filters.advertiserFilter, null, 2)}
      </pre>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// EJEMPLO 2: Cambiar modo de filtro manualmente
// ═════════════════════════════════════════════════════════════════════════════

export function Example2_ManualModeChange() {
  const { filters, updateFilters } = useFilters()

  const setAdvertiserMode = (mode: 'all' | 'particular' | 'agency') => {
    updateFilters({
      advertiserFilter: {
        mode,
        particularOptions: {
          onlyParticular: false,
          isPrivateByAgency: false,
          wasPrivateByAgency: false,
        },
        agencyOptions: {
          agencyId: null,
          agencyName: null,
          exclusive: false,
          exclusiveMode: 'both',
          excludeAgencyId: null,
        },
      },
    })
  }

  return (
    <div className="space-y-2">
      <button onClick={() => setAdvertiserMode('all')} className="block px-4 py-2 bg-slate-600">
        Todo
      </button>
      <button onClick={() => setAdvertiserMode('particular')} className="block px-4 py-2 bg-slate-600">
        Particular
      </button>
      <button onClick={() => setAdvertiserMode('agency')} className="block px-4 py-2 bg-slate-600">
        Agencias
      </button>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// EJEMPLO 3: Configurar filtros específicos programáticamente
// ═════════════════════════════════════════════════════════════════════════════

export function Example3_ConfigureFilters() {
  const { updateFilters } = useFilters()

  // Solo particulares
  const filterOnlyParticulars = () => {
    updateFilters({
      advertiserFilter: {
        mode: 'particular',
        particularOptions: {
          onlyParticular: true,
          isPrivateByAgency: false,
          wasPrivateByAgency: false,
        },
        agencyOptions: {
          agencyId: null,
          agencyName: null,
          exclusive: false,
          exclusiveMode: 'both',
          excludeAgencyId: null,
        },
      },
    })
  }

  // Agencia específica (solo exclusivos)
  const filterByAgencyExclusive = (agencyId: string, agencyName: string) => {
    updateFilters({
      advertiserFilter: {
        mode: 'agency',
        particularOptions: {
          onlyParticular: false,
          isPrivateByAgency: false,
          wasPrivateByAgency: false,
        },
        agencyOptions: {
          agencyId,
          agencyName,
          exclusive: true,
          exclusiveMode: 'only',
          excludeAgencyId: null,
        },
      },
    })
  }

  // Excluir agencia
  const filterExcludeAgency = (agencyId: string) => {
    updateFilters({
      advertiserFilter: {
        mode: 'agency',
        particularOptions: {
          onlyParticular: false,
          isPrivateByAgency: false,
          wasPrivateByAgency: false,
        },
        agencyOptions: {
          agencyId: null,
          agencyName: null,
          exclusive: false,
          exclusiveMode: 'both',
          excludeAgencyId: agencyId,
        },
      },
    })
  }

  return (
    <div className="space-y-2">
      <button
        onClick={filterOnlyParticulars}
        className="block px-4 py-2 bg-green-600 text-white rounded"
      >
        Filtrar: Solo Particulares
      </button>
      <button
        onClick={() => filterByAgencyExclusive('uuid-123', 'Mi Agencia')}
        className="block px-4 py-2 bg-blue-600 text-white rounded"
      >
        Filtrar: Agencia Mi Agencia (Exclusivos)
      </button>
      <button
        onClick={() => filterExcludeAgency('uuid-456')}
        className="block px-4 py-2 bg-red-600 text-white rounded"
      >
        Filtrar: Excluir Agencia
      </button>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// EJEMPLO 4: Cargar filtros desde URL
// ═════════════════════════════════════════════════════════════════════════════

export function Example4_LoadFromURL() {
  const { filters, loadFromQueryParams } = useFilters()
  const [currentURL, setCurrentURL] = useState('')

  useEffect(() => {
    setCurrentURL(window.location.href)
    // Cargar filtros desde URL actual
    loadFromQueryParams(new URLSearchParams(window.location.search))
  }, [])

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-800 rounded">
        <p className="text-sm text-slate-400 mb-2">URL actual:</p>
        <code className="text-xs break-all">{currentURL}</code>
      </div>

      <div className="p-4 bg-slate-800 rounded">
        <p className="text-sm text-slate-400 mb-2">Filtro de anunciante:</p>
        <pre className="text-xs">
          {JSON.stringify(filters.advertiserFilter, null, 2)}
        </pre>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// EJEMPLO 5: URL params generados
// ═════════════════════════════════════════════════════════════════════════════

export function Example5_GenerateURLParams() {
  const { updateFilters, toQueryParams } = useFilters()

  const examples = [
    {
      name: 'Todo',
      setup: () =>
        updateFilters({
          advertiserFilter: {
            mode: 'all',
            particularOptions: {
              onlyParticular: false,
              isPrivateByAgency: false,
              wasPrivateByAgency: false,
            },
            agencyOptions: {
              agencyId: null,
              agencyName: null,
              exclusive: false,
              exclusiveMode: 'both',
              excludeAgencyId: null,
            },
          },
        }),
      expected: 'advertiser_mode=all',
    },
    {
      name: 'Solo particulares',
      setup: () =>
        updateFilters({
          advertiserFilter: {
            mode: 'particular',
            particularOptions: {
              onlyParticular: true,
              isPrivateByAgency: false,
              wasPrivateByAgency: false,
            },
            agencyOptions: {
              agencyId: null,
              agencyName: null,
              exclusive: false,
              exclusiveMode: 'both',
              excludeAgencyId: null,
            },
          },
        }),
      expected: 'advertiser_mode=particular&only_particular=true',
    },
    {
      name: 'Agencia específica (solo exclusivos)',
      setup: () =>
        updateFilters({
          advertiserFilter: {
            mode: 'agency',
            particularOptions: {
              onlyParticular: false,
              isPrivateByAgency: false,
              wasPrivateByAgency: false,
            },
            agencyOptions: {
              agencyId: 'uuid-123',
              agencyName: 'Mi Agencia',
              exclusive: true,
              exclusiveMode: 'only',
              excludeAgencyId: null,
            },
          },
        }),
      expected:
        'advertiser_mode=agency&agency_id=uuid-123&exclusive_mode=only',
    },
  ]

  return (
    <div className="space-y-4">
      {examples.map((ex) => (
        <div key={ex.name} className="p-4 border border-slate-600 rounded">
          <button
            onClick={ex.setup}
            className="mb-3 px-3 py-1 bg-blue-600 text-sm rounded"
          >
            Aplicar: {ex.name}
          </button>
          <div className="space-y-2 text-xs">
            <div>
              <p className="text-slate-400">Esperado:</p>
              <code className="text-green-400 block break-all">
                {ex.expected}
              </code>
            </div>
            <div>
              <p className="text-slate-400">Actual:</p>
              <code className="text-blue-400 block break-all">
                {toQueryParams().toString()}
              </code>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// EJEMPLO 6: Componente personalizado con lógica customizada
// ═════════════════════════════════════════════════════════════════════════════

export function Example6_CustomComponent() {
  const { filters, updateFilters } = useFilters()
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    // Cargar agencias
    fetch('/api/agencies')
      .then((r) => r.json())
      .then((data) => setAgencies(data))
  }, [])

  return (
    <div className="space-y-4 p-4 border border-slate-600 rounded">
      <h3 className="font-bold">Filtro Personalizado</h3>

      {/* Botones rápidos */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            const state: AdvertiserFilterState = {
              mode: 'particular',
              particularOptions: {
                onlyParticular: true,
                isPrivateByAgency: false,
                wasPrivateByAgency: false,
              },
              agencyOptions: {
                agencyId: null,
                agencyName: null,
                exclusive: false,
                exclusiveMode: 'both',
                excludeAgencyId: null,
              },
            }
            updateFilters({ advertiserFilter: state })
          }}
          className="px-3 py-1 bg-slate-600 rounded text-xs"
        >
          Particulares
        </button>
        <button
          onClick={() => {
            const state: AdvertiserFilterState = {
              mode: 'agency',
              particularOptions: {
                onlyParticular: false,
                isPrivateByAgency: false,
                wasPrivateByAgency: false,
              },
              agencyOptions: {
                agencyId: null,
                agencyName: null,
                exclusive: false,
                exclusiveMode: 'both',
                excludeAgencyId: null,
              },
            }
            updateFilters({ advertiserFilter: state })
          }}
          className="px-3 py-1 bg-slate-600 rounded text-xs"
        >
          Agencias
        </button>
      </div>

      {/* Selector dinámico de agencia */}
      {filters.advertiserFilter.mode === 'agency' && (
        <select
          value={filters.advertiserFilter.agencyOptions.agencyId || ''}
          onChange={(e) => {
            const agency = agencies.find((a) => a.id === e.target.value)
            updateFilters({
              advertiserFilter: {
                ...filters.advertiserFilter,
                agencyOptions: {
                  ...filters.advertiserFilter.agencyOptions,
                  agencyId: agency?.id || null,
                  agencyName: agency?.name || null,
                },
              },
            })
          }}
          className="w-full px-3 py-2 bg-slate-700 rounded text-sm"
        >
          <option value="">Seleccionar agencia</option>
          {agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}

      {/* Vista del estado actual */}
      <pre className="p-2 bg-slate-900 rounded text-xs overflow-auto">
        {JSON.stringify(filters.advertiserFilter, null, 2)}
      </pre>
    </div>
  )
}
