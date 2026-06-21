'use client'

interface ConstructionLine {
  destino_code?: string | null
  superficie_m2?: number | string | null
}

interface Props {
  terrenoM2: number | null
  construcciones: ConstructionLine[]
  destinoLabels: Record<string, string>
}

const SEGMENT_COLORS = ['#3b82f6', '#22d3ee', '#a78bfa', '#f59e0b', '#34d399', '#f87171', '#94a3b8']

export default function SurfaceDistributionBar({ terrenoM2, construcciones, destinoLabels }: Props) {
  const grouped = new Map<string, number>()
  construcciones.forEach((c) => {
    const key = c.destino_code ?? '—'
    const m2 = Number(c.superficie_m2) || 0
    grouped.set(key, (grouped.get(key) ?? 0) + m2)
  })
  const construidaTotal = Array.from(grouped.values()).reduce((sum, v) => sum + v, 0)

  if (!terrenoM2 && construidaTotal === 0) {
    return <p className="text-xs text-slate-700">Sin datos de superficie</p>
  }

  const segments = Array.from(grouped.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([code, m2], i) => ({
      code,
      label: destinoLabels[code] ?? code,
      m2,
      pct: construidaTotal > 0 ? (m2 / construidaTotal) * 100 : 0,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
    }))

  const maxTotal = Math.max(terrenoM2 ?? 0, construidaTotal, 1)

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-slate-500">Terreno</span>
          <span className="text-[11px] font-semibold text-slate-300">{terrenoM2 ? `${terrenoM2.toLocaleString('es-CL')} m²` : '—'}</span>
        </div>
        <div className="h-3 rounded-full bg-[var(--c-card)] overflow-hidden">
          <div className="h-full bg-slate-500" style={{ width: `${((terrenoM2 ?? 0) / maxTotal) * 100}%` }} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-slate-500">Construida</span>
          <span className="text-[11px] font-semibold text-slate-300">{construidaTotal ? `${construidaTotal.toLocaleString('es-CL')} m²` : '—'}</span>
        </div>
        <div className="h-3 rounded-full bg-[var(--c-card)] overflow-hidden flex">
          {segments.map((s) => (
            <div key={s.code} style={{ width: `${(s.m2 / maxTotal) * 100}%`, backgroundColor: s.color }} title={`${s.label}: ${s.m2} m²`} />
          ))}
        </div>
        {segments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {segments.map((s) => (
              <div key={s.code} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                {s.label} · {s.m2.toLocaleString('es-CL')} m² ({s.pct.toFixed(0)}%)
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
