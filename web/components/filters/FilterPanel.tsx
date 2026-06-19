'use client'

import { useState, useCallback, useMemo } from 'react'
import { ChevronDown, RotateCcw, X } from 'lucide-react'
import FilterRadioGroup from './FilterRadioGroup'
import FilterCheckboxGroup from './FilterCheckboxGroup'
import FilterRangeSlider from './FilterRangeSlider'
import FilterSelect from './FilterSelect'
import FilterSearchBox from './FilterSearchBox'
import FilterGroupToggle from './FilterGroupToggle'
import FilterAdvertiserSection, { AdvertiserFilterState } from './FilterAdvertiserSection'
import FilterLocationSection from './FilterLocationSection'

export interface FilterState {
  // Operación y tipo de anunciante
  operation: 'all' | 'sale' | 'rent'
  advertiserType: 'all' | 'particular' | 'professional'
  advertiserFilter: AdvertiserFilterState

  // Tipo de propiedad
  propertyTypes: string[]

  // Rangos numéricos
  price: { min: number | null; max: number | null }
  squareMeters: { min: number | null; max: number | null }
  pricePerSqm: { min: number | null; max: number | null }
  bedrooms: { min: number | null; max: number | null }
  bathrooms: { min: number | null; max: number | null }
  yearBuilt: { min: number | null; max: number | null }
  daysOnMarket: { min: number | null; max: number | null }
  parcelSize: { min: number | null; max: number | null }

  // Detalles
  floor: string | null
  view: string | null
  orientation: string | null
  furnished: boolean | null
  energyRating: string | null
  characteristics: string[]

  // Ubicación
  location: string | null
  distance: number | null
  // Nuevos campos normalizados para cascada distrito → zona → subzona (migración 0019)
  selected_district_id: string | null
  selected_zone_id: string | null
  selected_subzone_id: string | null
}

interface Agency {
  id: string
  name: string
}

interface FilterPanelProps {
  filters: FilterState
  onFilterChange: (filters: FilterState) => void
  onApply: () => void
  onClear: () => void
  isOpen: boolean
  onClose: () => void
  agencies?: Agency[]
  isLoadingAgencies?: boolean
}

const PROPERTY_TYPES = [
  { id: 'piso', label: 'Piso' },
  { id: 'atico', label: 'Ático' },
  { id: 'chalet', label: 'Chalet' },
  { id: 'duplex', label: 'Dúplex' },
  { id: 'estudio', label: 'Estudio' },
  { id: 'loft', label: 'Loft' },
  { id: 'casa', label: 'Casa' },
  { id: 'apartamento', label: 'Apartamento' },
]

const CHARACTERISTICS = [
  { id: 'balcon', label: 'Balcón' },
  { id: 'ascensor', label: 'Ascensor' },
  { id: 'garaje', label: 'Garaje' },
  { id: 'jardin', label: 'Jardín' },
  { id: 'trastero', label: 'Trastero' },
  { id: 'piscina', label: 'Piscina' },
  { id: 'terraza', label: 'Terraza' },
  { id: 'sotano', label: 'Sótano' },
]

const FLOOR_OPTIONS = [
  { id: '', label: 'Cualquiera' },
  { id: 'planta_baja', label: 'Planta baja' },
  { id: 'entresuelo', label: 'Entresuelo' },
  { id: 'piso_1', label: '1º piso' },
  { id: 'piso_2', label: '2º piso' },
  { id: 'piso_3', label: '3º piso' },
  { id: 'piso_4', label: '4º+ piso' },
]

const VIEW_OPTIONS = [
  { id: '', label: 'Cualquiera' },
  { id: 'calle', label: 'A la calle' },
  { id: 'interior', label: 'Interior' },
  { id: 'mar', label: 'Al mar' },
  { id: 'montaña', label: 'A montaña' },
  { id: 'parque', label: 'A parque' },
]

const ORIENTATION_OPTIONS = [
  { id: '', label: 'Cualquiera' },
  { id: 'norte', label: 'Norte' },
  { id: 'sur', label: 'Sur' },
  { id: 'este', label: 'Este' },
  { id: 'oeste', label: 'Oeste' },
  { id: 'noroeste', label: 'Noroeste' },
  { id: 'noreste', label: 'Noreste' },
  { id: 'suroeste', label: 'Suroeste' },
  { id: 'sureste', label: 'Sureste' },
]

const ENERGY_RATINGS = ['A', 'B', 'C', 'D', 'E', 'F']

function calculateActiveFilters(filters: FilterState): number {
  let count = 0

  if (filters.operation !== 'all') count++
  if (filters.advertiserType !== 'all') count++
  if (filters.advertiserFilter.mode !== 'all') count++
  if (filters.propertyTypes.length > 0) count++
  if (filters.price.min !== null || filters.price.max !== null) count++
  if (filters.bedrooms.min !== null || filters.bedrooms.max !== null) count++
  if (filters.bathrooms.min !== null || filters.bathrooms.max !== null) count++
  if (filters.squareMeters.min !== null || filters.squareMeters.max !== null) count++
  if (filters.pricePerSqm.min !== null || filters.pricePerSqm.max !== null) count++
  if (filters.location !== null) count++
  if (filters.floor !== null) count++
  if (filters.view !== null) count++
  if (filters.orientation !== null) count++
  if (filters.furnished !== null) count++
  if (filters.energyRating !== null) count++
  if (filters.characteristics.length > 0) count++
  if (filters.yearBuilt.min !== null || filters.yearBuilt.max !== null) count++
  if (filters.parcelSize.min !== null || filters.parcelSize.max !== null) count++
  if (filters.daysOnMarket.min !== null || filters.daysOnMarket.max !== null) count++
  // Nuevos campos de ubicación normalizada (migración 0019)
  if (filters.selected_district_id !== null) count++
  if (filters.selected_zone_id !== null) count++
  if (filters.selected_subzone_id !== null) count++

  return count
}

export default function FilterPanel({
  filters,
  onFilterChange,
  onApply,
  onClear,
  isOpen,
  onClose,
  agencies = [],
  isLoadingAgencies = false,
}: FilterPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['operacion', 'propiedad', 'precio'])
  )

  const activeCount = useMemo(() => calculateActiveFilters(filters), [filters])

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }, [])

  const handleChange = useCallback(
    (updates: Partial<FilterState>) => {
      onFilterChange({ ...filters, ...updates })
    },
    [filters, onFilterChange]
  )

  // Clase para el overlay del drawer en mobile
  const overlayClass = isOpen ? 'fixed inset-0 bg-black/50 z-40 transition-opacity duration-300' : 'hidden'

  // Clase para el panel
  const panelClass = `
    flex flex-col h-full bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-xl
    overflow-hidden transition-all duration-300
    fixed bottom-0 left-0 right-0 z-50 md:z-50 md:relative md:h-auto md:rounded-xl
    ${isOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 md:translate-y-0 md:opacity-100 md:pointer-events-none'}
    md:translate-y-0 md:opacity-100 md:pointer-events-auto
    ${isOpen ? 'max-h-[85vh]' : 'max-h-screen'} md:max-h-none
  `.trim()

  return (
    <>
      {/* Overlay (mobile only) */}
      <div
        className={overlayClass}
        onClick={onClose}
        aria-hidden={!isOpen}
      />

      {/* Panel */}
      <div className={panelClass}>
        {/* Header */}
        <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-[var(--c-border-card)] bg-[var(--c-surface)]">
          <h2 className="text-sm font-semibold text-slate-200">
            Filtros {activeCount > 0 && <span className="text-blue-400">({activeCount})</span>}
          </h2>
          <button
            onClick={onClose}
            className="md:hidden text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Cerrar filtros"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3 space-y-2">

            {/* ━━━ OPERACIÓN ━━━ */}
            <FilterGroupToggle
              id="operacion"
              label="Operación"
              isExpanded={expandedGroups.has('operacion')}
              onToggle={toggleGroup}
            >
              <FilterRadioGroup
                name="operation"
                value={filters.operation}
                onChange={(value) =>
                  handleChange({ operation: value as 'all' | 'sale' | 'rent' })
                }
                options={[
                  { id: 'all', label: 'Todas' },
                  { id: 'sale', label: 'Venta' },
                  { id: 'rent', label: 'Alquiler' },
                ]}
              />
            </FilterGroupToggle>

            {/* ━━━ UBICACIÓN NORMALIZADA (DISTRITO → ZONA → SUBZONA) ━━━ */}
            <FilterGroupToggle
              id="ubicacion_cascada"
              label="Ubicación (Cascada)"
              isExpanded={expandedGroups.has('ubicacion_cascada')}
              onToggle={toggleGroup}
            >
              <FilterLocationSection
                districtId={filters.selected_district_id}
                zoneId={filters.selected_zone_id}
                subzoneId={filters.selected_subzone_id}
                onDistrictChange={(id) =>
                  handleChange({ selected_district_id: id })
                }
                onZoneChange={(id) =>
                  handleChange({ selected_zone_id: id })
                }
                onSubzoneChange={(id) =>
                  handleChange({ selected_subzone_id: id })
                }
              />
            </FilterGroupToggle>

            {/* ━━━ PARTICULAR / AGENCIA (MEJORADO) ━━━ */}
            <FilterGroupToggle
              id="anunciante"
              label="Tipo de Anunciante"
              isExpanded={expandedGroups.has('anunciante')}
              onToggle={toggleGroup}
            >
              <FilterAdvertiserSection
                value={filters.advertiserFilter}
                onChange={(advertiserFilter) =>
                  handleChange({ advertiserFilter })
                }
                agencies={agencies}
                isLoadingAgencies={isLoadingAgencies}
              />
            </FilterGroupToggle>

            {/* ━━━ TIPO DE PROPIEDAD ━━━ */}
            <FilterGroupToggle
              id="propiedad"
              label="Tipo de Propiedad"
              isExpanded={expandedGroups.has('propiedad')}
              onToggle={toggleGroup}
            >
              <FilterCheckboxGroup
                name="propertyTypes"
                values={filters.propertyTypes}
                onChange={(values) => handleChange({ propertyTypes: values })}
                options={PROPERTY_TYPES}
                columns={2}
              />
            </FilterGroupToggle>

            {/* ━━━ PRECIO ━━━ */}
            <FilterGroupToggle
              id="precio"
              label="Precio (€)"
              isExpanded={expandedGroups.has('precio')}
              onToggle={toggleGroup}
            >
              <FilterRangeSlider
                label="Rango de precio"
                min={0}
                max={1000000}
                step={10000}
                values={[filters.price.min ?? 0, filters.price.max ?? 1000000]}
                onChange={(min, max) =>
                  handleChange({ price: { min, max } })
                }
                showInputs
                unit="€"
                format={(val) => `${(val / 1000).toFixed(0)}k`}
              />
            </FilterGroupToggle>

            {/* ━━━ DORMITORIOS ━━━ */}
            <FilterGroupToggle
              id="dormitorios"
              label="Dormitorios"
              isExpanded={expandedGroups.has('dormitorios')}
              onToggle={toggleGroup}
            >
              <div className="space-y-2">
                <FilterSelect
                  label="Mínimo"
                  value={filters.bedrooms.min?.toString() ?? ''}
                  onChange={(val) =>
                    handleChange({
                      bedrooms: { ...filters.bedrooms, min: val ? parseInt(val) : null },
                    })
                  }
                  options={[
                    { id: '', label: 'Cualquiera' },
                    { id: '0', label: '0+' },
                    { id: '1', label: '1+' },
                    { id: '2', label: '2+' },
                    { id: '3', label: '3+' },
                    { id: '4', label: '4+' },
                    { id: '5', label: '5+' },
                    { id: '6', label: '6+' },
                  ]}
                />
                <FilterSelect
                  label="Máximo"
                  value={filters.bedrooms.max?.toString() ?? ''}
                  onChange={(val) =>
                    handleChange({
                      bedrooms: { ...filters.bedrooms, max: val ? parseInt(val) : null },
                    })
                  }
                  options={[
                    { id: '', label: 'Cualquiera' },
                    { id: '1', label: '1' },
                    { id: '2', label: '2' },
                    { id: '3', label: '3' },
                    { id: '4', label: '4' },
                    { id: '5', label: '5' },
                    { id: '6', label: '6+' },
                  ]}
                />
              </div>
            </FilterGroupToggle>

            {/* ━━━ BAÑOS ━━━ */}
            <FilterGroupToggle
              id="banos"
              label="Baños"
              isExpanded={expandedGroups.has('banos')}
              onToggle={toggleGroup}
            >
              <div className="space-y-2">
                <FilterSelect
                  label="Mínimo"
                  value={filters.bathrooms.min?.toString() ?? ''}
                  onChange={(val) =>
                    handleChange({
                      bathrooms: { ...filters.bathrooms, min: val ? parseInt(val) : null },
                    })
                  }
                  options={[
                    { id: '', label: 'Cualquiera' },
                    { id: '1', label: '1+' },
                    { id: '2', label: '2+' },
                    { id: '3', label: '3+' },
                    { id: '4', label: '4+' },
                    { id: '5', label: '5+' },
                  ]}
                />
                <FilterSelect
                  label="Máximo"
                  value={filters.bathrooms.max?.toString() ?? ''}
                  onChange={(val) =>
                    handleChange({
                      bathrooms: { ...filters.bathrooms, max: val ? parseInt(val) : null },
                    })
                  }
                  options={[
                    { id: '', label: 'Cualquiera' },
                    { id: '1', label: '1' },
                    { id: '2', label: '2' },
                    { id: '3', label: '3' },
                    { id: '4', label: '4' },
                    { id: '5', label: '5+' },
                  ]}
                />
              </div>
            </FilterGroupToggle>

            {/* ━━━ SUPERFICIE ━━━ */}
            <FilterGroupToggle
              id="superficie"
              label="Superficie (m²)"
              isExpanded={expandedGroups.has('superficie')}
              onToggle={toggleGroup}
            >
              <FilterRangeSlider
                label="Rango de superficie"
                min={0}
                max={500}
                step={5}
                values={[filters.squareMeters.min ?? 0, filters.squareMeters.max ?? 500]}
                onChange={(min, max) =>
                  handleChange({ squareMeters: { min, max } })
                }
                showInputs
                unit="m²"
                format={(val) => `${val}`}
              />
            </FilterGroupToggle>

            {/* ━━━ PRECIO POR m² ━━━ */}
            <FilterGroupToggle
              id="precio_sqm"
              label="Precio por m² (€/m²)"
              isExpanded={expandedGroups.has('precio_sqm')}
              onToggle={toggleGroup}
            >
              <FilterRangeSlider
                label="Rango de precio/m²"
                min={0}
                max={10000}
                step={100}
                values={[filters.pricePerSqm.min ?? 0, filters.pricePerSqm.max ?? 10000]}
                onChange={(min, max) =>
                  handleChange({ pricePerSqm: { min, max } })
                }
                showInputs
                unit="€/m²"
                format={(val) => `${val}`}
              />
            </FilterGroupToggle>

            {/* ━━━ UBICACIÓN ━━━ */}
            <FilterGroupToggle
              id="ubicacion"
              label="Ubicación"
              isExpanded={expandedGroups.has('ubicacion')}
              onToggle={toggleGroup}
            >
              <FilterSearchBox
                placeholder="Buscar zona, barrio, calle..."
                value={filters.location ?? ''}
                onChange={(val) => handleChange({ location: val || null })}
              />
            </FilterGroupToggle>

            {/* ━━━ DETALLES AVANZADOS ━━━ */}
            <FilterGroupToggle
              id="detalles"
              label="Detalles"
              isExpanded={expandedGroups.has('detalles')}
              onToggle={toggleGroup}
            >
              <div className="space-y-3">
                <FilterSelect
                  label="Piso/Planta"
                  value={filters.floor ?? ''}
                  onChange={(val) => handleChange({ floor: val || null })}
                  options={FLOOR_OPTIONS}
                />

                <FilterSelect
                  label="Vista"
                  value={filters.view ?? ''}
                  onChange={(val) => handleChange({ view: val || null })}
                  options={VIEW_OPTIONS}
                />

                <FilterSelect
                  label="Orientación"
                  value={filters.orientation ?? ''}
                  onChange={(val) => handleChange({ orientation: val || null })}
                  options={ORIENTATION_OPTIONS}
                />

                {/* Furnished toggle */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Muebles</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        handleChange({ furnished: filters.furnished === true ? null : true })
                      }
                      className={`flex-1 px-2 py-1.5 text-xs rounded-lg border transition-all ${
                        filters.furnished === true
                          ? 'bg-blue-950/60 border-blue-800/40 text-blue-400'
                          : 'bg-[var(--c-surface)] border-[var(--c-border-card)] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Sí
                    </button>
                    <button
                      onClick={() =>
                        handleChange({ furnished: filters.furnished === false ? null : false })
                      }
                      className={`flex-1 px-2 py-1.5 text-xs rounded-lg border transition-all ${
                        filters.furnished === false
                          ? 'bg-blue-950/60 border-blue-800/40 text-blue-400'
                          : 'bg-[var(--c-surface)] border-[var(--c-border-card)] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                {/* Energy Rating */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Eficiencia Energética</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ENERGY_RATINGS.map((rating) => (
                      <button
                        key={rating}
                        onClick={() =>
                          handleChange({
                            energyRating: filters.energyRating === rating ? null : rating,
                          })
                        }
                        className={`py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                          filters.energyRating === rating
                            ? 'bg-blue-950/60 border-blue-800/40 text-blue-400'
                            : 'bg-[var(--c-surface)] border-[var(--c-border-card)] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {rating}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Characteristics */}
                <FilterCheckboxGroup
                  name="characteristics"
                  values={filters.characteristics}
                  onChange={(values) => handleChange({ characteristics: values })}
                  options={CHARACTERISTICS}
                  columns={2}
                />
              </div>
            </FilterGroupToggle>

            {/* ━━━ AVANZADO ━━━ */}
            <FilterGroupToggle
              id="avanzado"
              label="Avanzado"
              isExpanded={expandedGroups.has('avanzado')}
              onToggle={toggleGroup}
            >
              <div className="space-y-3">
                <FilterRangeSlider
                  label="Año de construcción"
                  min={1900}
                  max={new Date().getFullYear()}
                  step={1}
                  values={[filters.yearBuilt.min ?? 1900, filters.yearBuilt.max ?? new Date().getFullYear()]}
                  onChange={(min, max) =>
                    handleChange({ yearBuilt: { min, max } })
                  }
                  showInputs
                  format={(val) => `${val}`}
                />

                <FilterRangeSlider
                  label="Tamaño de parcela (m²)"
                  min={0}
                  max={10000}
                  step={100}
                  values={[filters.parcelSize.min ?? 0, filters.parcelSize.max ?? 10000]}
                  onChange={(min, max) =>
                    handleChange({ parcelSize: { min, max } })
                  }
                  showInputs
                  unit="m²"
                  format={(val) => `${val}`}
                />

                <FilterRangeSlider
                  label="Días en el mercado"
                  min={0}
                  max={365}
                  step={1}
                  values={[filters.daysOnMarket.min ?? 0, filters.daysOnMarket.max ?? 365]}
                  onChange={(min, max) =>
                    handleChange({ daysOnMarket: { min, max } })
                  }
                  showInputs
                  format={(val) => `${val}d`}
                />
              </div>
            </FilterGroupToggle>

          </div>
        </div>

        {/* Footer - Sticky */}
        <div className="flex-none flex gap-2 px-4 py-3 border-t border-[var(--c-border-card)] bg-[var(--c-surface)]">
          <button
            onClick={onClear}
            className="flex-1 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--c-border-card)] text-slate-400 hover:text-slate-200 hover:bg-[var(--c-surface)]/50 transition-all"
            aria-label="Limpiar todos los filtros"
          >
            <RotateCcw size={12} className="inline mr-1" />
            Limpiar
          </button>
          <button
            onClick={onApply}
            className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-all"
            aria-label={`Aplicar ${activeCount} filtro${activeCount !== 1 ? 's' : ''}`}
          >
            Aplicar{activeCount > 0 && ` (${activeCount})`}
          </button>
        </div>
      </div>
    </>
  )
}
