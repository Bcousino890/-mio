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

type NivelIngesta = 'ingestando' | 'al_dia' | 'estancado' | 'sin_datos'

interface IngestaStatus {
  activo: boolean
  nivel?: NivelIngesta
  ultima_ingesta: string | null
  segundos_desde_ultima: number | null
  nuevos_ultimos_15min: number
  pendiente_bytes?: number
}

// Estado por archivo JSONL del VPS (sii_mapasui_ingest_state_cl, migración
// 0090). Es lo que responde "¿qué falta?": cuánto del output en disco ya está
// en la BD y si el último barrido quedó a medias.
interface ArchivoRow {
  archivo: string
  lineas: number
  predios: number
  lineas_invalidas: number
  byte_offset: number
  file_size: number
  pendiente_bytes: number
  ultima_corrida: string | null
  ultimo_avance: string | null
}

// Presentación de cada nivel del latido. `al_dia` (scrape en reposo, cron
// horario al día) es un estado SANO y se pinta en calma, no como alarma.
const NIVEL_UI: Record<NivelIngesta, { dot: string; pulse: boolean; label: string }> = {
  ingestando: { dot: 'bg-green-400', pulse: true, label: 'Ingesta activa (lote reciente)' },
  al_dia: { dot: 'bg-emerald-500', pulse: false, label: 'Al día (scrape en reposo · datos completos)' },
  estancado: { dot: 'bg-amber-500', pulse: false, label: 'Sin ingesta reciente' },
  sin_datos: { dot: 'bg-slate-500', pulse: false, label: 'Sin datos todavía' },
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
  archivos?: ArchivoRow[]
}

function formatoBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatoFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
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
  const archivos = stats.archivos ?? []
  const pendienteTotal = ingesta_status.pendiente_bytes ?? 0

  return (
    <div className="space-y-6">
      {/* Aviso de procedencia */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500/90">
        ⚠ Datos de procedencia <strong>scraping de mapasui</strong> (no del archivo oficial descargado). Tabla
        separada de <code>sii_roles_cl</code>; tratar como señal interna, no redistribuir ni comercializar.
      </div>

      {/* Estado de la ingesta */}
      {(() => {
        // Compat: si la API aún no envía `nivel`, derivarlo de `activo`.
        const nivel: NivelIngesta =
          ingesta_status.nivel ?? (ingesta_status.activo ? 'ingestando' : 'estancado')
        const ui = NIVEL_UI[nivel]
        return (
          <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${ui.dot} ${ui.pulse ? 'animate-pulse' : ''}`} />
              <span className="text-sm font-medium">{ui.label}</span>
              <span className="text-xs text-slate-500">
                última ingesta {formatoTiempo(ingesta_status.segundos_desde_ultima)}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              {pendienteTotal > 0 && (
                <span className="text-amber-500 mr-3">
                  {formatoBytes(pendienteTotal)} del output en disco sin ingestar
                </span>
              )}
              {ingesta_status.nuevos_ultimos_15min.toLocaleString('es-CL')} predios nuevos en los últimos 15 min
            </div>
          </div>
        )
      })()}

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

      {/* Estado de la ingesta por archivo JSONL del VPS */}
      {archivos.length > 0 && (
        <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-3">
            Ingesta por archivo (output/predios del VPS)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-[var(--c-border-card)]">
                  <th className="py-2 pr-4">Archivo</th>
                  <th className="py-2 pr-4">Líneas leídas</th>
                  <th className="py-2 pr-4">Predios</th>
                  <th className="py-2 pr-4">Leído</th>
                  <th className="py-2 pr-4">Pendiente</th>
                  <th className="py-2 pr-4">Último avance</th>
                  <th className="py-2 pr-4">Última corrida</th>
                </tr>
              </thead>
              <tbody>
                {archivos.map((a) => (
                  <tr key={a.archivo} className="border-b border-[var(--c-border-card)]">
                    <td className="py-2 pr-4">{a.archivo}</td>
                    <td className="py-2 pr-4">{a.lineas.toLocaleString('es-CL')}</td>
                    <td className="py-2 pr-4">{a.predios.toLocaleString('es-CL')}</td>
                    <td className="py-2 pr-4 text-slate-400">
                      {formatoBytes(a.byte_offset)}
                      {a.file_size > 0 && (
                        <span className="text-slate-500"> / {formatoBytes(a.file_size)}</span>
                      )}
                    </td>
                    <td className={`py-2 pr-4 ${a.pendiente_bytes > 0 ? 'text-amber-500' : 'text-slate-500'}`}>
                      {a.pendiente_bytes > 0 ? formatoBytes(a.pendiente_bytes) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{formatoFecha(a.ultimo_avance)}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatoFecha(a.ultima_corrida)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            La ingesta es incremental: cada corrida lee solo las líneas nuevas del JSONL desde su último
            checkpoint. &quot;Pendiente&quot; en cero significa que todo lo que hay en disco ya está en{' '}
            <code>sii_mapasui_predios_cl</code>.
          </p>
        </div>
      )}

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
