'use client'

import { useState, useEffect } from 'react'
import { Phone, Loader2, CheckCircle2, AlertCircle, ImageIcon, ChevronDown, ChevronRight } from 'lucide-react'

type Status = 'idle' | 'saving' | 'success' | 'error'

interface CurrentConfig {
  configured: boolean
  user: string
  portal_base_url?: string
  image_cookie_configured?: boolean
}

export default function DealerNetPanel() {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [portalUrl, setPortalUrl] = useState('')
  const [imageCookie, setImageCookie] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<CurrentConfig | null>(null)
  const [credOpen, setCredOpen] = useState(false)
  const [fotosOpen, setFotosOpen] = useState(false)

  useEffect(() => {
    fetch('/api/admin/dealernet-config')
      .then(r => r.json())
      .then(d => setCurrent(d))
      .catch(() => {})
  }, [])

  async function handleSave() {
    // Credenciales van juntas; la config del portal de fotos se puede guardar
    // sola sin re-tipearlas.
    if ((user && !pass) || (!user && pass)) {
      setError('Usuario y contraseña se guardan juntos')
      return
    }
    if (!user && !pass && !portalUrl && !imageCookie) {
      setError('Nada que guardar — completa al menos un campo')
      return
    }
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/admin/dealernet-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(user && pass ? { DEALERNET_USER: user, DEALERNET_PASSWORD: pass } : {}),
          ...(portalUrl ? { DEALERNET_PORTAL_BASE_URL: portalUrl } : {}),
          ...(imageCookie ? { DEALERNET_IMAGE_COOKIE: imageCookie } : {}),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setStatus('success')
        setTimeout(() => setStatus('idle'), 3000)
        setUser('')
        setPass('')
        setPortalUrl('')
        setImageCookie('')
        // refrescar estado actual para que el badge "Configurada" se actualice sin recargar
        const updated = await fetch('/api/admin/dealernet-config').then(r => r.json())
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

  // Config plegada por defecto — es de un solo uso y hacía mucho ruido
  // encima del flujo de búsqueda. El badge del header ya dice si está lista.
  const anyOpen = credOpen || fotosOpen

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]">
      {/* Sección 1: credenciales SOAP */}
      <button
        onClick={() => setCredOpen(o => !o)}
        className="w-full flex items-center gap-2 p-4 text-left"
      >
        <Phone size={14} className="text-blue-400" />
        <p className="text-sm font-semibold text-slate-200">Credenciales DealerNet</p>
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
        {credOpen
          ? <ChevronDown size={14} className={`text-slate-500 ${current ? '' : 'ml-auto'}`} />
          : <ChevronRight size={14} className={`text-slate-500 ${current ? '' : 'ml-auto'}`} />}
      </button>

      {credOpen && (
        <div className="px-4 pb-4 space-y-3">
          {current?.configured && (
            <p className="text-[11px] text-slate-500">
              Usuario activo: <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">{current.user}</code>
              {' '}— ya quedan guardadas, no hace falta volver a escribirlas.
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            Credenciales para acceder a DealerNet (directorio de contactos Chile).
            Se guardan en el <code className="bg-slate-900 px-1 py-0.5 rounded">.env</code> del VPS.
          </p>
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">Usuario</label>
            <input
              type="text"
              placeholder="usuario@dealernet.cl"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">Contraseña</label>
            <input
              type="password"
              placeholder="••••••••"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      )}

      {/* Sección 2: portal de fotos de perfil */}
      <button
        onClick={() => setFotosOpen(o => !o)}
        className="w-full flex items-center gap-2 p-4 text-left border-t border-[var(--c-border-card)]"
      >
        <ImageIcon size={13} className="text-purple-400" />
        <p className="text-sm font-semibold text-slate-200">Fotos de perfil por teléfono</p>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 rounded-full px-2 py-0.5">
          <CheckCircle2 size={10} /> Funciona sin configurar
        </span>
        {fotosOpen
          ? <ChevronDown size={14} className="text-slate-500" />
          : <ChevronRight size={14} className="text-slate-500" />}
      </button>

      {fotosOpen && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[11px] text-slate-500">
            La foto (WhatsApp) junto a cada número en Dueños ya funciona sin configurar nada —
            apunta a <code className="bg-slate-900 px-1 py-0.5 rounded">suite.dealernet.cl</code>.
            Estos campos son solo por si el dominio del portal cambia o el endpoint empieza a
            exigir sesión (cookie: DevTools → Network → petición al portal → header{' '}
            <code className="bg-slate-900 px-1 py-0.5 rounded">Cookie</code>).
          </p>
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">URL del portal (override)</label>
            <input
              type="url"
              placeholder={current?.portal_base_url || 'https://suite.dealernet.cl (default)'}
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">
              Cookie de sesión (opcional{current?.image_cookie_configured ? ' — ya hay una guardada' : ''})
            </label>
            <input
              type="password"
              placeholder="ASP.NET_SessionId=..."
              value={imageCookie}
              onChange={(e) => setImageCookie(e.target.value)}
              className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>
      )}

      {/* Errores y guardar: solo con alguna sección abierta */}
      {anyOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--c-border-card)] pt-3">
          {error && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/50 rounded-lg p-2 text-[11px] text-red-300">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
          {status === 'success' && (
            <div className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-700/50 rounded-lg p-2 text-[11px] text-emerald-300">
              <CheckCircle2 size={12} />
              Configuración guardada en el VPS
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={status === 'saving'}
            className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg transition-colors"
          >
            {status === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <Phone size={12} />}
            {status === 'saving' ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      )}
    </div>
  )
}
