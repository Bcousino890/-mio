'use client'

import { useState } from 'react'
import { Globe, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type Status = 'idle' | 'saving' | 'success' | 'error'

export default function ProxyConfigPanel() {
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  async function handleSave() {
    if (!host || !port || !user || !pass) {
      setError('Todos los campos son obligatorios')
      return
    }
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/proxy-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          SMARTPROXY_CL_HOST: host,
          SMARTPROXY_CL_PORT: parseInt(port, 10),
          SMARTPROXY_CL_USER: user,
          SMARTPROXY_CL_PASS: pass,
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
        <Globe size={14} className="text-amber-400" />
        <p className="text-sm font-semibold text-slate-200">Configuración de Proxy (SmartProxy CL)</p>
      </div>
      <p className="text-[11px] text-slate-500">
        Credenciales de SmartProxy para Chile. Se guardan en el <code className="bg-slate-900 px-1 py-0.5 rounded">.env</code> del VPS.
        Usado por geocodificación SII y scraper de Portalinmobiliario.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Host</label>
          <input
            type="text"
            placeholder="us.smartproxy.net"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Port</label>
          <input
            type="number"
            placeholder="3121"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Username</label>
          <input
            type="text"
            placeholder="smart-crmchile_area-CL_state-SANTIAGOMETROPOLITAN"
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
        className="w-full flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg transition-colors"
      >
        {status === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
        {status === 'saving' ? 'Guardando...' : 'Guardar credenciales'}
      </button>
    </div>
  )
}
