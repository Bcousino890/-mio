'use client'

import { useState, useEffect } from 'react'
import { Brain, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type Status = 'idle' | 'saving' | 'success' | 'error'

export default function OpenRouterConfigPanel() {
  const [apiKey, setApiKey]   = useState('')
  const [model, setModel]     = useState('')
  const [status, setStatus]   = useState<Status>('idle')
  const [error, setError]     = useState('')
  const [current, setCurrent] = useState<{ configured: boolean; keyMasked: string; model: string } | null>(null)

  useEffect(() => {
    fetch('/api/admin/openrouter-config')
      .then(r => r.json())
      .then(d => setCurrent(d))
      .catch(() => {})
  }, [])

  async function handleSave() {
    if (!apiKey) {
      setError('La API key es obligatoria')
      return
    }
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/openrouter-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ OPENROUTER_API_KEY: apiKey, OPENROUTER_CHAT_MODEL: model }),
      })
      const data = await res.json()
      if (data.success) {
        setStatus('success')
        setApiKey('')
        // refrescar estado actual
        const updated = await fetch('/api/admin/openrouter-config').then(r => r.json())
        setCurrent(updated)
        setTimeout(() => setStatus('idle'), 4000)
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
        <Brain size={14} className="text-violet-400" />
        <p className="text-sm font-semibold text-slate-200">OpenRouter — IA visual</p>
        {current?.configured && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 rounded-full px-2 py-0.5">
            <CheckCircle2 size={10} /> Configurada
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
          Key activa: <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">{current.keyMasked}</code>
          {current.model && (
            <> · Modelo: <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">{current.model}</code></>
          )}
        </p>
      )}

      <p className="text-[11px] text-slate-500">
        Credenciales de{' '}
        <span className="text-slate-300">openrouter.ai</span> para verificación visual IA
        y el chat del CRM. Se guardan en el <code className="bg-slate-900 px-1 py-0.5 rounded">.env</code> del VPS.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">
            API Key <span className="text-red-400">*</span>
          </label>
          <input
            type="password"
            placeholder="sk-or-v1-••••••••"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">
            Modelo <span className="text-slate-500">(opcional)</span>
          </label>
          <input
            type="text"
            placeholder="google/gemini-2.0-flash-exp:free"
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <p className="text-[10px] text-slate-600 mt-1">
            Deja vacío para usar el modelo por defecto (<code>google/gemini-2.0-flash-exp:free</code>)
          </p>
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
          Guardado en .env — reinicia el contenedor para que se aplique
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={status === 'saving'}
        className="w-full flex items-center justify-center gap-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg transition-colors"
      >
        {status === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
        {status === 'saving' ? 'Guardando...' : 'Guardar credenciales'}
      </button>
    </div>
  )
}
