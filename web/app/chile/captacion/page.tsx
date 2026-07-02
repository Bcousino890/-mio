'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PageShell from '@/components/PageShell'
import {
  Users, Phone, RefreshCw, AlertCircle, CheckCircle2, ExternalLink,
  Link2, ShieldCheck, Clock, MessageCircle,
} from 'lucide-react'

interface CaptacionRow {
  id: string
  source_url: string
  title: string | null
  operation: string | null
  price_raw: number | null
  currency: string | null
  comuna_label: string | null
  sii_rol: string | null
  sii_direccion: string | null
  match_score: number | null
  match_verified: boolean
  owner_name: string | null
  owner_rut: string | null
  phones: Array<{ numero: string; whatsapp?: boolean }> | null
  stage: string
  needs_review: boolean
  review_reason: string | null
  tgr_status: string
  dealernet_status: string
  updated_at: string
}

const STAGE_META: Record<string, { label: string; cls: string }> = {
  extracted: { label: 'Extraído', cls: 'bg-slate-800/60 text-slate-400' },
  matched: { label: 'Rol OK', cls: 'bg-blue-900/40 text-blue-300' },
  owner_found: { label: 'Dueño OK', cls: 'bg-violet-900/40 text-violet-300' },
  contact_found: { label: 'Contacto OK', cls: 'bg-emerald-900/40 text-emerald-300' },
}

type Filter = 'all' | 'review' | 'contact_found' | 'in_progress'

export default function CaptacionChilePage() {
  const [rows, setRows] = useState<CaptacionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [resuming, setResuming] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (filter === 'review') params.set('needs_review', 'true')
      if (filter === 'contact_found') params.set('stage', 'contact_found')
      const res = await fetch(`/api/chile/captar?${params}`)
      const data = await res.json()
      if (!data.success) { setError(data.error ?? 'Error cargando captaciones'); return }
      let list: CaptacionRow[] = data.captaciones ?? []
      if (filter === 'in_progress') {
        list = list.filter((r) => r.stage !== 'contact_found' && !r.needs_review)
      }
      setRows(list)
    } catch {
      setError('Error de red')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  // Reanudar la siguiente etapa pendiente de una captación
  const resume = async (row: CaptacionRow) => {
    setResuming(row.id)
    try {
      if (row.sii_rol && !row.owner_name) {
        await fetch(`/api/chile/captar/${row.id}/tgr`, { method: 'POST' })
      } else if (row.owner_name && row.dealernet_status !== 'ok') {
        await fetch(`/api/chile/captar/${row.id}/dealernet`, { method: 'POST' })
      }
      await load()
    } finally {
      setResuming(null)
    }
  }

  const counts = {
    total: rows.length,
    contacted: rows.filter((r) => r.stage === 'contact_found').length,
    review: rows.filter((r) => r.needs_review).length,
  }

  return (
    <PageShell
      title="Captación Chile"
      subtitle="Pipeline URL → dueño → rol exacto → teléfonos · captaciones persistidas"
      action={
        <Link
          href="/chile/captar-url"
          className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <Link2 size={12} /> Nueva captación
        </Link>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Captaciones', value: counts.total, icon: Users, color: 'text-blue-400' },
          { label: 'Con teléfono del dueño', value: counts.contacted, icon: Phone, color: 'text-emerald-400' },
          { label: 'Requieren revisión', value: counts.review, icon: AlertCircle, color: 'text-amber-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">{label}</p>
              <Icon size={14} className={color} />
            </div>
            <p className="text-xl font-bold text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-1.5 mb-4">
        {([
          ['all', 'Todas'],
          ['review', 'En revisión'],
          ['in_progress', 'En curso'],
          ['contact_found', 'Con contacto'],
        ] as Array<[Filter, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              filter === key
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-[var(--c-card)] border-[var(--c-border-card)] text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-slate-500 hover:text-slate-300 p-1.5">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-red-900/50 bg-red-950/20 text-red-400 text-sm mb-4">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {!loading && rows.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-[var(--c-border-strong)] bg-[var(--c-card)] p-12 text-center">
          <Users size={32} className="mx-auto text-slate-700 mb-3" />
          <p className="text-slate-500 text-sm font-medium">Sin captaciones todavía</p>
          <p className="text-slate-700 text-xs mt-1">
            Pega una URL de Portal Inmobiliario en «Captar desde URL» para iniciar el pipeline.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border-card)]">
                {['Propiedad', 'Rol · dirección exacta', 'Match', 'Dueño', 'Teléfonos', 'Etapa', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.match_score != null ? Math.round(Number(r.match_score) * 100) : null
                const stageMeta = STAGE_META[r.stage] ?? STAGE_META.extracted
                const phones = r.phones ?? []
                const canResume = (r.sii_rol && !r.owner_name && r.tgr_status !== 'error')
                  || (r.owner_name && r.dealernet_status !== 'ok' && r.dealernet_status !== 'ambiguous')
                return (
                  <tr key={r.id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-hover)]">
                    <td className="px-4 py-3 max-w-[220px]">
                      <p className="text-slate-200 text-xs font-medium truncate">{r.title ?? '—'}</p>
                      <p className="text-slate-600 text-[11px]">
                        {r.comuna_label ?? ''}{r.price_raw ? ` · ${Number(r.price_raw).toLocaleString('es-CL')} ${r.currency ?? ''}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {r.sii_rol ? (
                        <>
                          <p className="font-mono text-xs text-blue-400">{r.sii_rol}</p>
                          <p className="text-[11px] text-slate-500 truncate max-w-[180px]">{r.sii_direccion ?? ''}</p>
                        </>
                      ) : (
                        <span className="text-slate-700 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pct != null ? (
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${
                          r.match_verified ? 'bg-emerald-900/40 text-emerald-300'
                          : pct >= 92 ? 'bg-green-900/40 text-green-300'
                          : pct >= 65 ? 'bg-amber-900/40 text-amber-300'
                          : 'bg-slate-800/60 text-slate-400'
                        }`}>
                          {r.match_verified && <ShieldCheck size={10} />}
                          {pct}%
                        </span>
                      ) : <span className="text-slate-700 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[160px]">
                      <p className="text-xs text-slate-200 truncate">{r.owner_name ?? '—'}</p>
                      {r.owner_rut && <p className="text-[11px] font-mono text-slate-500">{r.owner_rut}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {phones.length > 0 ? (
                        <div className="space-y-0.5">
                          {phones.slice(0, 2).map((p) => (
                            <p key={p.numero} className="text-[11px] font-mono text-emerald-300 flex items-center gap-1">
                              {p.numero}
                              {p.whatsapp && <MessageCircle size={9} className="text-emerald-500" />}
                            </p>
                          ))}
                          {phones.length > 2 && <p className="text-[10px] text-slate-600">+{phones.length - 2} más</p>}
                        </div>
                      ) : <span className="text-slate-700 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded ${stageMeta.cls}`}>
                        {stageMeta.label}
                      </span>
                      {r.needs_review && (
                        <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
                          <AlertCircle size={9} /> revisión
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        {canResume && (
                          <button
                            onClick={() => resume(r)}
                            disabled={resuming === r.id}
                            title="Reanudar siguiente etapa"
                            className="text-[10px] font-medium bg-blue-600/80 hover:bg-blue-500 disabled:opacity-40 text-white px-2 py-1 rounded transition-colors flex items-center gap-1"
                          >
                            {resuming === r.id ? <RefreshCw size={9} className="animate-spin" /> : <Clock size={9} />}
                            Continuar
                          </button>
                        )}
                        <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-300">
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <CheckCircle2 size={12} className="text-slate-700" />
        <span>
          El rol solo se confirma automáticamente con probabilidad ≥92% y se marca <ShieldCheck size={10} className="inline text-emerald-500" /> cuando la dirección del certificado TGR coincide con la del SII.
        </span>
      </div>
    </PageShell>
  )
}
