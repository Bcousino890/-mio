'use client'

interface Option {
  id: string
  label: string
}

interface FilterSelectProps {
  label?: string
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
}

export default function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Seleccionar',
}: FilterSelectProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="text-xs font-medium text-slate-400 block">
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg text-slate-300 placeholder:text-slate-700 hover:border-[var(--c-border)] focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/20 transition-all cursor-pointer"
      >
        <option value="">{placeholder}</option>
        {options
          .filter((opt) => opt.id !== '')
          .map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
      </select>
    </div>
  )
}
