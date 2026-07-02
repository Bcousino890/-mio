'use client'

import { useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle, BarChart3 } from 'lucide-react'

interface RefreshResult {
  view_name: string
  ok: boolean
  detail: string
}

export default function RefreshViewsPanel() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<RefreshResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setRunning(true)
    setError(null)
    setResults(null)
    try {
      const res = await fetch('/api/admin/refresh-views', { method: 'POST' })
      const data = await res.json()
      if (data.results) setResults(data.results)
      else setError(data.error ?? 'Error refrescando vistas')
    } catch {
      setError('Error de red')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BarChart3 size={15} className="text-blue-400" />
          <p className="text-sm font-semibold text-slate-200">Vistas de mercado</p>
        </div>
        <button
          onClick={refresh}
          disabled={running}
          className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
          {running ? 'Refrescando…' : 'Refrescar vistas de mercado'}
        </button>
      </div>
      <p className="text-xs text-slate-600 mb-3">
        Recalcula mv_market_area, mv_broken_exclusives y mv_opportunidades (páginas Mercado y Oportunidades).
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {results && (
        <div className="space-y-1">
          {results.map((r) => (
            <p key={r.view_name} className="text-xs flex items-center gap-1.5">
              {r.ok ? <CheckCircle2 size={11} className="text-emerald-400" /> : <XCircle size={11} className="text-red-400" />}
              <span className="font-mono text-slate-300">{r.view_name}</span>
              <span className="text-slate-600">{r.detail}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
