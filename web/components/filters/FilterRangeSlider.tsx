'use client'

import { useState, useEffect, useRef } from 'react'

interface FilterRangeSliderProps {
  label: string
  min: number
  max: number
  step: number
  values: [number, number]
  onChange: (min: number, max: number) => void
  showInputs?: boolean
  unit?: string
  format?: (val: number) => string
}

export default function FilterRangeSlider({
  label,
  min,
  max,
  step,
  values: [minVal, maxVal],
  onChange,
  showInputs = true,
  unit = '',
  format = (val) => val.toString(),
}: FilterRangeSliderProps) {
  const [localMin, setLocalMin] = useState(minVal)
  const [localMax, setLocalMax] = useState(maxVal)
  const [minInputValue, setMinInputValue] = useState(minVal.toString())
  const [maxInputValue, setMaxInputValue] = useState(maxVal.toString())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLocalMin(minVal)
    setMinInputValue(minVal.toString())
  }, [minVal])

  useEffect(() => {
    setLocalMax(maxVal)
    setMaxInputValue(maxVal.toString())
  }, [maxVal])

  const handleSliderChange = (newMin: number, newMax: number) => {
    setLocalMin(newMin)
    setLocalMax(newMax)
    setMinInputValue(newMin.toString())
    setMaxInputValue(newMax.toString())

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange(newMin, newMax)
    }, 300)
  }

  const handleMinInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setMinInputValue(val)

    if (val === '') return

    const numVal = parseInt(val)
    if (numVal >= min && numVal <= localMax) {
      setLocalMin(numVal)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onChange(numVal, localMax)
      }, 300)
    }
  }

  const handleMaxInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setMaxInputValue(val)

    if (val === '') return

    const numVal = parseInt(val)
    if (numVal <= max && numVal >= localMin) {
      setLocalMax(numVal)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onChange(localMin, numVal)
      }, 300)
    }
  }

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>, isMin: boolean) => {
    const val = parseInt(e.target.value)
    if (isMin) {
      const newMin = Math.min(val, localMax)
      handleSliderChange(newMin, localMax)
    } else {
      const newMax = Math.max(val, localMin)
      handleSliderChange(localMin, newMax)
    }
  }

  const minPercent = ((localMin - min) / (max - min)) * 100
  const maxPercent = ((localMax - min) / (max - min)) * 100

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-slate-400 block">
        {label}
      </label>

      {/* Range Slider */}
      <div className="relative pt-4 pb-2">
        <div className="relative h-1 bg-[var(--c-surface)] rounded-full">
          {/* Track fill */}
          <div
            className="absolute h-1 bg-blue-600 rounded-full pointer-events-none"
            style={{
              left: `${minPercent}%`,
              right: `${100 - maxPercent}%`,
            }}
          />
        </div>

        {/* Min thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localMin}
          onChange={(e) => handleRangeChange(e, true)}
          className="absolute w-full h-1 top-4 pointer-events-none appearance-none bg-transparent cursor-pointer z-5 slider-thumb"
          style={{
            zIndex: localMin > max - (max - min) / 2 ? 5 : 3,
          }}
        />

        {/* Max thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localMax}
          onChange={(e) => handleRangeChange(e, false)}
          className="absolute w-full h-1 top-4 pointer-events-none appearance-none bg-transparent cursor-pointer z-4 slider-thumb"
        />
      </div>

      {/* Inputs (if showInputs) */}
      {showInputs && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={minInputValue}
            onChange={handleMinInputChange}
            placeholder="Mín"
            className="flex-1 px-2 py-1.5 text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/20"
          />
          <span className="text-slate-600 text-xs">—</span>
          <input
            type="number"
            value={maxInputValue}
            onChange={handleMaxInputChange}
            placeholder="Máx"
            className="flex-1 px-2 py-1.5 text-xs bg-[var(--c-surface)] border border-[var(--c-border-card)] rounded-lg text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/20"
          />
        </div>
      )}

      {/* Display values */}
      <div className="text-xs text-slate-500">
        {format(localMin)} {unit} — {format(localMax)} {unit}
      </div>

      {/* Styles for range slider */}
      <style>{`
        .slider-thumb {
          -webkit-appearance: none;
          appearance: none;
        }
        .slider-thumb::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #1e293b;
          box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
          transition: all 0.15s ease;
        }
        .slider-thumb::-webkit-slider-thumb:hover {
          transform: scale(1.15);
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.6);
        }
        .slider-thumb::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #1e293b;
          box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
          transition: all 0.15s ease;
        }
        .slider-thumb::-moz-range-thumb:hover {
          transform: scale(1.15);
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.6);
        }
      `}</style>
    </div>
  )
}
