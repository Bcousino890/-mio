'use client'

interface Option {
  id: string
  label: string
}

interface FilterCheckboxGroupProps {
  name: string
  values: string[]
  onChange: (values: string[]) => void
  options: Option[]
  columns?: 1 | 2 | 3
}

export default function FilterCheckboxGroup({
  name,
  values,
  onChange,
  options,
  columns = 1,
}: FilterCheckboxGroupProps) {
  const handleChange = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...values, id])
    } else {
      onChange(values.filter((v) => v !== id))
    }
  }

  const gridColsClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
  }

  return (
    <fieldset>
      <legend className="sr-only">{name}</legend>
      <div className={`grid ${gridColsClass[columns]} gap-2`}>
        {options.map((option) => (
          <label
            key={option.id}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={values.includes(option.id)}
              onChange={(e) => handleChange(option.id, e.target.checked)}
              className="w-4 h-4 rounded border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
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
