'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin, Loader2, CheckCircle2, AlertCircle, Play } from 'lucide-react'

interface JobState {
  siiComunaCode: string
  comunaName: string | null
  status: 'idle' | 'running' | 'done' | 'error'
  totalPending: number
  processed: number
  geocoded: number
  noMatch: number
  startedAt: string | null
  updatedAt: string | null
  error: string | null
}

const COMUNAS = [
  { label: 'Vitacura', siiCode: '15160' },
  { label: 'Las Condes', siiCode: '15108' },
  { label: 'Lo Barnechea', siiCode: '15161' },
  { label: 'Colina', siiCode: '14201' },
]

function fmtNum(n: number) {
  return n.toLocaleString('es-CL')
}

export default function GeocodeRolesPanel() {
  const [siiCode, setSiiCode] = useState(COMUNAS[0].siiCode)
  const [job, setJob] = useState<JobState | null>(null)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  async function pollStatus(code: string) {
    try {
      const res = await fetch(`/api/admin/geocode-roles/status?sii_comuna_code=${code}`)
      const data = await res.json()
      if (data.success) {
        setJob(data.job)
        if (data.job.status !== 'running') stopPolling()
      }
    } catch { /* ignorar errores transitorios de polling */ }
  }

  useEffect(() => {
    stopPolling()
    pollStatus(siiCode)
    return stopPolling
  }, [siiCode])

  async function handleStart() {
    setStarting(true)
    try {
      const res = await fetch('/api/admin/geocode-roles/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sii_comuna_code: siiCode }),
      })
      const data = await res.json()
      if (data.success) {
        setJob(data.job)
        stopPolling()
        pollRef.current = setInterval(() => pollStatus(siiCode), 2000)
      }
    } catch { /* ignorar */ }
    setStarting(false)
  }

  const running = job?.status === 'running'
  const pct = job && job.totalPending > 0 ? Math.min(100, Math.round((job.processed / job.totalPending) * 100)) : 0

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <MapPin size={14} className="text-blue-400" />
        <p className="text-sm font-semibold text-slate-200">Geocodificar roles SII (pines en el mapa)</p>
      </div>
      <p className="text-[11px] text-slate-500">
        Busca la dirección de cada rol sin coordenadas vía OpenStreetMap/Nominatim (~1 req/s) y guarda
        lat/lng en la base de datos. Corre en el servidor de forma continua hasta procesar todos los
        roles pendientes de la comuna, aunque cierres esta página.
      </p>

      <div className="flex items-center gap-2">
        <select
          value={siiCode}
          onChange={(e) => setSiiCode(e.target.value)}
          disabled={running}
          className="bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-2 py-1.5 text-slate-200 disabled:opacity-50"
        >
          {COMUNAS.map((c) => (
            <option key={c.siiCode} value={c.siiCode}>{c.label}</option>
          ))}
        </select>
        <button
          onClick={handleStart}
          disabled={running || starting}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {running || starting ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {running ? 'Geocodificando…' : 'Iniciar geocodificación'}
        </button>
      </div>

      {job && job.status !== 'idle' && (
        <div className="bg-slate-900/40 rounded-lg p-3 space-y-2 text-[11px]">
          <div className="flex justify-between text-slate-400">
            <span>{job.comunaName ?? job.siiComunaCode}</span>
            <span className="font-mono">
              {fmtNum(job.processed)} / {fmtNum(job.totalPending)}
            </span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-300 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center gap-3 text-slate-500">
            <span className="text-emerald-400">{fmtNum(job.geocoded)} geocodificados</span>
            <span>{fmtNum(job.noMatch)} sin match</span>
          </div>
          {job.status === 'done' && (
            <div className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 size={11} /> Completado
            </div>
          )}
          {job.status === 'error' && (
            <div className="flex items-center gap-1.5 text-red-400">
              <AlertCircle size={11} /> {job.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
