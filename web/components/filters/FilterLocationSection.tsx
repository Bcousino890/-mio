'use client'

import { ChevronDown, Loader2, X } from 'lucide-react'
import { useLocationOptions } from '@/hooks/useLocationOptions'
import FilterSelect from './FilterSelect'

interface FilterLocationSectionProps {
  districtId: string | null
  zoneId: string | null
  subzoneId: string | null
  onDistrictChange: (id: string | null) => void
  onZoneChange: (id: string | null) => void
  onSubzoneChange: (id: string | null) => void
}

/**
 * Componente de filtro de ubicación en cascada: Distrito → Zona → Subzona
 * Implementa la estructura normalizada de migración 0019
 */
export default function FilterLocationSection({
  districtId,
  zoneId,
  subzoneId,
  onDistrictChange,
  onZoneChange,
  onSubzoneChange,
}: FilterLocationSectionProps) {
  const { options, searchLocations } = useLocationOptions(districtId, zoneId)

  const districtName = options.districts.find((d) => d.id === districtId)?.name || 'Seleccionar'
  const zoneName = options.zones.find((z) => z.id === zoneId)?.name || 'Seleccionar'
  const subzoneName = options.subzones.find((s) => s.id === subzoneId)?.name || 'Seleccionar'

  const handleClearAll = () => {
    onDistrictChange(null)
    onZoneChange(null)
    onSubzoneChange(null)
  }

  const handleDistrictChange = (newDistrictId: string | null) => {
    onDistrictChange(newDistrictId)
    // Limpiar zona y subzona al cambiar distrito
    if (newDistrictId !== districtId) {
      onZoneChange(null)
      onSubzoneChange(null)
    }
  }

  const handleZoneChange = (newZoneId: string | null) => {
    onZoneChange(newZoneId)
    // Limpiar subzona al cambiar zona
    if (newZoneId !== zoneId) {
      onSubzoneChange(null)
    }
  }

  const isActive = districtId !== null || zoneId !== null || subzoneId !== null

  return (
    <div className="space-y-4">
      {/* Paso 1: Seleccionar Distrito */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Distrito
          {options.loading.districts && (
            <span className="ml-2 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
            </span>
          )}
        </label>

        {options.error.districts && (
          <div className="text-xs text-red-400/70 px-2 py-1 bg-red-500/10 rounded">
            {options.error.districts}
          </div>
        )}

        <select
          value={districtId || ''}
          onChange={(e) => handleDistrictChange(e.target.value || null)}
          disabled={options.loading.districts}
          className="w-full px-3 py-2 text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">Todos los distritos</option>
          {options.districts.map((district) => (
            <option key={district.id} value={district.id}>
              {district.name}
            </option>
          ))}
        </select>
      </div>

      {/* Paso 2: Seleccionar Zona (solo si hay distrito seleccionado) */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Zona
          {options.loading.zones && (
            <span className="ml-2 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
            </span>
          )}
        </label>

        {options.error.zones && (
          <div className="text-xs text-red-400/70 px-2 py-1 bg-red-500/10 rounded">
            {options.error.zones}
          </div>
        )}

        <select
          value={zoneId || ''}
          onChange={(e) => handleZoneChange(e.target.value || null)}
          disabled={!districtId || options.loading.zones}
          className="w-full px-3 py-2 text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">
            {!districtId ? 'Selecciona un distrito primero' : 'Todas las zonas'}
          </option>
          {options.zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
      </div>

      {/* Paso 3: Seleccionar Subzona (solo si hay zona seleccionada) */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Subzona
          {options.loading.subzones && (
            <span className="ml-2 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
            </span>
          )}
        </label>

        {options.error.subzones && (
          <div className="text-xs text-red-400/70 px-2 py-1 bg-red-500/10 rounded">
            {options.error.subzones}
          </div>
        )}

        <select
          value={subzoneId || ''}
          onChange={(e) => onSubzoneChange(e.target.value || null)}
          disabled={!zoneId || options.loading.subzones}
          className="w-full px-3 py-2 text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">
            {!zoneId ? 'Selecciona una zona primero' : 'Todas las subzonas'}
          </option>
          {options.subzones.map((subzone) => (
            <option key={subzone.id} value={subzone.id}>
              {subzone.name}
            </option>
          ))}
        </select>
      </div>

      {/* Botón para limpiar todos los campos de ubicación */}
      {isActive && (
        <button
          onClick={handleClearAll}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-300 bg-slate-700/20 hover:bg-slate-700/40 rounded-lg transition-colors"
        >
          <X size={13} />
          Limpiar ubicación
        </button>
      )}

      {/* TODO: Integración con búsqueda textual */}
      {/* Cuando la migración 0019 esté en producción, integrar searchLocations
          para permitir búsqueda por "Salamanca" que auto-rellene los 3 campos */}
    </div>
  )
}
