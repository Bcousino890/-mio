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

interface ErrorRow {
  rol: string
  comuna: string
  error: string | null
  intentos: number
  fecha_consulta: string
  revisado: boolean
  revisado_at: string | null
  revisado_nota: string | null
}

interface SinNombreRow {
  rol: string
  comuna: string
  estado: string
  fecha_consulta: string
  revisado: boolean
  revisado_at: string | null
  revisado_nota: string | null
}

interface ScraperStatus {
  corriendo: boolean
  ultima_consulta: string | null
  segundos_desde_ultima: number | null
  procesados_ultimos_5min: number
}

interface Stats {
  scraper_status: ScraperStatus
  globales: {
    total: number
    esperados: number
    progreso_pct: number
    con_deuda: number
    sin_deuda: number
    errores: number
    con_nombre: number
    sin_nombre: number
    personas: number
    empresas: number
    monto_total_deuda: number
  }
  por_comuna: ComunaRow[]
  ultimos: UltimoRow[]
  errores_detalle: ErrorRow[]
  sin_nombre_detalle: SinNombreRow[]
}

function formatoCLP(n: number | null) {
  if (!n) return '—'
  return 'CLP ' + Math.round(n).toLocaleString('es-CL')
}

function formatoTiempo(segundos: number | null) {
  if (segundos === null) return 'sin datos'
  if (segundos < 60) return `hace ${Math.round(segundos)}s`
  if (segundos < 3600) return `hace ${Math.round(segundos / 60)} min`
  return `hace ${Math.round(segundos / 3600)} h`
}

function Card({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color ?? ''}`}>{value}</div>
    </div>
  )
}

export default function TgrDuenoStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocultarRevisados, setOcultarRevisados] = useState(false)
  const [marcando, setMarcando] = useState<string | null>(null)

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

  const marcarRevisado = async (rol: string, revisado: boolean) => {
    setMarcando(rol)
    try {
      await fetch('/api/chile/tgr-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rol, revisado }),
      })
      setStats(prev => {
        if (!prev) return prev
        const ahora = new Date().toISOString()
        return {
          ...prev,
          errores_detalle: prev.errores_detalle.map(e => e.rol === rol ? { ...e, revisado, revisado_at: revisado ? ahora : null } : e),
          sin_nombre_detalle: prev.sin_nombre_detalle.map(e => e.rol === rol ? { ...e, revisado, revisado_at: revisado ? ahora : null } : e),
        }
      })
    } finally {
      setMarcando(null)
    }
  }

  if (error) {
    return <div className="text-sm text-red-400">No se pudo cargar el estado del scraper: {error}</div>
  }

  if (!stats) {
    return <div className="text-sm text-slate-500">Cargando...</div>
  }

  const { scraper_status, globales, por_comuna, ultimos, errores_detalle, sin_nombre_detalle } = stats
  const erroresVisibles = ocultarRevisados ? errores_detalle.filter(e => !e.revisado) : errores_detalle
  const sinNombreVisibles = ocultarRevisados ? sin_nombre_detalle.filter(e => !e.revisado) : sin_nombre_detalle

  return (
    <div className="space-y-6">
      {/* Estado del scraper */}
      <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${scraper_status.corriendo ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm font-medium">
            {scraper_status.corriendo ? 'Scraper corriendo' : 'Scraper detenido / inactivo'}
          </span>
          <span className="text-xs text-slate-500">
            última escritura {formatoTiempo(scraper_status.segundos_desde_ultima)}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {scraper_status.procesados_ultimos_5min} procesados en los últimos 5 min
        </div>
      </div>

      {/* Progreso global */}
      <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Progreso Región Metropolitana</h3>
          <span className="text-xs text-slate-500">{globales.total.toLocaleString('es-CL')} / {globales.esperados.toLocaleString('es-CL')} roles ({globales.progreso_pct}%)</span>
        </div>
        <div className="w-full h-2 rounded-full bg-[var(--c-border-card)] overflow-hidden">
          <div className="h-full bg-blue-500" style={{ width: `${Math.min(globales.progreso_pct, 100)}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="Total procesados" value={globales.total.toLocaleString('es-CL')} />
        <Card label="Con deuda" value={globales.con_deuda.toLocaleString('es-CL')} color="text-red-400" />
        <Card label="Sin deuda" value={globales.sin_deuda.toLocaleString('es-CL')} />
        <Card label="Errores" value={globales.errores.toLocaleString('es-CL')} color="text-red-400" />
        <Card label="Monto detectado" value={formatoCLP(globales.monto_total_deuda)} color="text-blue-400" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Con nombre" value={globales.con_nombre.toLocaleString('es-CL')} />
        <Card label="Sin nombre" value={globales.sin_nombre.toLocaleString('es-CL')} />
        <Card label="Personas naturales" value={globales.personas.toLocaleString('es-CL')} />
        <Card label="Empresas" value={globales.empresas.toLocaleString('es-CL')} />
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

      {(errores_detalle.length > 0 || sin_nombre_detalle.length > 0) && (
        <div className="flex items-center justify-end gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={ocultarRevisados} onChange={e => setOcultarRevisados(e.target.checked)} />
            Ocultar ya revisados
          </label>
        </div>
      )}

      {errores_detalle.length > 0 && (
        <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-3">
            Roles con error ({errores_detalle.filter(e => !e.revisado).length} pendientes de {errores_detalle.length})
          </h3>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-[var(--c-border-card)]">
                  <th className="py-2 pr-4">Revisado</th>
                  <th className="py-2 pr-4">ROL</th>
                  <th className="py-2 pr-4">Comuna</th>
                  <th className="py-2 pr-4">Error</th>
                  <th className="py-2 pr-4">Intentos</th>
                </tr>
              </thead>
              <tbody>
                {erroresVisibles.map(e => (
                  <tr key={e.rol} className={`border-b border-[var(--c-border-card)] ${e.revisado ? 'opacity-50' : ''}`}>
                    <td className="py-2 pr-4">
                      <input
                        type="checkbox"
                        checked={e.revisado}
                        disabled={marcando === e.rol}
                        onChange={ev => marcarRevisado(e.rol, ev.target.checked)}
                      />
                    </td>
                    <td className="py-2 pr-4">{e.rol}</td>
                    <td className="py-2 pr-4">{e.comuna}</td>
                    <td className="py-2 pr-4 text-red-400">{e.error || '—'}</td>
                    <td className="py-2 pr-4">{e.intentos}</td>
                  </tr>
                ))}
                {erroresVisibles.length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-slate-500">Todos los errores fueron revisados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sin_nombre_detalle.length > 0 && (
        <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-3">
            Roles sin nombre de contribuyente ({sin_nombre_detalle.filter(e => !e.revisado).length} pendientes de {sin_nombre_detalle.length})
          </h3>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-[var(--c-border-card)]">
                  <th className="py-2 pr-4">Revisado</th>
                  <th className="py-2 pr-4">ROL</th>
                  <th className="py-2 pr-4">Comuna</th>
                  <th className="py-2 pr-4">Estado</th>
                </tr>
              </thead>
              <tbody>
                {sinNombreVisibles.map(e => (
                  <tr key={e.rol} className={`border-b border-[var(--c-border-card)] ${e.revisado ? 'opacity-50' : ''}`}>
                    <td className="py-2 pr-4">
                      <input
                        type="checkbox"
                        checked={e.revisado}
                        disabled={marcando === e.rol}
                        onChange={ev => marcarRevisado(e.rol, ev.target.checked)}
                      />
                    </td>
                    <td className="py-2 pr-4">{e.rol}</td>
                    <td className="py-2 pr-4">{e.comuna}</td>
                    <td className="py-2 pr-4">{e.estado}</td>
                  </tr>
                ))}
                {sinNombreVisibles.length === 0 && (
                  <tr><td colSpan={4} className="py-3 text-slate-500">Todos los casos sin nombre fueron revisados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
