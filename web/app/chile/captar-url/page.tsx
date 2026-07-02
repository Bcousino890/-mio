'use client'

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import PageShell from '@/components/PageShell'
import {
  Link2, Search, MapPin, Layers, ExternalLink, AlertCircle, CheckCircle2,
  RefreshCw, Phone, User, FileCheck2, Landmark, ShieldCheck, Copy,
  MessageCircle, ChevronRight, Clock,
} from 'lucide-react'

const ListingMatchMap = dynamic(() => import('@/components/map/ListingMatchMap'), { ssr: false })

const DESTINO_LABELS: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

type StepState = 'pending' | 'running' | 'done' | 'review' | 'error'

interface Captacion {
  id: string
  source_url: string
  title: string | null
  operation: string | null
  property_type: string | null
  price_raw: number | null
  currency: string | null
  sqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  address: string | null
  comuna_label: string | null
  sii_comuna_code: string | null
  latitude: number | null
  longitude: number | null
  raw_extracted: Record<string, unknown> | null
  sii_rol: string | null
  sii_direccion: string | null
  match_score: number | null
  match_confidence: string | null
  match_verified: boolean
  candidates: any[] | null
  tgr_status: string
  owner_name: string | null
  tgr_direccion: string | null
  tgr_error: string | null
  dealernet_status: string
  owner_rut: string | null
  owner_rut_candidates: any[] | null
  phones: Array<{ numero: string; tipo?: string; whatsapp?: boolean; fuente?: string; calidad?: number }> | null
  emails: Array<{ email: string }> | null
  dealernet_error: string | null
  stage: string
  needs_review: boolean
  review_reason: string | null
}

function fmtCLP(n: number | null) {
  if (!n) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`
  return `$${n.toLocaleString('es-CL')}`
}

function probColor(p: number | null | undefined): string {
  const pct = (p ?? 0) * 100
  if (pct >= 92) return 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400'
  if (pct >= 80) return 'bg-green-950/40 border-green-900/50 text-green-400'
  if (pct >= 65) return 'bg-amber-950/40 border-amber-900/50 text-amber-400'
  return 'bg-red-950/40 border-red-900/50 text-red-400'
}

function Step({ n, label, state, detail }: { n: number; label: string; state: StepState; detail?: string | null }) {
  const icon = state === 'done' ? <CheckCircle2 size={14} className="text-emerald-400" />
    : state === 'running' ? <RefreshCw size={14} className="animate-spin text-blue-400" />
    : state === 'review' ? <AlertCircle size={14} className="text-amber-400" />
    : state === 'error' ? <AlertCircle size={14} className="text-red-400" />
    : <Clock size={14} className="text-slate-600" />
  const border = state === 'done' ? 'border-emerald-900/50' : state === 'running' ? 'border-blue-800/60'
    : state === 'review' ? 'border-amber-900/50' : state === 'error' ? 'border-red-900/50' : 'border-[var(--c-border-card)]'
  return (
    <div className={`flex-1 flex items-start gap-2.5 p-3 rounded-xl border bg-[var(--c-card)] ${border}`}>
      <div className="w-6 h-6 rounded-full bg-slate-900/60 border border-slate-700/50 flex items-center justify-center text-[10px] font-bold text-slate-400 flex-shrink-0">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-semibold text-slate-300">{label}</span>
        </div>
        {detail && <p className="text-[11px] text-slate-600 mt-1 leading-snug">{detail}</p>}
      </div>
    </div>
  )
}

export default function CaptarUrlPage() {
  const [url, setUrl] = useState('')
  const [captacion, setCaptacion] = useState<Captacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [tgrRunning, setTgrRunning] = useState(false)
  const [dnRunning, setDnRunning] = useState(false)
  const [selectedRol, setSelectedRol] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // ── Etapa 3+4 auto-encadenadas ─────────────────────────────────────────────
  const runDealernet = useCallback(async (id: string) => {
    setDnRunning(true)
    try {
      const res = await fetch(`/api/chile/captar/${id}/dealernet`, { method: 'POST' })
      const data = await res.json()
      if (data.captacion) setCaptacion(data.captacion)
    } catch {
      // el estado queda registrado en la captación; reintentable
    } finally {
      setDnRunning(false)
    }
  }, [])

  const runTgr = useCallback(async (id: string) => {
    setTgrRunning(true)
    try {
      const res = await fetch(`/api/chile/captar/${id}/tgr`, { method: 'POST' })
      const data = await res.json()
      if (data.captacion) setCaptacion(data.captacion)
      // Encadenar DealerNet solo si TGR entregó dueño y el match no cayó a revisión
      if (data.captacion?.owner_name && !data.captacion?.needs_review) {
        await runDealernet(id)
      }
    } catch {
      // reintentable desde el botón
    } finally {
      setTgrRunning(false)
    }
  }, [runDealernet])

  // ── Etapa 1+2 ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    let u = url.trim()
    if (!u) return
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u

    setExtracting(true)
    setError(null)
    setCaptacion(null)
    setSelectedRol(null)
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
      // Match auto-confirmado (≥92%) → continuar solo hacia TGR
      if (data.captacion?.sii_rol && !data.captacion?.needs_review) {
        await runTgr(data.captacion.id)
      }
    } catch {
      setError('Error de red')
    } finally {
      setExtracting(false)
    }
  }

  const handleSelectRol = async (rol: string) => {
    if (!captacion) return
    setSelectedRol(rol)
    try {
      const res = await fetch(`/api/chile/captar/${captacion.id}/select-rol`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rol }),
      })
      const data = await res.json()
      if (data.success && data.captacion) {
        setCaptacion(data.captacion)
        await runTgr(data.captacion.id)
      }
    } catch {
      // el candidato queda seleccionado visualmente; reintentable
    }
  }

  const handleSelectRut = async (rut: string) => {
    if (!captacion) return
    setDnRunning(true)
    try {
      const res = await fetch(`/api/chile/captar/${captacion.id}/dealernet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut }),
      })
      const data = await res.json()
      if (data.captacion) setCaptacion(data.captacion)
    } finally {
      setDnRunning(false)
    }
  }

  const copyText = (text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }

  // ── Estados del stepper ────────────────────────────────────────────────────
  const ext = (captacion?.raw_extracted ?? {}) as Record<string, any>
  const candidates = captacion?.candidates ?? []
  const matchPct = captacion?.match_score != null ? Math.round(Number(captacion.match_score) * 100) : null

  const s1: StepState = extracting ? 'running' : captacion ? 'done' : 'pending'
  const s2: StepState = !captacion ? 'pending'
    : captacion.sii_rol ? 'done'
    : captacion.needs_review ? 'review'
    : captacion.match_confidence === 'none' ? 'error'
    : 'pending'
  const s3: StepState = tgrRunning ? 'running'
    : captacion?.owner_name ? 'done'
    : captacion?.tgr_status === 'cooldown' ? 'review'
    : captacion?.tgr_status === 'error' ? 'error'
    : 'pending'
  const s4: StepState = dnRunning ? 'running'
    : captacion?.dealernet_status === 'ok' ? 'done'
    : captacion?.dealernet_status === 'ambiguous' ? 'review'
    : captacion?.dealernet_status === 'error' || captacion?.dealernet_status === 'not_found' ? 'error'
    : 'pending'

  const phones = captacion?.phones ?? []
  const rutCandidates = (captacion?.owner_rut_candidates ?? []) as any[]

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

      {/* Stepper */}
      <div className="flex gap-2 mb-6">
        <Step n={1} label="Extraer anuncio" state={s1} detail={captacion ? (captacion.title ?? captacion.source_url) : null} />
        <Step n={2} label="Rol + dirección exacta" state={s2}
          detail={captacion?.sii_rol
            ? `${captacion.sii_rol} · ${matchPct}%${captacion.match_verified ? ' · verificado TGR' : ''}`
            : captacion?.review_reason ?? null} />
        <Step n={3} label="Dueño (TGR)" state={s3}
          detail={captacion?.owner_name ?? captacion?.tgr_error ?? null} />
        <Step n={4} label="Teléfonos (DealerNet)" state={s4}
          detail={captacion?.dealernet_status === 'ok' ? `${phones.length} teléfono${phones.length !== 1 ? 's' : ''}` : captacion?.dealernet_error ?? null} />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-red-900/50 bg-red-950/20 text-red-400 text-sm mb-6">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {captacion && (
        <div className="space-y-6">
          {/* ── Panel CONTACTAR (resultado final) ── */}
          {(captacion.owner_name || captacion.owner_rut) && (
            <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/10 p-5">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={16} className="text-emerald-400" />
                <p className="text-sm font-semibold text-emerald-300">Dueño identificado{captacion.match_verified ? ' · dirección verificada con TGR' : ''}</p>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div>
                  <p className="text-[10px] text-slate-600 mb-0.5">Nombre (certificado TGR)</p>
                  <p className="text-sm font-semibold text-slate-100">{captacion.owner_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-600 mb-0.5">RUT</p>
                  <p className="text-sm font-mono text-slate-100 flex items-center gap-1.5">
                    {captacion.owner_rut ?? '—'}
                    {captacion.owner_rut && (
                      <button onClick={() => copyText(captacion.owner_rut!)} className="text-slate-600 hover:text-slate-300">
                        <Copy size={11} />
                      </button>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-600 mb-0.5">Dirección exacta (SII)</p>
                  <p className="text-sm text-slate-100">{captacion.sii_direccion ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-600 mb-0.5">Rol · deuda contribuciones</p>
                  <p className="text-sm text-slate-100 font-mono">
                    {captacion.sii_rol}
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-sans font-semibold ${captacion.tgr_status === 'sin_deuda' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-amber-900/40 text-amber-300'}`}>
                      {captacion.tgr_status === 'sin_deuda' ? 'Sin deuda' : captacion.tgr_status === 'ok' ? 'Con deuda' : captacion.tgr_status}
                    </span>
                  </p>
                </div>
              </div>

              {phones.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {phones.map((p) => (
                    <div key={p.numero} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/50 border border-slate-700/40">
                      <Phone size={12} className="text-emerald-400" />
                      <button onClick={() => copyText(p.numero)} className="text-sm font-mono text-slate-100 hover:text-emerald-300">
                        {copied === p.numero ? '¡Copiado!' : p.numero}
                      </button>
                      {p.whatsapp && (
                        <a
                          href={`https://wa.me/${p.numero.replace(/[^\d]/g, '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-emerald-400 hover:text-emerald-300"
                        >
                          <MessageCircle size={13} />
                        </a>
                      )}
                      {p.tipo && <span className="text-[10px] text-slate-600">{p.tipo}</span>}
                    </div>
                  ))}
                </div>
              )}
              {captacion.dealernet_status === 'ok' && phones.length === 0 && (
                <p className="text-xs text-slate-500">DealerNet no devolvió teléfonos para este RUT.</p>
              )}
            </div>
          )}

          {/* ── RUT ambiguo: elegir manualmente ── */}
          {captacion.dealernet_status === 'ambiguous' && rutCandidates.length > 0 && (
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/10 p-4">
              <p className="text-xs font-semibold text-amber-300 mb-3 flex items-center gap-1.5">
                <AlertCircle size={13} /> Varios RUT candidatos en DealerNet — elige el que corresponde a “{captacion.owner_name}”
              </p>
              <div className="space-y-1.5">
                {rutCandidates.slice(0, 8).map((cand: any, i: number) => {
                  const rutStr = cand.rut ? `${cand.rut}-${cand.dv ?? ''}` : null
                  const name = [cand.nombres, cand.apellidos, cand.razonSocial].filter(Boolean).join(' ')
                  return (
                    <button
                      key={`${rutStr}-${i}`}
                      onClick={() => rutStr && handleSelectRut(rutStr)}
                      disabled={dnRunning}
                      className="w-full flex items-center justify-between p-2.5 rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] hover:border-amber-700/50 text-left transition-colors"
                    >
                      <span className="text-xs text-slate-200">{name || '—'}</span>
                      <span className="text-xs font-mono text-amber-300">{rutStr}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── TGR en cooldown / error: reintentar ── */}
          {captacion.sii_rol && !captacion.owner_name && !tgrRunning && (captacion.tgr_status === 'cooldown' || captacion.tgr_status === 'error') && (
            <div className="flex items-center justify-between p-4 rounded-xl border border-amber-900/40 bg-amber-950/10">
              <p className="text-xs text-amber-300 flex items-center gap-1.5">
                <Landmark size={13} /> {captacion.tgr_error ?? 'Consulta TGR pendiente'}
              </p>
              <button
                onClick={() => runTgr(captacion.id)}
                className="text-xs font-medium bg-amber-600/80 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Reintentar TGR
              </button>
            </div>
          )}

          {/* ── Ficha del anuncio ── */}
          <div className="rounded-2xl overflow-hidden ring-1 ring-white/5 bg-[var(--c-card)]">
            <div className="relative h-64 bg-[var(--c-card)] overflow-hidden">
              {captacion.latitude && captacion.longitude ? (
                <ListingMatchMap
                  listingLat={Number(captacion.latitude)}
                  listingLng={Number(captacion.longitude)}
                  candidates={candidates}
                  selectedRol={selectedRol ?? captacion.sii_rol}
                  onSelectCandidate={(rol: string) => setSelectedRol(rol)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-700 text-sm bg-gradient-to-br from-slate-900 to-slate-800">
                  Sin coordenadas — no se pudo ubicar el anuncio en el mapa
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none" />
              <a
                href={captacion.source_url}
                target="_blank" rel="noopener noreferrer"
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white/70 flex items-center justify-center hover:bg-black/70 hover:text-white transition-all"
              >
                <ExternalLink size={14} />
              </a>
              <div className="absolute bottom-3 left-4">
                <div className="text-white font-bold text-lg leading-none">
                  {captacion.price_raw ? Number(captacion.price_raw).toLocaleString('es-CL') : '—'} {captacion.currency ?? ''}
                </div>
              </div>
              {captacion.operation && (
                <div className="absolute bottom-3 right-4">
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded ${captacion.operation === 'rent' ? 'bg-violet-600/80 text-white' : 'bg-blue-600/80 text-white'}`}>
                    {captacion.operation === 'rent' ? 'ARRIENDO' : 'VENTA'}
                  </span>
                </div>
              )}
            </div>

            <div className="px-4 py-4 space-y-3">
              {captacion.comuna_label && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-950/30 border border-emerald-900/50 rounded-lg w-fit">
                  <MapPin size={11} className="text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-300">{captacion.comuna_label}</span>
                </div>
              )}
              <h2 className="text-slate-200 text-base font-semibold leading-snug line-clamp-2">
                {captacion.title || `Propiedad en ${captacion.comuna_label ?? 'Chile'}`}
              </h2>
              <p className="text-slate-500 text-xs">
                {captacion.sqm && `${captacion.sqm} m²`}
                {captacion.bedrooms != null && ` · ${captacion.bedrooms} dorm.`}
                {captacion.bathrooms != null && ` · ${captacion.bathrooms} baño${captacion.bathrooms !== 1 ? 's' : ''}`}
                {captacion.property_type && ` · ${captacion.property_type}`}
              </p>
              {captacion.address && (
                <p className="text-slate-400 text-xs flex items-center gap-2">
                  <MapPin size={12} className="text-slate-600 flex-shrink-0" />
                  <span className="truncate">{captacion.address}</span>
                </p>
              )}
              {ext.fetch_error && (
                <p className="text-[11px] text-slate-700 flex items-center gap-1.5">
                  <AlertCircle size={11} className="text-amber-700" />
                  No se pudo cargar la página del anuncio ({String(ext.fetch_error)}) — datos derivados de la URL.
                </p>
              )}
            </div>
          </div>

          {/* ── Candidatos SII ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold flex items-center gap-2">
                <FileCheck2 size={12} />
                {captacion.sii_rol && !captacion.needs_review
                  ? 'Rol confirmado'
                  : `Roles SII candidatos ${candidates.length > 0 ? `(${candidates.length})` : ''}`}
              </p>
              {captacion.needs_review && captacion.review_reason && (
                <span className="text-[11px] text-amber-400">{captacion.review_reason}</span>
              )}
            </div>

            {!captacion.sii_comuna_code ? (
              <div className="p-4 rounded-xl border border-amber-900/40 bg-amber-950/20 text-amber-400 text-sm flex items-center gap-2">
                <AlertCircle size={14} />
                No se detectó una comuna con datos SII disponibles.
              </div>
            ) : candidates.length === 0 ? (
              <div className="p-4 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] text-slate-600 text-sm">
                Sin coincidencias en el catastro SII para {captacion.comuna_label}.
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.map((rol: any, i: number) => {
                  const pct = Math.round((rol.match_score ?? 0) * 100)
                  const isChosen = captacion.sii_rol === rol.rol
                  const isSelected = (selectedRol ?? captacion.sii_rol) === rol.rol
                  const explanation = rol.match_result_v3?.explanation
                  return (
                    <button
                      key={rol.rol}
                      type="button"
                      onClick={() => !captacion.sii_rol || captacion.needs_review ? handleSelectRol(rol.rol) : setSelectedRol(rol.rol)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors group ${
                        isChosen ? 'border-emerald-700 bg-emerald-950/20'
                        : isSelected ? 'border-blue-600 bg-blue-950/30'
                        : 'border-[var(--c-border-card)] bg-[var(--c-card)] hover:border-blue-700/50 hover:bg-blue-950/20'
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-950 border border-blue-800/50 flex items-center justify-center text-[10px] font-bold text-blue-400 flex-shrink-0">
                        {isChosen ? <CheckCircle2 size={12} className="text-emerald-400" /> : i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-sm text-blue-400">{rol.rol}</span>
                          {rol.rol_padre && <Layers size={11} className="text-purple-400" aria-label="Unidad de edificio" />}
                          {rol.codigo_destino_principal && (
                            <span className="text-[10px] text-slate-600">
                              {DESTINO_LABELS[rol.codigo_destino_principal] ?? rol.codigo_destino_principal}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">{rol.direccion ?? '—'}</p>
                        {explanation && (
                          <p className="text-[10px] text-slate-600 mt-1 truncate">{explanation}</p>
                        )}
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          {rol.superficie_terreno_m2 && (
                            <span className="text-[10px] text-slate-500 bg-slate-900/30 px-1.5 py-0.5 rounded">
                              Terreno: {rol.superficie_terreno_m2}m²
                            </span>
                          )}
                          {rol.superficie_construida_m2 && (
                            <span className="text-[10px] text-slate-500 bg-slate-900/30 px-1.5 py-0.5 rounded">
                              Construida: {rol.superficie_construida_m2}m²
                            </span>
                          )}
                          {rol.distance_m != null && (
                            <span className="text-[10px] text-slate-500 bg-slate-900/30 px-1.5 py-0.5 rounded">
                              {Math.round(rol.distance_m)} m del pin
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <div className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${probColor(rol.match_score)}`}>
                          {pct}%
                        </div>
                        <p className="text-sm font-semibold text-slate-200">{fmtCLP(rol.avaluo_fiscal_total)}</p>
                      </div>
                    </button>
                  )
                })}
                {captacion.needs_review && (
                  <p className="text-[11px] text-slate-600 flex items-center gap-1.5 px-1">
                    <User size={11} />
                    Haz clic en el candidato correcto para confirmarlo manualmente y continuar con TGR + DealerNet.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  )
}
