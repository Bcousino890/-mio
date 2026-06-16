'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { PriceEvent } from '@/lib/mock-listings'

interface Props {
  data: PriceEvent[]
  operation: 'sale' | 'rent'
}

function fmt(n: number) { return n.toLocaleString('es-ES') }

function shortDate(d: string) {
  const dt = new Date(d)
  return dt.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as PriceEvent
  const eventLabels: Record<string, { label: string; color: string }> = {
    listed:         { label: 'Publicado',       color: '#60a5fa' },
    price_drop:     { label: 'Bajada de precio',color: '#34d399' },
    price_increase: { label: 'Subida de precio',color: '#f87171' },
    relisted:       { label: 'Republicado',     color: '#a78bfa' },
    withdrawn:      { label: 'Retirado',        color: '#94a3b8' },
  }
  const ev = eventLabels[point.event] ?? { label: point.event, color: '#94a3b8' }
  return (
    <div className="bg-[#0d1117] border border-[#1e2130] rounded-xl px-3.5 py-2.5 shadow-xl text-xs">
      <p className="text-slate-500 mb-1">{new Date(point.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <p className="text-white font-bold text-sm">{fmt(point.price)} €</p>
      <p className="mt-1" style={{ color: ev.color }}>{ev.label}</p>
    </div>
  )
}

export default function PriceChart({ data, operation }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-700 text-sm">
        Sin datos de historial
      </div>
    )
  }

  const suffix = operation === 'rent' ? ' €/mes' : ' €'
  const minPrice = Math.min(...data.map((d) => d.price))
  const maxPrice = Math.max(...data.map((d) => d.price))
  const padding = (maxPrice - minPrice) * 0.15 || maxPrice * 0.1

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fill: '#475569', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[minPrice - padding, maxPrice + padding]}
          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
          tick={{ fill: '#475569', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }} />
        {data.length > 1 && (
          <ReferenceLine
            y={data[0].price}
            stroke="#475569"
            strokeDasharray="3 3"
            label={{ value: 'Precio inicial', position: 'insideTopLeft', fill: '#475569', fontSize: 10 }}
          />
        )}
        <Area
          type="monotone"
          dataKey="price"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#priceGrad)"
          dot={{ fill: '#3b82f6', strokeWidth: 2, stroke: '#0d1117', r: 4 }}
          activeDot={{ r: 5, fill: '#60a5fa', stroke: '#0d1117', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

