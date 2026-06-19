'use client'

import { useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * ADVERTISER FILTER STATE
 *
 * Estructura mejorada para incluir todas las opciones:
 * - Operador principal (radio): Todo | Particular | Agencias
 * - Sub-opciones particulares (checkboxes):
 *   - Sólo particulares
 *   - Listado como privado por la agencia (TODO: columna BD)
 *   - Ex-Listado como privado por la agencia (TODO: columna BD)
 * - Sub-opciones agencias (checkboxes):
 *   - Con esta agencia (selector desplegable)
 *   - Exclusivo
 *   - No exclusivo
 *   - Excluir esta agencia
 */

export interface AdvertiserFilterState {
  // Operador principal
  mode: 'all' | 'particular' | 'agency'

  // Opciones particulares (activos solo cuando mode === 'particular')
  particularOptions: {
    onlyParticular: boolean
    isPrivateByAgency: boolean      // TODO: requiere nueva columna BD
    wasPrivateByAgency: boolean     // TODO: requiere nueva columna BD
  }

  // Opciones agencias (activas solo cuando mode === 'agency')
  agencyOptions: {
    agencyId: string | null         // ID de agencia seleccionada
    agencyName: string | null       // Nombre para mostrar
    exclusive: boolean              // true = solo exclusivos, false = solo no exclusivos
    exclusiveMode: 'both' | 'only' | 'only_non'  // both = ambos, only = solo exclusivos, only_non = solo no exclusivos
    excludeAgencyId: string | null  // ID de agencia a excluir
  }
}

interface Agency {
  id: string
  name: string
}

interface FilterAdvertiserSectionProps {
  value: AdvertiserFilterState
  onChange: (value: AdvertiserFilterState) => void
  agencies: Agency[]
  isLoadingAgencies?: boolean
}

export default function FilterAdvertiserSection({
  value,
  onChange,
  agencies = [],
  isLoadingAgencies = false,
}: FilterAdvertiserSectionProps) {
  const [expanded, setExpanded] = useState<'particular' | 'agency' | null>(null)

  const handleModeChange = (mode: 'all' | 'particular' | 'agency') => {
    onChange({
      ...value,
      mode,
      // Resetear sub-opciones cuando cambian el modo
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
    })
    setExpanded(null)
  }

  const handleParticularChange = (
    key: keyof typeof value.particularOptions,
    checked: boolean
  ) => {
    onChange({
      ...value,
      particularOptions: {
        ...value.particularOptions,
        [key]: checked,
      },
    })
  }

  const handleAgencyChange = (
    key: keyof typeof value.agencyOptions,
    val: string | boolean | null
  ) => {
    onChange({
      ...value,
      agencyOptions: {
        ...value.agencyOptions,
        [key]: val,
      },
    })
  }

  const handleAgencySelect = (agencyId: string, agencyName: string) => {
    onChange({
      ...value,
      agencyOptions: {
        ...value.agencyOptions,
        agencyId,
        agencyName,
      },
    })
    setExpanded(null)
  }

  const handleExcludeAgencySelect = (agencyId: string) => {
    onChange({
      ...value,
      agencyOptions: {
        ...value.agencyOptions,
        excludeAgencyId: agencyId,
      },
    })
  }

  return (
    <fieldset>
      <legend className="sr-only">Tipo de anunciante</legend>
      <div className="space-y-2">
        {/* ━━━ OPERADOR PRINCIPAL (RADIO) ━━━ */}
        <div className="space-y-1.5">
          {/* TODO */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="radio"
              name="advertiser-mode"
              value="all"
              checked={value.mode === 'all'}
              onChange={() => handleModeChange('all')}
              className="w-4 h-4 rounded-full border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
            />
            <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
              Todo (muestra todos los anuncios)
            </span>
          </label>

          {/* Particular */}
          <div>
            <button
              onClick={() =>
                setExpanded(expanded === 'particular' ? null : 'particular')
              }
              className="flex items-center gap-2 w-full text-left cursor-pointer group"
            >
              <input
                type="radio"
                name="advertiser-mode"
                value="particular"
                checked={value.mode === 'particular'}
                onChange={() => handleModeChange('particular')}
                className="w-4 h-4 rounded-full border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
                onClick={(e) => e.stopPropagation()}
              />
              <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors flex-1">
                Particular
              </span>
              <ChevronDown
                size={14}
                className={`text-slate-500 transition-transform duration-200 ${
                  expanded === 'particular' ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Sub-opciones Particular */}
            {expanded === 'particular' && value.mode === 'particular' && (
              <div className="ml-6 mt-2 space-y-1.5 pl-2 border-l border-slate-700">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={value.particularOptions.onlyParticular}
                    onChange={(e) =>
                      handleParticularChange('onlyParticular', e.target.checked)
                    }
                    className="w-4 h-4 rounded border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
                  />
                  <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
                    Sólo particulares
                  </span>
                </label>

                {/* TODO: Cuando se agreguen las columnas a BD */}
                <label className="flex items-center gap-2 cursor-pointer group opacity-50 cursor-not-allowed">
                  <input
                    type="checkbox"
                    disabled
                    className="w-4 h-4 rounded border border-[var(--c-border-card)] bg-[var(--c-surface)] cursor-not-allowed"
                  />
                  <span className="text-xs text-slate-500">
                    Listado como privado por la agencia
                  </span>
                </label>

                {/* TODO: Cuando se agreguen las columnas a BD */}
                <label className="flex items-center gap-2 cursor-pointer group opacity-50 cursor-not-allowed">
                  <input
                    type="checkbox"
                    disabled
                    className="w-4 h-4 rounded border border-[var(--c-border-card)] bg-[var(--c-surface)] cursor-not-allowed"
                  />
                  <span className="text-xs text-slate-500">
                    Ex-Listado como privado por la agencia
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Agencias */}
          <div>
            <button
              onClick={() =>
                setExpanded(expanded === 'agency' ? null : 'agency')
              }
              className="flex items-center gap-2 w-full text-left cursor-pointer group"
            >
              <input
                type="radio"
                name="advertiser-mode"
                value="agency"
                checked={value.mode === 'agency'}
                onChange={() => handleModeChange('agency')}
                className="w-4 h-4 rounded-full border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
                onClick={(e) => e.stopPropagation()}
              />
              <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors flex-1">
                Agencias
              </span>
              <ChevronDown
                size={14}
                className={`text-slate-500 transition-transform duration-200 ${
                  expanded === 'agency' ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Sub-opciones Agencias */}
            {expanded === 'agency' && value.mode === 'agency' && (
              <div className="ml-6 mt-2 space-y-3 pl-2 border-l border-slate-700">
                {/* Con esta agencia */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer group mb-1.5">
                    <input
                      type="checkbox"
                      checked={value.agencyOptions.agencyId !== null}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          handleAgencyChange('agencyId', null)
                          handleAgencyChange('agencyName', null)
                        }
                      }}
                      className="w-4 h-4 rounded border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
                    />
                    <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
                      Con esta agencia
                    </span>
                  </label>

                  {value.agencyOptions.agencyId !== null && (
                    <div className="ml-6">
                      <div className="relative">
                        <select
                          value={value.agencyOptions.agencyId || ''}
                          onChange={(e) => {
                            const selected = agencies.find(
                              (a) => a.id === e.target.value
                            )
                            if (selected) {
                              handleAgencySelect(selected.id, selected.name)
                            }
                          }}
                          disabled={isLoadingAgencies}
                          className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--c-border-card)] bg-[var(--c-surface)] text-slate-300 disabled:opacity-50 cursor-pointer"
                        >
                          <option value="">
                            {isLoadingAgencies
                              ? 'Cargando agencias...'
                              : 'Seleccionar agencia'}
                          </option>
                          {agencies.map((agency) => (
                            <option key={agency.id} value={agency.id}>
                              {agency.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Tipo de exclusividad */}
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1.5">
                    Exclusividad
                  </p>
                  <div className="space-y-1.5 ml-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="radio"
                        name="exclusive-mode"
                        value="both"
                        checked={value.agencyOptions.exclusiveMode === 'both'}
                        onChange={() =>
                          handleAgencyChange('exclusiveMode', 'both')
                        }
                        className="w-4 h-4 rounded-full border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600"
                      />
                      <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
                        Ambos
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="radio"
                        name="exclusive-mode"
                        value="only"
                        checked={value.agencyOptions.exclusiveMode === 'only'}
                        onChange={() =>
                          handleAgencyChange('exclusiveMode', 'only')
                        }
                        className="w-4 h-4 rounded-full border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600"
                      />
                      <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
                        Sólo exclusivos
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="radio"
                        name="exclusive-mode"
                        value="only_non"
                        checked={
                          value.agencyOptions.exclusiveMode === 'only_non'
                        }
                        onChange={() =>
                          handleAgencyChange('exclusiveMode', 'only_non')
                        }
                        className="w-4 h-4 rounded-full border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600"
                      />
                      <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
                        Sólo no exclusivos
                      </span>
                    </label>
                  </div>
                </div>

                {/* Excluir esta agencia */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer group mb-1.5">
                    <input
                      type="checkbox"
                      checked={value.agencyOptions.excludeAgencyId !== null}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          handleExcludeAgencySelect('')
                        }
                      }}
                      className="w-4 h-4 rounded border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
                    />
                    <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
                      Excluir esta agencia
                    </span>
                  </label>

                  {value.agencyOptions.excludeAgencyId !== null && (
                    <div className="ml-6">
                      <select
                        value={value.agencyOptions.excludeAgencyId || ''}
                        onChange={(e) => handleExcludeAgencySelect(e.target.value)}
                        disabled={isLoadingAgencies}
                        className="w-full px-2 py-1.5 text-xs rounded-lg border border-[var(--c-border-card)] bg-[var(--c-surface)] text-slate-300 disabled:opacity-50 cursor-pointer"
                      >
                        <option value="">Seleccionar agencia a excluir</option>
                        {agencies.map((agency) => (
                          <option key={agency.id} value={agency.id}>
                            {agency.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </fieldset>
  )
}
