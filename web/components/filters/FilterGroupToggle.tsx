'use client'

import { ChevronDown } from 'lucide-react'
import { ReactNode } from 'react'

interface FilterGroupToggleProps {
  id: string
  label: string
  isExpanded: boolean
  onToggle: (id: string) => void
  children: ReactNode
}

export default function FilterGroupToggle({
  id,
  label,
  isExpanded,
  onToggle,
  children,
}: FilterGroupToggleProps) {
  return (
    <div className="border-b border-[var(--c-border-card)] last:border-b-0">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between py-2.5 px-0 text-left transition-colors hover:text-slate-100"
        aria-expanded={isExpanded}
        aria-controls={`filter-${id}`}
      >
        <span className="text-xs font-semibold text-slate-300">━ {label}</span>
        <ChevronDown
          size={14}
          className={`text-slate-600 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isExpanded && (
        <div
          id={`filter-${id}`}
          className="pb-2.5 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {children}
        </div>
      )}
    </div>
  )
}
