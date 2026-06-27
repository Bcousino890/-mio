'use client'

import { useEffect, useState } from 'react'

interface ComunaRow {
  comuna: string
  total: number
  con_deuda: number
  errores: number
}

interface UltimoRow {
  rol: string
  comuna: string
  nombre: string | null
  tiene_deuda: boolean
  total_deuda_no_vencida: number | null
  estado: string
  fecha_consulta: string
}

interface Stats {
  globales: { total: number; con_deuda: number; sin_deuda: number; errores: number; monto_total_deuda: number }
  por_comuna: ComunaRow[]
  ultimos: UltimoRow[]
}

function formatoCLP(n: number | null) {
  if (!n) return '—'
  return 'CLP ' + Math.round(n).toLocaleString('es-CL')
}

export default function TgrDuenoStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/chile/tgr-stats')
        const data = await res.json()
        if (cancelled) return
        if (data.success) {
          setStats(data)
          setError(null)
        } else {
          setError(data.error ?? 'Error desconocido')
        }
      } catch {
        if (!cancelled) setError('Error de conexión')
      }
    }
    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (error) {
    return <div className="text-sm text-red-400">No se pudo cargar el estado del scraper: {error}</div>
  }

  if (!stats) {
    return <div className="text-sm text-slate-500">Cargando...</div>
  }

  const { globales, por_comuna, ultimos } = stats

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Total procesados</div>
          <div className="text-2xl font-semibold mt-1">{globales.total.toLocaleString('es-CL')}</div>
        </div>
        <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Con deuda</div>
          <div className="text-2xl font-semibold mt-1 text-red-400">{globales.con_deuda.toLocaleString('es-CL')}</div>
        </div>
        <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Sin deuda</div>
          <div className="text-2xl font-semibold mt-1">{globales.sin_deuda.toLocaleString('es-CL')}</div>
        </div>
        <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Errores</div>
          <div className="text-2xl font-semibold mt-1 text-red-400">{globales.errores.toLocaleString('es-CL')}</div>
        </div>
        <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Monto detectado</div>
          <div className="text-2xl font-semibold mt-1 text-blue-400">{formatoCLP(globales.monto_total_deuda)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
        <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-3">Por comuna</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-[var(--c-border-card)]">
                <th className="py-2 pr-4">Comuna</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4">Con deuda</th>
                <th className="py-2 pr-4">Errores</th>
              </tr>
            </thead>
            <tbody>
              {por_comuna.map(c => (
                <tr key={c.comuna} className="border-b border-[var(--c-border-card)]">
                  <td className="py-2 pr-4">{c.comuna}</td>
                  <td className="py-2 pr-4">{c.total.toLocaleString('es-CL')}</td>
                  <td className="py-2 pr-4">{c.con_deuda.toLocaleString('es-CL')}</td>
                  <td className="py-2 pr-4">{c.errores || '—'}</td>
                </tr>
              ))}
              {por_comuna.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-slate-500">Aún no hay datos — el scraper todavía no ha sido lanzado o está iniciando.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
        <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-3">Últimos procesados</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-[var(--c-border-card)]">
                <th className="py-2 pr-4">ROL</th>
                <th className="py-2 pr-4">Comuna</th>
                <th className="py-2 pr-4">Nombre</th>
                <th className="py-2 pr-4">Deuda</th>
                <th className="py-2 pr-4">Monto</th>
                <th className="py-2 pr-4">Estado</th>
              </tr>
            </thead>
            <tbody>
              {ultimos.map(r => (
                <tr key={r.rol} className="border-b border-[var(--c-border-card)]">
                  <td className="py-2 pr-4">{r.rol}</td>
                  <td className="py-2 pr-4">{r.comuna}</td>
                  <td className="py-2 pr-4">{r.nombre || '—'}</td>
                  <td className="py-2 pr-4">{r.tiene_deuda ? 'Sí' : 'No'}</td>
                  <td className="py-2 pr-4">{formatoCLP(r.total_deuda_no_vencida)}</td>
                  <td className="py-2 pr-4">{r.estado}</td>
                </tr>
              ))}
              {ultimos.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-slate-500">Sin resultados todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
