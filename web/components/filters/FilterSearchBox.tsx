'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'

interface LocationSuggestion {
  name: string
  type: 'neighborhood' | 'street' | 'city' | 'district'
}

// Mock suggestions - en producción integrar con Nominatim/Google Places
const MOCK_SUGGESTIONS: LocationSuggestion[] = [
  { name: 'Centro', type: 'neighborhood' },
  { name: 'Salamanca', type: 'neighborhood' },
  { name: 'Chamberí', type: 'neighborhood' },
  { name: 'Malasaña', type: 'neighborhood' },
  { name: 'Chueca', type: 'neighborhood' },
  { name: 'Plaza Mayor', type: 'street' },
  { name: 'Gran Vía', type: 'street' },
  { name: 'Paseo del Prado', type: 'street' },
]

interface FilterSearchBoxProps {
  placeholder?: string
  value: string
  onChange: (value: string) => void
}

export default function FilterSearchBox({
  placeholder = 'Buscar ubicación...',
  value,
  onChange,
}: FilterSearchBoxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [filteredSuggestions, setFilteredSuggestions] = useState<LocationSuggestion[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (value.trim()) {
      const filtered = MOCK_SUGGESTIONS.filter((s) =>
        s.name.toLowerCase().includes(value.toLowerCase())
      )
      setFilteredSuggestions(filtered)
      setIsOpen(true)
    } else {
      setFilteredSuggestions(MOCK_SUGGESTIONS)
      setIsOpen(false)
    }
  }, [value])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full pl-8 pr-8 py-2 text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/20 transition-all"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
            aria-label="Limpiar búsqueda"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Suggestions dropdown */}
      {isOpen && filteredSuggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg shadow-lg shadow-black/30 z-50 overflow-hidden">
          <ul className="max-h-48 overflow-y-auto">
            {filteredSuggestions.map((suggestion, idx) => (
              <li key={idx}>
                <button
                  onClick={() => {
                    onChange(suggestion.name)
                    setIsOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-[var(--c-surface)] hover:text-slate-200 transition-colors border-b border-[var(--c-border-card)] last:border-b-0"
                >
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-600" />
                    {suggestion.name}
                    <span className="text-[10px] text-slate-600 ml-auto">
                      {suggestion.type === 'neighborhood' && 'Barrio'}
                      {suggestion.type === 'street' && 'Calle'}
                      {suggestion.type === 'city' && 'Ciudad'}
                      {suggestion.type === 'district' && 'Distrito'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
