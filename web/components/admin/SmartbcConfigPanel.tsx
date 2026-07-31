'use client'

// Panel de Configuración → SmartBC. Es donde se pega la clave que entrega
// Benjamín Cousiño Propiedades desde su panel (/cl/admin/integraciones), y sin
// la cual el botón "Agregar a Smart" de la ficha no puede enviar nada.
//
// Guardar valida la clave contra su API antes de escribirla, y enseña a quién
// pertenece y con qué permisos: una clave mal pegada, o una sin
// `captaciones:write`, se descubre aquí y no cuando alguien pulsa "Agregar a
// Smart" con un cliente delante.

import { useState, useEffect, useCallback } from 'react'
import { Plug, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type Estado = 'idle' | 'guardando' | 'probando' | 'ok' | 'error'
type Info = { cliente: string | null; slug: string | null; pais: string | null; scopes: string[]; rate_limit: number | null }

export default function SmartbcConfigPanel() {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [estado, setEstado] = useState<Estado>('idle')
  const [error, setError] = useState('')
  const [info, setInfo] = useState<Info | null>(null)
  const [actual, setActual] = useState<{ configured: boolean; keyMasked: string; baseUrl: string } | null>(null)

  const refrescar = useCallback(() => {
    fetch('/api/admin/smartbc-config')
      .then((r) => r.json())
      .then((d) => { setActual(d); if (!baseUrl) setBaseUrl(d.baseUrl ?? '') })
      .catch(() => {})
  }, [baseUrl])

  useEffect(() => { refrescar() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    if (!apiKey) { setError('Pega la clave que te dio SmartBC'); setEstado('error'); return }
    setEstado('guardando'); setError(''); setInfo(null)
    try {
      const res = await fetch('/api/admin/smartbc-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ SMARTBC_API_KEY: apiKey, SMARTBC_BASE_URL: baseUrl }),
      })
      const data = await res.json()
      if (data.success) {
        setEstado('ok'); setInfo(data.data); setApiKey(''); refrescar()
      } else {
        setEstado('error'); setError(data.error ?? 'No se pudo guardar')
      }
    } catch {
      setEstado('error'); setError('Error de red al guardar')
    }
  }

  async function probar() {
    setEstado('probando'); setError(''); setInfo(null)
    try {
      const res = await fetch('/api/admin/smartbc-config', { method: 'PUT' })
      const data = await res.json()
      if (data.success) { setEstado('ok'); setInfo(data.data) }
      else { setEstado('error'); setError(data.error ?? 'La clave no responde') }
    } catch {
      setEstado('error'); setError('Error de red al probar')
    }
  }

  const ocupado = estado === 'guardando' || estado === 'probando'

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <Plug size={16} className="text-emerald-500" />
        <h2 className="text-sm font-semibold text-[var(--c-text)]">SmartBC (CRM)</h2>
        {actual?.configured && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">configurada</span>
        )}
      </div>
      <p className="text-xs text-[var(--c-text-muted)] mb-3">
        Clave de la API que entrega Benjamín Cousiño Propiedades. Sin ella, el botón
        “Agregar a Smart” de las fichas no puede enviar nada.
      </p>

      {actual?.configured && (
        <p className="text-[11px] font-mono text-slate-400 mb-2">{actual.keyMasked}</p>
      )}

      <div className="space-y-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={actual?.configured ? 'Pegar una clave nueva para reemplazarla' : 'sbc_live_…'}
          className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
        />
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://portal.bcousinoprop.com"
          className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={guardar}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {estado === 'guardando' ? <><Loader2 size={13} className="animate-spin" /> Verificando…</> : 'Guardar'}
          </button>
          {actual?.configured && (
            <button
              onClick={probar}
              disabled={ocupado}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-200 hover:border-emerald-500 disabled:opacity-50 transition-colors"
            >
              {estado === 'probando' ? <><Loader2 size={13} className="animate-spin" /> Probando…</> : 'Probar conexión'}
            </button>
          )}
        </div>
      </div>

      {estado === 'ok' && info && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-emerald-300">
          <CheckCircle2 size={13} className="mt-px shrink-0" />
          <span>
            Conectado como <strong>{info.cliente}</strong>
            {info.pais ? ` (${info.pais.toUpperCase()})` : ''} · permisos: {info.scopes.join(', ')}
            {info.rate_limit ? ` · ${info.rate_limit} peticiones/min` : ''}
          </span>
        </div>
      )}
      {estado === 'error' && error && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-rose-300">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
