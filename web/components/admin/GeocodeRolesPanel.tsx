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
  const [selectedCodes, setSelectedCodes] = useState<string[]>([COMUNAS[0].siiCode])
  const [jobs, setJobs] = useState<Map<string, JobState>>(new Map())
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  async function pollStatus() {
    try {
      const statuses = await Promise.all(
        selectedCodes.map(code =>
          fetch(`/api/admin/geocode-roles/status?sii_comuna_code=${code}`)
            .then(r => r.json())
            .then(d => d.success ? { code, job: d.job } : null)
        )
      )
      const newJobs = new Map(jobs)
      statuses.forEach(s => {
        if (s) newJobs.set(s.code, s.job)
      })
      setJobs(newJobs)
      const anyRunning = Array.from(newJobs.values()).some(j => j.status === 'running')
      if (!anyRunning) stopPolling()
    } catch { /* ignorar */ }
  }

  useEffect(() => {
    if (selectedCodes.length === 0) {
      stopPolling()
      setJobs(new Map())
      return
    }
    stopPolling()
    pollStatus()
  }, [selectedCodes])

  async function handleStart() {
    if (selectedCodes.length === 0) return
    setStarting(true)
    try {
      const res = await fetch('/api/admin/geocode-roles/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sii_comuna_codes: selectedCodes }),
      })
      const data = await res.json()
      if (data.success) {
        const newJobs = new Map(jobs)
        data.jobs.forEach((j: JobState) => newJobs.set(j.siiComunaCode, j))
        setJobs(newJobs)
        stopPolling()
        pollRef.current = setInterval(pollStatus, 2000)
      }
    } catch { /* ignorar */ }
    setStarting(false)
  }

  const running = Array.from(jobs.values()).some(j => j.status === 'running')

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <MapPin size={14} className="text-blue-400" />
        <p className="text-sm font-semibold text-slate-200">Geocodificar roles SII (pines en el mapa)</p>
      </div>
      <p className="text-[11px] text-slate-500">
        Selecciona una o más comunas y lanza geocodificación en paralelo. Busca direcciones vía OpenStreetMap/Nominatim y guarda
        lat/lng en la BD. Corre en el servidor hasta procesar todos los roles, aunque cierres esta página.
      </p>

      <div className="space-y-2">
        <p className="text-[10px] font-medium text-slate-400 uppercase">Comunas</p>
        <div className="grid grid-cols-2 gap-2">
          {COMUNAS.map((c) => (
            <label key={c.siiCode} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer hover:text-slate-100">
              <input
                type="checkbox"
                checked={selectedCodes.includes(c.siiCode)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedCodes([...selectedCodes, c.siiCode])
                  } else {
                    setSelectedCodes(selectedCodes.filter(code => code !== c.siiCode))
                  }
                }}
                disabled={running}
                className="w-4 h-4 rounded border-[var(--c-border-strong)] bg-[var(--c-hover)] disabled:opacity-50 cursor-pointer"
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={handleStart}
        disabled={running || starting || selectedCodes.length === 0}
        className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg transition-colors"
      >
        {running || starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        {running ? 'Geocodificando…' : `Iniciar geocodificación (${selectedCodes.length})`}
      </button>

      {jobs.size > 0 && (
        <div className="space-y-3">
          {Array.from(jobs.values()).map((job) => {
            const pct = job.totalPending > 0 ? Math.min(100, Math.round((job.processed / job.totalPending) * 100)) : 0
            return (
              <div key={job.siiComunaCode} className="bg-slate-900/40 rounded-lg p-3 space-y-2 text-[11px]">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-slate-300">{job.comunaName ?? job.siiComunaCode}</span>
                  <span className="font-mono text-slate-400">
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
            )
          })}
        </div>
      )}
    </div>
  )
}
