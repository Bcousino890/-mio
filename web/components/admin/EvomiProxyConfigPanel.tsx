'use client'

import { useState, useEffect } from 'react'
import { Globe, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type Status = 'idle' | 'saving' | 'success' | 'error'
type Current = { configured: boolean; host: string; port: string; user: string; hasPassword: boolean }

export default function EvomiProxyConfigPanel() {
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<Current | null>(null)

  useEffect(() => {
    fetch('/api/admin/evomi-proxy-config')
      .then((r) => r.json())
      .then((d) => setCurrent(d))
      .catch(() => {})
  }, [])

  async function handleSave() {
    if (!host || !port || !user || !pass) {
      setError('Todos los campos son obligatorios')
      return
    }
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/evomi-proxy-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          EVOMI_PROXY_HOST: host,
          EVOMI_PROXY_PORT: parseInt(port, 10),
          EVOMI_PROXY_USER: user,
          EVOMI_PROXY_PASS: pass,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setStatus('success')
        setTimeout(() => setStatus('idle'), 3000)
        setHost('')
        setPort('')
        setUser('')
        setPass('')
        // refrescar estado actual para mostrar de inmediato lo que quedó guardado
        const updated = await fetch('/api/admin/evomi-proxy-config').then((r) => r.json())
        setCurrent(updated)
      } else {
        setStatus('error')
        setError(data.error || 'Error al guardar')
      }
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Error desconocido')
    }
  }

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Globe size={14} className="text-purple-400" />
        <p className="text-sm font-semibold text-slate-200">Configuración de Proxy (Evomi CL)</p>
        {current?.configured && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 rounded-full px-2 py-0.5">
            <CheckCircle2 size={10} /> Configurado
          </span>
        )}
        {current && !current.configured && (
          <span className="ml-auto text-[10px] text-amber-400 bg-amber-900/30 border border-amber-700/40 rounded-full px-2 py-0.5">
            Sin configurar
          </span>
        )}
      </div>

      {current?.configured && (
        <p className="text-[11px] text-slate-500">
          Guardado ahora mismo:{' '}
          <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">{current.host}:{current.port}</code>
          {' · usuario '}
          <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">{current.user}</code>
          {' · contraseña '}
          <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">
            {current.hasPassword ? '••••••••' : '(sin definir)'}
          </code>
        </p>
      )}

      <p className="text-[11px] text-slate-500">
        Credenciales de Evomi (proxy residencial, geo Chile) para el barrido 24/7 de Portal
        Inmobiliario. Se guardan en el <code className="bg-slate-900 px-1 py-0.5 rounded">.env</code> del VPS.
        Tiene prioridad sobre SmartProxy CL (que queda como fallback legacy) — ver{' '}
        <code className="bg-slate-900 px-1 py-0.5 rounded">docs/PLAN-ANUNCIOS-CL.md</code> §4 H10.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Host</label>
          <input
            type="text"
            placeholder="rp.evomi.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Port</label>
          <input
            type="number"
            placeholder="1000"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Username</label>
          <input
            type="text"
            placeholder="usuario-cc-CL"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/50 rounded-lg p-2 text-[11px] text-red-300">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {status === 'success' && (
        <div className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-700/50 rounded-lg p-2 text-[11px] text-emerald-300">
          <CheckCircle2 size={12} />
          Credenciales guardadas en el VPS
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={status === 'saving'}
        className="w-full flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg transition-colors"
      >
        {status === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
        {status === 'saving' ? 'Guardando...' : 'Guardar credenciales'}
      </button>
    </div>
  )
}
