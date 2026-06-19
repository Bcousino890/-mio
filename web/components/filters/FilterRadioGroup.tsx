'use client'

interface Option {
  id: string
  label: string
}

interface FilterRadioGroupProps {
  name: string
  value: string
  onChange: (value: string) => void
  options: Option[]
}

export default function FilterRadioGroup({
  name,
  value,
  onChange,
  options,
}: FilterRadioGroupProps) {
  return (
    <fieldset>
      <legend className="sr-only">{name}</legend>
      <div className="space-y-1.5">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={(e) => onChange(e.target.value)}
              className="w-4 h-4 rounded-full border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
            />
            <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
