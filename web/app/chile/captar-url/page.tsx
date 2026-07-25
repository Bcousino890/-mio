'use client'

import { useState } from 'react'
import Link from 'next/link'
import PageShell from '@/components/PageShell'
import { Link2, Search, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react'
import CaptacionDetail, { Step, type Captacion } from '@/components/chile/CaptacionDetail'

export default function CaptarUrlPage() {
  const [url, setUrl] = useState('')
  const [captacion, setCaptacion] = useState<Captacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  // ── Etapa 1+2 ──────────────────────────────────────────────────────────────
  // Las etapas 3 y 4 (TGR + DealerNet) las encadena CaptacionDetail vía
  // `autoAdvance` cuando el rol quedó confirmado sin necesitar revisión.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    let u = url.trim()
    if (!u) return
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u

    setExtracting(true)
    setError(null)
    setCaptacion(null)
    try {
      const res = await fetch('/api/chile/captar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error ?? 'Error al procesar la URL')
        return
      }
      setCaptacion(data.captacion)
    } catch {
      setError('Error de red')
    } finally {
      setExtracting(false)
    }
  }

  return (
    <PageShell
      title="Captar desde URL"
      subtitle="URL de Portal Inmobiliario → rol + dirección exacta → dueño (TGR) → teléfonos (DealerNet)"
      action={
        <Link
          href="/chile/captacion"
          className="flex items-center gap-1.5 text-xs font-medium bg-[var(--c-card)] border border-[var(--c-border-card)] hover:border-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
        >
          Ver captaciones <ChevronRight size={12} />
        </Link>
      }
    >
      {/* URL input */}
      <form onSubmit={handleSubmit} className="mb-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="www.portalinmobiliario.com/MLC-... o https://..."
              className="w-full pl-9 pr-4 py-2.5 text-sm bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-xl text-slate-200 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50"
            />
          </div>
          <button
            type="submit"
            disabled={extracting || !url.trim()}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {extracting ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            {extracting ? 'Captando...' : 'Captar'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-700">
          El pipeline solo confirma el rol automáticamente con probabilidad ≥92%; si hay dudas te pide elegir entre candidatos. El dueño se verifica con el certificado TGR antes de buscar teléfonos.
        </p>
      </form>

      {/* Stepper de arranque — una vez que hay captación, CaptacionDetail
          muestra el suyo con el estado real de cada etapa. */}
      {!captacion && (
        <div className="flex gap-2 mb-6 flex-wrap">
          <Step n={1} label="Extraer anuncio" state={extracting ? 'running' : 'pending'} />
          <Step n={2} label="Rol + dirección exacta" state="pending" />
          <Step n={3} label="Dueño (TGR)" state="pending" />
          <Step n={4} label="Teléfonos (DealerNet)" state="pending" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-red-900/50 bg-red-950/20 text-red-400 text-sm mb-6">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {captacion && (
        <CaptacionDetail captacion={captacion} onChange={setCaptacion} autoAdvance />
      )}
    </PageShell>
  )
}
