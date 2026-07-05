'use client'

import { useEffect, useState } from 'react'

interface ComunaRow {
  sii_comuna_code: string
  comuna: string
  total: number
  con_coords: number
  avaluo_total_sum: number
}

interface UltimoRow {
  rol: string
  sii_comuna_code: string
  comuna: string
  direccion: string | null
  avaluo_total: number | null
  lat: number | null
  lng: number | null
  area_homogenea: string | null
  superficie_banda: string | null
  created_at: string
}

interface IngestaStatus {
  activo: boolean
  ultima_ingesta: string | null
  segundos_desde_ultima: number | null
  ingestados_ultimos_5min: number
}

interface Stats {
  ingesta_status: IngestaStatus
  globales: {
    total: number
    comunas: number
    con_avaluo: number
    con_coords: number
    con_direccion: number
    avaluo_total_sum: number
  }
  por_comuna: ComunaRow[]
  ultimos: UltimoRow[]
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

export default function SiiMapasuiStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/chile/sii-mapasui-stats')
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
    return <div className="text-sm text-red-400">No se pudo cargar el estado de la ingesta: {error}</div>
  }

  if (!stats) {
    return <div className="text-sm text-slate-500">Cargando...</div>
  }

  const { ingesta_status, globales, por_comuna, ultimos } = stats

  return (
    <div className="space-y-6">
      {/* Aviso de procedencia */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500/90">
        ⚠ Datos de procedencia <strong>scraping de mapasui</strong> (no del archivo oficial descargado). Tabla
        separada de <code>sii_roles_cl</code>; tratar como señal interna, no redistribuir ni comercializar.
      </div>

      {/* Estado de la ingesta */}
      <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${ingesta_status.activo ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
          <span className="text-sm font-medium">
            {ingesta_status.activo ? 'Ingesta reciente (lote llegando)' : 'Sin ingesta reciente'}
          </span>
          <span className="text-xs text-slate-500">
            última ingesta {formatoTiempo(ingesta_status.segundos_desde_ultima)}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {ingesta_status.ingestados_ultimos_5min.toLocaleString('es-CL')} ingestados en los últimos 5 min
        </div>
      </div>

      {/* Cards globales */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="Total predios" value={globales.total.toLocaleString('es-CL')} color="text-blue-400" />
        <Card label="Comunas" value={globales.comunas.toLocaleString('es-CL')} />
        <Card label="Con coordenadas" value={globales.con_coords.toLocaleString('es-CL')} />
        <Card label="Con dirección" value={globales.con_direccion.toLocaleString('es-CL')} />
        <Card label="Avalúo acumulado" value={formatoCLP(globales.avaluo_total_sum)} color="text-emerald-400" />
      </div>

      {/* Por comuna */}
      <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
        <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-3">Por comuna</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-[var(--c-border-card)]">
                <th className="py-2 pr-4">Comuna</th>
                <th className="py-2 pr-4">Código SII</th>
                <th className="py-2 pr-4">Predios</th>
                <th className="py-2 pr-4">Con coords.</th>
                <th className="py-2 pr-4">Avalúo acumulado</th>
              </tr>
            </thead>
            <tbody>
              {por_comuna.map((c) => (
                <tr key={c.sii_comuna_code} className="border-b border-[var(--c-border-card)]">
                  <td className="py-2 pr-4">{c.comuna}</td>
                  <td className="py-2 pr-4 text-slate-500">{c.sii_comuna_code}</td>
                  <td className="py-2 pr-4">{c.total.toLocaleString('es-CL')}</td>
                  <td className="py-2 pr-4">{c.con_coords.toLocaleString('es-CL')}</td>
                  <td className="py-2 pr-4">{formatoCLP(c.avaluo_total_sum)}</td>
                </tr>
              ))}
              {por_comuna.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-slate-500">Aún no hay predios ingestados — el scraper todavía está descubriendo/extrayendo, o el primer lote no ha llegado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Últimos ingestados */}
      <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
        <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-3">Últimos ingestados</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-[var(--c-border-card)]">
                <th className="py-2 pr-4">ROL</th>
                <th className="py-2 pr-4">Comuna</th>
                <th className="py-2 pr-4">Dirección</th>
                <th className="py-2 pr-4">Avalúo</th>
                <th className="py-2 pr-4">Área hom.</th>
              </tr>
            </thead>
            <tbody>
              {ultimos.map((r) => (
                <tr key={`${r.sii_comuna_code}-${r.rol}`} className="border-b border-[var(--c-border-card)]">
                  <td className="py-2 pr-4">{r.rol}</td>
                  <td className="py-2 pr-4">{r.comuna}</td>
                  <td className="py-2 pr-4 text-slate-400">{r.direccion || '—'}</td>
                  <td className="py-2 pr-4">{formatoCLP(r.avaluo_total)}</td>
                  <td className="py-2 pr-4 text-slate-500">{r.area_homogenea || '—'}</td>
                </tr>
              ))}
              {ultimos.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-slate-500">Sin predios todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
