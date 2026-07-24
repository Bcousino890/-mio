'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  History, Search, Loader2, AlertCircle, ChevronDown, ChevronRight,
  RefreshCw, Phone, Mail, MapPin, Users, Clock, ExternalLink, StickyNote,
  Building2, UserRound,
} from 'lucide-react'
import { ResultCard, type LookupResult } from './DealerFicha'

// Historial de consultas DealerNet.
//
// Reúne TODO lo consultado en DealerNet, guardado permanentemente en la base:
//   • Consultas por RUT (ficha completa: teléfonos, correos, direcciones,
//     relacionados, servicios pedidos, link del portal y notas).
//   • Búsquedas del Buscador Múltiple (dirección/rol/nombre → candidatos).
//
// Al abrir una consulta se muestra su ficha/candidatos completos. Para las
// consultas por RUT se reutiliza el MISMO componente que la consulta en vivo
// (ResultCard), para que la ficha sea idéntica.

const PRODUCT_LABELS: Record<string, string> = {
  '3410': 'Directorio Teléfonos',
  '3407': 'Contactabilidad',
  '3408': 'Verificación Múltiple',
  '3421': 'Relacionados',
}

interface ContactoItem {
  kind: 'contacto'
  id: string
  rut_num: number
  rut_dv: string
  nombre_titular: string | null
  products_requested: string[]
  retcode: number | null
  sii_rol: string | null
  portal_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  phones_n: number
  emails_n: number
  addresses_n: number
  relacionados_n: number
}

interface BusquedaItem {
  kind: 'busqueda'
  id: string
  tipbusq: string
  tipbusq_label: string
  args: string
  retcode: number | null
  candidatos_n: number
  created_at: string
  updated_at: string
}

type HistoryItem = ContactoItem | BusquedaItem

interface ContactoDetail extends LookupResult {
  id: string
  products_requested: string[]
  retcode: number | null
  retmsg: string | null
  sii_rol: string | null
  sii_comuna_code: string | null
  portal_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface Candidato {
  rut: number | null
  dv: string | null
  clasif: string | null
  nombres: string | null
  apellidos: string | null
  razonSocial: string | null
  propietario: string | null
  similitud: number | null
  probabilidad: string | null
}

interface BusquedaDetail {
  id: string
  tipbusq: string
  tipbusq_label: string
  args: string
  retcode: number | null
  retmsg: string | null
  candidatos: Candidato[]
  created_at: string
  updated_at: string
}

function formatFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function DealerQueryHistory() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState<HistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [activeQuery, setActiveQuery] = useState('')

  // Ficha/candidatos abiertos: id → detalle (cacheado en cliente)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [contactoDetails, setContactoDetails] = useState<Record<string, ContactoDetail>>({})
  const [busquedaDetails, setBusquedaDetails] = useState<Record<string, BusquedaDetail>>({})
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<Record<string, string>>({})

  const fetchList = useCallback(async (q: string) => {
    setLoading(true)
    setError('')
    try {
      const url = q
        ? `/api/chile/dealernet-history?q=${encodeURIComponent(q)}&limit=100`
        : `/api/chile/dealernet-history?limit=100`
      const res = await fetch(url)
      const data = await res.json()
      if (!data.success) {
        setError(data.error ?? 'Error al cargar historial')
        return
      }
      setItems(data.items ?? [])
      setTotal(data.total ?? (data.items?.length ?? 0))
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setLoading(false)
    }
  }, [])

  // Carga perezosa: solo al abrir el apartado por primera vez.
  useEffect(() => {
    if (open && !loaded && !loading) void fetchList('')
  }, [open, loaded, loading, fetchList])

  async function loadDetail(item: HistoryItem) {
    if (item.kind === 'contacto' && contactoDetails[item.id]) return
    if (item.kind === 'busqueda' && busquedaDetails[item.id]) return
    setDetailLoading(item.id)
    setDetailError(prev => { const n = { ...prev }; delete n[item.id]; return n })
    try {
      const url = item.kind === 'contacto'
        ? `/api/chile/dealernet-history?id=${encodeURIComponent(item.id)}`
        : `/api/chile/dealernet-history?busqueda_id=${encodeURIComponent(item.id)}`
      const res = await fetch(url)
      const data = await res.json()
      if (!data.success) {
        setDetailError(prev => ({ ...prev, [item.id]: data.error ?? 'Error al cargar el detalle' }))
        return
      }
      if (item.kind === 'contacto') {
        setContactoDetails(prev => ({ ...prev, [item.id]: data.detail }))
      } else {
        setBusquedaDetails(prev => ({ ...prev, [item.id]: data.busqueda }))
      }
    } catch (e) {
      setDetailError(prev => ({ ...prev, [item.id]: e instanceof Error ? e.message : 'Error de red' }))
    } finally {
      setDetailLoading(null)
    }
  }

  function toggleRow(item: HistoryItem) {
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(item.id)
    void loadDetail(item)
  }

  function handleSearch() {
    const q = search.trim()
    setActiveQuery(q)
    setExpandedId(null)
    void fetchList(q)
  }

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]">
      {/* Header plegable */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 p-4 text-left"
      >
        <History size={14} className="text-emerald-400" />
        <p className="text-sm font-semibold text-slate-200">Historial de consultas</p>
        {loaded && (
          <span className="text-[10px] text-slate-500 bg-slate-900/40 border border-slate-800/50 rounded-full px-2 py-0.5">
            {total}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {loaded && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); void fetchList(activeQuery) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void fetchList(activeQuery) } }}
              title="Refrescar"
              className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-[var(--c-hover)] transition-colors"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </span>
          )}
          {open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[11px] text-slate-500">
            Todas las consultas quedan guardadas permanentemente. Abre una para ver la ficha
            completa (teléfonos, correos, direcciones, relacionados, servicios y link de la
            propiedad) o los candidatos del Buscador Múltiple.
          </p>

          {/* Buscador */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por nombre, RUT o dirección/rol…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
                className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs pl-8 pr-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium py-2 px-4 rounded-lg transition-colors whitespace-nowrap"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              Buscar
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/50 rounded-lg p-2 text-[11px] text-red-300">
              <AlertCircle size={12} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {loading && items.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Cargando historial…
            </div>
          )}

          {!loading && loaded && items.length === 0 && (
            <p className="text-[11px] text-slate-500 text-center py-6">
              {activeQuery ? 'Sin consultas para esta búsqueda' : 'Aún no hay consultas guardadas'}
            </p>
          )}

          {items.length > 0 && (
            <div className="space-y-1.5">
              {items.map((it) => {
                const isOpen = expandedId === it.id
                const failed = it.retcode != null && it.retcode !== 0
                return (
                  <div key={it.id} className="rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-hover)] overflow-hidden">
                    {/* Fila resumen */}
                    <button
                      onClick={() => toggleRow(it)}
                      className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-[var(--c-card)]/40 transition-colors"
                    >
                      {it.kind === 'contacto'
                        ? <UserRound size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
                        : <Building2 size={14} className="text-purple-400 flex-shrink-0 mt-0.5" />}

                      <div className="flex-1 min-w-0">
                        {it.kind === 'contacto' ? (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-semibold text-slate-100 truncate">
                                {it.nombre_titular || 'Sin nombre'}
                              </p>
                              <span className="text-[10px] font-mono text-slate-400">
                                {it.rut_num.toLocaleString('es-CL')}-{it.rut_dv}
                              </span>
                              {failed && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-950/40 text-red-400 border border-red-900/40">
                                  error {it.retcode}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 mt-1 flex-wrap text-[10px] text-slate-500">
                              <span className="inline-flex items-center gap-1"><Clock size={10} /> {formatFecha(it.updated_at)}</span>
                              {it.phones_n > 0 && <span className="inline-flex items-center gap-1"><Phone size={10} /> {it.phones_n}</span>}
                              {it.emails_n > 0 && <span className="inline-flex items-center gap-1"><Mail size={10} /> {it.emails_n}</span>}
                              {it.addresses_n > 0 && <span className="inline-flex items-center gap-1"><MapPin size={10} /> {it.addresses_n}</span>}
                              {it.relacionados_n > 0 && <span className="inline-flex items-center gap-1"><Users size={10} /> {it.relacionados_n}</span>}
                              {it.portal_url && <span className="inline-flex items-center gap-1 text-blue-400/80"><ExternalLink size={10} /> propiedad</span>}
                              {it.notes && <span className="inline-flex items-center gap-1 text-amber-400/80"><StickyNote size={10} /> nota</span>}
                            </div>
                            {it.products_requested.length > 0 && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {it.products_requested.map((code) => (
                                  <span key={code} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900/40 text-slate-400 border border-slate-800/50">
                                    {PRODUCT_LABELS[code] ?? code}
                                  </span>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950/40 text-purple-300 border border-purple-900/40 uppercase tracking-wide">
                                {it.tipbusq_label}
                              </span>
                              <p className="text-xs font-semibold text-slate-100 truncate">{it.args}</p>
                              {failed && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-950/40 text-red-400 border border-red-900/40">
                                  error {it.retcode}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 mt-1 flex-wrap text-[10px] text-slate-500">
                              <span className="inline-flex items-center gap-1"><Clock size={10} /> {formatFecha(it.updated_at)}</span>
                              <span className="inline-flex items-center gap-1"><Users size={10} /> {it.candidatos_n} candidato{it.candidatos_n === 1 ? '' : 's'}</span>
                              <span className="text-slate-600">Buscador Múltiple</span>
                            </div>
                          </>
                        )}
                      </div>
                      {isOpen
                        ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0 mt-0.5" />
                        : <ChevronRight size={14} className="text-slate-500 flex-shrink-0 mt-0.5" />}
                    </button>

                    {/* Detalle */}
                    {isOpen && (
                      <div className="px-3 pb-3">
                        {detailLoading === it.id && (
                          <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-slate-500">
                            <Loader2 size={14} className="animate-spin" /> Cargando detalle…
                          </div>
                        )}
                        {detailError[it.id] && (
                          <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/50 rounded-lg p-2 text-[11px] text-red-300">
                            <AlertCircle size={12} className="flex-shrink-0" />
                            {detailError[it.id]}
                          </div>
                        )}

                        {/* Ficha completa (consulta por RUT) */}
                        {it.kind === 'contacto' && contactoDetails[it.id] && (
                          <ContactoFicha detail={contactoDetails[it.id]} />
                        )}

                        {/* Candidatos (Buscador Múltiple) */}
                        {it.kind === 'busqueda' && busquedaDetails[it.id] && (
                          <BusquedaCandidatos detail={busquedaDetails[it.id]} />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ContactoFicha({ detail }: { detail: ContactoDetail }) {
  return (
    <div className="space-y-2">
      {/* Metadatos de la consulta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500 pt-1">
        <span>Consultada: <span className="text-slate-400">{formatFecha(detail.created_at)}</span></span>
        {detail.updated_at !== detail.created_at && (
          <span>Actualizada: <span className="text-slate-400">{formatFecha(detail.updated_at)}</span></span>
        )}
        {detail.sii_rol && (
          <span>Rol: <span className="text-slate-400 font-mono">{detail.sii_rol}</span></span>
        )}
      </div>

      {/* Servicios consultados */}
      {detail.products_requested.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-slate-500">Servicios:</span>
          {detail.products_requested.map((code) => (
            <span key={code} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900/40 text-slate-400 border border-slate-800/50">
              {PRODUCT_LABELS[code] ?? code}
            </span>
          ))}
        </div>
      )}

      {/* Link de la propiedad */}
      {detail.portal_url && (
        <a
          href={detail.portal_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300 max-w-full"
        >
          <ExternalLink size={10} className="flex-shrink-0" />
          <span className="truncate">{detail.portal_url}</span>
        </a>
      )}

      {/* Notas */}
      {detail.notes && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 bg-amber-950/20 border border-amber-900/30 rounded-lg px-2 py-1.5">
          <StickyNote size={10} className="flex-shrink-0 mt-0.5" />
          <span>{detail.notes}</span>
        </div>
      )}

      <ResultCard result={detail} />
    </div>
  )
}

const PROB_BADGE: Record<string, string> = {
  Alta: 'bg-green-950/40 text-green-400 border border-green-900/40',
  Media: 'bg-amber-950/40 text-amber-400 border border-amber-900/40',
  Baja: 'bg-slate-900/40 text-slate-500 border border-slate-800/50',
}

function BusquedaCandidatos({ detail }: { detail: BusquedaDetail }) {
  return (
    <div className="space-y-2 pt-2 border-t border-[var(--c-border-card)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span>{detail.tipbusq_label}: <span className="text-slate-300">{detail.args}</span></span>
        <span>Consultada: <span className="text-slate-400">{formatFecha(detail.created_at)}</span></span>
      </div>

      {detail.candidatos.length === 0 ? (
        <p className="text-[11px] text-slate-500 text-center py-2">Sin candidatos para esta búsqueda</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Candidatos <span className="text-slate-600">({detail.candidatos.length})</span>
          </p>
          {detail.candidatos.map((c, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-hover)] px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-200 font-medium truncate">
                  {c.razonSocial || `${c.nombres ?? ''} ${c.apellidos ?? ''}`.trim() || 'Sin nombre'}
                </p>
                <p className="text-[10px] text-slate-500">
                  {c.rut != null ? `RUT ${c.rut.toLocaleString('es-CL')}${c.dv ? `-${c.dv}` : ''}` : 'Sin RUT'}
                  {c.propietario ? ` · ${c.propietario}` : ''}
                </p>
              </div>
              {c.probabilidad && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${PROB_BADGE[c.probabilidad] ?? PROB_BADGE.Baja}`}>
                  {c.probabilidad}{c.similitud != null ? ` ${c.similitud}%` : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
