'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { Search, X, Store, Globe, ChevronDown, SlidersHorizontal, Building2, Layers } from 'lucide-react'

type Corredora = {
  id: string
  advertiser_id: string | null
  name: string | null
  logo_url: string | null
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

const CRM_LABELS: Record<string, string> = { convecta: 'Convecta', ofinet: 'Ofinet', other: 'Otro CRM', unknown: '—' }
const CRM_COLORS: Record<string, string> = {
  convecta: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  ofinet: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  other: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  unknown: 'bg-slate-700/40 text-slate-500 border-slate-700/40',
}

function pct(v: number | null): string { return v == null ? '—' : `${Math.round(v * 100)}%` }
function days(v: number | null): string { return v == null ? '—' : `${Math.round(v)} d` }

// Color de la barra/etiqueta de exclusividad según el ratio.
function exclColor(v: number | null): string {
  if (v == null) return 'bg-slate-600'
  if (v >= 0.8) return 'bg-emerald-500'
  if (v >= 0.4) return 'bg-amber-500'
  return 'bg-rose-500'
}

// Avatar de iniciales con color derivado del nombre (determinista).
const AVATAR_COLORS = ['bg-purple-600', 'bg-cyan-600', 'bg-amber-600', 'bg-emerald-600', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600']
function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}
function avatarColor(name: string | null): string {
  const s = name ?? ''
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/** Logo del portal si existe (y carga bien); si no, avatar de iniciales. */
function Avatar({ name, logoUrl, size = 36 }: { name: string | null; logoUrl: string | null; size?: number }) {
  const [errored, setErrored] = useState(false)
  if (logoUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name ?? 'Corredora'}
        onError={() => setErrored(true)}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0 bg-slate-700 border border-slate-600"
      />
    )
  }
  return (
    <div style={{ width: size, height: size }} className={`rounded-full flex items-center justify-center text-white font-semibold shrink-0 ${avatarColor(name)}`}>
      <span style={{ fontSize: size * 0.4 }}>{initials(name)}</span>
    </div>
  )
}

function SummaryTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center gap-3 bg-slate-800/60 border border-slate-700/70 rounded-xl px-4 py-3">
      <div className={`p-2 rounded-lg ${accent ?? 'bg-slate-700/60 text-slate-300'}`}>{icon}</div>
      <div>
        <div className="text-lg font-bold text-slate-100 leading-none">{value}</div>
        <div className="text-[11px] text-slate-500 mt-1">{label}</div>
      </div>
    </div>
  )
}

export default function CorredorasChileClient() {
  const [rows, setRows] = useState<Corredora[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [crm, setCrm] = useState('all')
  const [comuna, setComuna] = useState('')
  const [minStock, setMinStock] = useState<number | null>(null)
  const [onlyWithWeb, setOnlyWithWeb] = useState(false)
  const [onlyWithPhone, setOnlyWithPhone] = useState(false)
  const [minExclusivity, setMinExclusivity] = useState<number | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('stock')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilters, setShowFilters] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  useEffect(() => {
    setLoading(true)
    // Directorio: todas las corredoras de una sola vez (sin paginar). El cap
    // de la API es 5000 — acotado por advertisers únicos, no por anuncios.
    const params = new URLSearchParams({ sort: sortBy, page_size: '5000' })
    if (search) params.append('q', search)
    if (crm !== 'all') params.append('crm_platform', crm)
    if (comuna.trim()) params.append('comuna', comuna.trim())
    if (onlyWithWeb) params.append('only_with_web', 'true')
    // Por defecto la API solo trae corredoras con stock activo; para "todas de
    // verdad" (incluidas las que se quedaron sin anuncios activos) hay que
    // pedir explícitamente only_active=false.
    if (includeInactive) params.append('only_active', 'false')

    fetch(`/api/chile/corredoras?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) { setRows(data.data); setTotal(data.total) }
        else { setRows([]); setTotal(0) }
      })
      .catch(() => { setRows([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [search, crm, comuna, onlyWithWeb, includeInactive, sortBy])

  // minStock/minExclusivity/onlyWithPhone se filtran en cliente (el endpoint no
  // los expone como parámetro; el volumen ya es bajo al traer todas de una vez).
  const visible = useMemo(
    () => rows.filter(r =>
      (minStock == null || r.active_listings_count >= minStock) &&
      (minExclusivity == null || (r.exclusivity_ratio ?? 0) * 100 >= minExclusivity) &&
      (!onlyWithPhone || (r.phones?.length ?? 0) > 0)
    ),
    [rows, minStock, minExclusivity, onlyWithPhone]
  )

  const summary = useMemo(() => ({
    stock: visible.reduce((s, r) => s + (r.active_listings_count || 0), 0),
    conWeb: visible.filter(r => r.web_propia_url).length,
    conCrm: visible.filter(r => r.crm_platform === 'convecta' || r.crm_platform === 'ofinet').length,
  }), [visible])

  const activeFilterCount = (crm !== 'all' ? 1 : 0) + (comuna.trim() ? 1 : 0) + (minStock != null ? 1 : 0) + (onlyWithWeb ? 1 : 0)
    + (onlyWithPhone ? 1 : 0) + (minExclusivity != null ? 1 : 0) + (includeInactive ? 1 : 0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 lg:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400"><Store size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 leading-none">Corredoras</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              Consolidadas por <code className="bg-slate-800 px-1 rounded">advertiser_id</code> de Mercado Libre · stock, rotación y exclusividad
            </p>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
          <SummaryTile icon={<Store size={16} />} label="Corredoras" value={loading ? '…' : total.toLocaleString('es-CL')} accent="bg-amber-500/15 text-amber-400" />
          <SummaryTile icon={<Building2 size={16} />} label="Stock activo (suma)" value={loading ? '…' : summary.stock.toLocaleString('es-CL')} accent="bg-blue-500/15 text-blue-400" />
          <SummaryTile icon={<Globe size={16} />} label="Con web propia" value={loading ? '…' : String(summary.conWeb)} accent="bg-cyan-500/15 text-cyan-400" />
          <SummaryTile icon={<Layers size={16} />} label="CRM detectado" value={loading ? '…' : String(summary.conCrm)} accent="bg-purple-500/15 text-purple-400" />
        </div>

        {/* Search + toggle filtros */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text" placeholder="Buscar corredora por nombre…" value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 pl-9 pr-8 py-2 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            {searchInput && (
              <button onClick={() => setSearchInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X size={14} /></button>
            )}
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${activeFilterCount > 0 ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600'}`}>
            <SlidersHorizontal size={14} /> Filtros {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
          <div className="relative">
            <button onClick={() => setShowSortMenu(!showSortMenu)} className="flex items-center gap-1 text-sm text-slate-300 bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg hover:border-slate-600 whitespace-nowrap">
              {SORT_LABELS[sortBy]} <ChevronDown size={13} />
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

        {/* Filtros expandibles */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4 bg-slate-800/40 border border-slate-700/60 rounded-xl p-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">CRM</label>
              <select value={crm} onChange={e => setCrm(e.target.value)} className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-amber-500">
                <option value="all">Todos</option>
                <option value="convecta">Convecta</option>
                <option value="ofinet">Ofinet</option>
                <option value="other">Otro</option>
                <option value="unknown">Sin detectar</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Comuna donde opera</label>
              <input type="text" placeholder="ej. Las Condes" value={comuna} onChange={e => setComuna(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Stock mínimo</label>
              <input type="number" min={0} placeholder="ej. 5" value={minStock ?? ''} onChange={e => setMinStock(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Exclusividad mín. (%)</label>
              <input type="number" min={0} max={100} placeholder="ej. 50" value={minExclusivity ?? ''} onChange={e => setMinExclusivity(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-3 py-1.5 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer py-1.5">
                <input type="checkbox" checked={onlyWithWeb} onChange={e => setOnlyWithWeb(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" />
                Solo con web propia
              </label>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer py-1.5">
                <input type="checkbox" checked={onlyWithPhone} onChange={e => setOnlyWithPhone(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" />
                Solo con teléfono
              </label>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer py-1.5">
                <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-amber-500" />
                Incluir sin stock activo
              </label>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700 bg-slate-800/80">
                  <th className="px-4 py-2.5 font-semibold">Corredora</th>
                  <th className="px-3 py-2.5 font-semibold">CRM</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Stock</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Histórico</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Rotación</th>
                  <th className="px-3 py-2.5 font-semibold min-w-[140px]">Exclusividad</th>
                  <th className="px-3 py-2.5 font-semibold">Comunas</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-700/50 animate-pulse">
                    <td className="px-4 py-3.5" colSpan={7}><div className="h-4 bg-slate-700/50 rounded w-full" /></td>
                  </tr>
                ))}
                {!loading && visible.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Sin corredoras con esos filtros</td></tr>
                )}
                {!loading && visible.map(c => (
                  <tr key={c.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} logoUrl={c.logo_url} size={32} />
                        <div className="min-w-0">
                          <Link href={`/chile/corredoras/${c.id}`} className="font-medium text-slate-100 group-hover:text-amber-400 capitalize block truncate">
                            {c.name || '(sin nombre)'}
                          </Link>
                          {c.web_propia_url && (
                            <a href={c.web_propia_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300">
                              <Globe size={10} /> {c.web_propia_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border ${CRM_COLORS[c.crm_platform] ?? CRM_COLORS.unknown}`}>
                        {CRM_LABELS[c.crm_platform] ?? c.crm_platform}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right"><span className="text-slate-100 font-semibold">{c.active_listings_count}</span></td>
                    <td className="px-3 py-3 text-right text-slate-400">{c.total_listings_seen}</td>
                    <td className="px-3 py-3 text-right text-slate-300">{days(c.avg_days_on_market)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden min-w-[48px]">
                          <div className={`h-full ${exclColor(c.exclusivity_ratio)}`} style={{ width: `${Math.round((c.exclusivity_ratio ?? 0) * 100)}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 w-9 text-right">{pct(c.exclusivity_ratio)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-400 text-xs max-w-[200px] truncate">{(c.comunas_operated ?? []).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {!loading && <p className="text-[11px] text-slate-600 mt-2">{visible.length} mostradas{minStock != null && ` · stock ≥ ${minStock}`}</p>}
      </div>
    </div>
  )
}
