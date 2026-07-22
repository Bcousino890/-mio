'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Search, X, Store, Globe, ChevronDown } from 'lucide-react'

type Corredora = {
  id: string
  advertiser_id: string | null
  name: string | null
  phones: string[] | null
  web_propia_url: string | null
  crm_platform: string
  active_listings_count: number
  total_listings_seen: number
  comunas_operated: string[] | null
  avg_days_on_market: number | null
  exclusivity_ratio: number | null
}

type SortKey = 'stock' | 'total' | 'rotacion' | 'exclusividad' | 'nombre'

const SORT_LABELS: Record<SortKey, string> = {
  stock: 'Más stock activo',
  total: 'Más anuncios históricos',
  rotacion: 'Rotación más rápida',
  exclusividad: 'Mayor exclusividad',
  nombre: 'Nombre (A-Z)',
}

const CRM_LABELS: Record<string, string> = {
  convecta: 'Convecta',
  ofinet: 'Ofinet',
  other: 'Otro CRM',
  unknown: '—',
}

const CRM_COLORS: Record<string, string> = {
  convecta: 'bg-purple-900/40 text-purple-300 border-purple-700/40',
  ofinet: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40',
  other: 'bg-slate-700/60 text-slate-300 border-slate-600/40',
  unknown: 'bg-slate-800 text-slate-500 border-slate-700/40',
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}
function days(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)} d`
}

export default function CorredorasChileClient() {
  const [rows, setRows] = useState<Corredora[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [crm, setCrm] = useState('all')
  const [onlyWithWeb, setOnlyWithWeb] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('stock')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ sort: sortBy, page_size: '100' })
    if (search) params.append('q', search)
    if (crm !== 'all') params.append('crm_platform', crm)
    if (onlyWithWeb) params.append('only_with_web', 'true')

    fetch(`/api/chile/corredoras?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          setRows(data.data)
          setTotal(data.total)
        } else {
          setRows([]); setTotal(0)
        }
      })
      .catch(() => { setRows([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [search, crm, onlyWithWeb, sortBy])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 lg:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <Store className="text-amber-400" size={22} />
          <h1 className="text-xl font-bold text-slate-100">Corredoras</h1>
          <span className="text-xs text-slate-500">
            {loading ? 'cargando…' : `${total.toLocaleString('es-CL')} consolidadas`}
          </span>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Identidad consolidada por <code className="bg-slate-800 px-1 rounded">advertiser_id</code> de Mercado Libre,
          con stock activo, rotación y exclusividad aparente. Clic para ver su inventario.
        </p>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar corredora…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 pl-9 pr-8 py-2 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            {searchInput && (
              <button onClick={() => setSearchInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X size={14} />
              </button>
            )}
          </div>

          <select
            value={crm}
            onChange={e => setCrm(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-amber-500"
          >
            <option value="all">Todos los CRM</option>
            <option value="convecta">Convecta</option>
            <option value="ofinet">Ofinet</option>
            <option value="other">Otro</option>
            <option value="unknown">Sin detectar</option>
          </select>

          <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg cursor-pointer">
            <input type="checkbox" checked={onlyWithWeb} onChange={e => setOnlyWithWeb(e.target.checked)} className="w-3.5 h-3.5 rounded bg-slate-700 border-slate-600 text-amber-500" />
            Con web propia
          </label>

          <div className="relative">
            <button onClick={() => setShowSortMenu(!showSortMenu)} className="flex items-center gap-1 text-xs text-slate-300 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg hover:border-slate-600">
              {SORT_LABELS[sortBy]}
              <ChevronDown size={13} />
            </button>
            {showSortMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden min-w-[200px]">
                {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
                  <button key={key} onClick={() => { setSortBy(key); setShowSortMenu(false) }}
                    className={`block w-full text-left px-3 py-2 text-xs ${sortBy === key ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>
                    {SORT_LABELS[key]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700">
                  <th className="px-4 py-2.5 font-semibold">Corredora</th>
                  <th className="px-3 py-2.5 font-semibold">CRM</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Stock</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Histórico</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Rotación</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Exclusividad</th>
                  <th className="px-3 py-2.5 font-semibold">Comunas</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Cargando…</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Sin corredoras</td></tr>
                )}
                {rows.map(c => (
                  <tr key={c.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/chile/corredoras/${c.id}`} className="font-medium text-slate-100 hover:text-amber-400 capitalize">
                        {c.name || '(sin nombre)'}
                      </Link>
                      {c.web_propia_url && (
                        <a href={c.web_propia_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 ml-2 text-[11px] text-cyan-400 hover:text-cyan-300">
                          <Globe size={11} /> web
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border ${CRM_COLORS[c.crm_platform] ?? CRM_COLORS.unknown}`}>
                        {CRM_LABELS[c.crm_platform] ?? c.crm_platform}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-200 font-medium">{c.active_listings_count}</td>
                    <td className="px-3 py-3 text-right text-slate-400">{c.total_listings_seen}</td>
                    <td className="px-3 py-3 text-right text-slate-300">{days(c.avg_days_on_market)}</td>
                    <td className="px-3 py-3 text-right text-slate-300">{pct(c.exclusivity_ratio)}</td>
                    <td className="px-3 py-3 text-slate-400 text-xs max-w-[220px] truncate">
                      {(c.comunas_operated ?? []).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
