'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import nextDynamicImport from 'next/dynamic'
import Link from 'next/link'
import {
  Search, ChevronDown, ChevronLeft, ChevronRight,
  X, Database, Upload, MapPin, Building2, TrendingUp,
  BarChart3, RefreshCw, ExternalLink, Filter
} from 'lucide-react'
import { MOCK_PARCELS, MOCK_LISTING_PINS } from '@/lib/mock-chile-cadastre'

const CadastreMap = nextDynamicImport(() => import('@/components/map/CadastreMap'), { ssr: false })

// SII destination code labels
const DESTINO_LABELS: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  A: 'Agrícola', B: 'Agroindustrial', D: 'Deporte/Recreación',
  E: 'Educación', F: 'Forestal', G: 'Hotel/Motel', L: 'Bodega',
  M: 'Minería', P: 'Administración Pública', Q: 'Culto',
  S: 'Salud', T: 'Transporte', V: 'Otros', W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

const DESTINO_OPTIONS = [
  { value: '', label: 'Todos los destinos' },
  { value: 'H', label: 'Habitacional' },
  { value: 'C', label: 'Comercio' },
  { value: 'O', label: 'Oficina' },
  { value: 'I', label: 'Industria' },
  { value: 'W', label: 'Sitio eriazo' },
  { value: 'Z', label: 'Estacionamiento' },
]

const SORT_OPTIONS = [
  { value: 'avaluo_desc', label: 'Mayor avalúo' },
  { value: 'avaluo_asc', label: 'Menor avalúo' },
  { value: 'superficie_desc', label: 'Mayor superficie' },
  { value: 'rol_asc', label: 'Rol (A-Z)' },
]

const ZONES = [
  { id: 'vitacura',      label: 'Vitacura',     group: 'Barrio alto RM', center: { lat: -33.3895, lng: -70.5979 }, comuna: 'Vitacura',    siiCode: '15131', hasData: true  },
  { id: 'las-condes',   label: 'Las Condes',   group: 'Barrio alto RM', center: { lat: -33.4095, lng: -70.5677 }, comuna: 'Las Condes',  siiCode: '15108', hasData: true  },
  { id: 'lo-barnechea', label: 'Lo Barnechea', group: 'Barrio alto RM', center: { lat: -33.3504, lng: -70.5167 }, comuna: 'Lo Barnechea',siiCode: '15111', hasData: true  },
  { id: 'colina',       label: 'Colina',        group: 'Barrio alto RM', center: { lat: -33.2007, lng: -70.6769 }, comuna: 'Colina',      siiCode: '13301', hasData: true  },
  { id: 'providencia',  label: 'Providencia',  group: 'Barrio alto RM', center: { lat: -33.4320, lng: -70.6145 }, comuna: 'Providencia', siiCode: null,    hasData: false },
  { id: 'la-reina',     label: 'La Reina',     group: 'Barrio alto RM', center: { lat: -33.4479, lng: -70.5458 }, comuna: 'La Reina',    siiCode: null,    hasData: false },
  { id: 'nunoa',        label: 'Ñuñoa',        group: 'Barrio alto RM', center: { lat: -33.4574, lng: -70.5962 }, comuna: 'Ñuñoa',       siiCode: null,    hasData: false },
  { id: 'zapallar',     label: 'Zapallar',     group: 'Vacaciones',     center: { lat: -32.5538, lng: -71.4633 }, comuna: 'Zapallar',    siiCode: null,    hasData: false },
  { id: 'maitencillo',  label: 'Maitencillo',  group: 'Vacaciones',     center: { lat: -32.6421, lng: -71.4167 }, comuna: 'Puchuncaví',  siiCode: null,    hasData: false },
  { id: 'pucon',        label: 'Pucón',        group: 'Vacaciones',     center: { lat: -39.2772, lng: -71.9788 }, comuna: 'Pucón',       siiCode: null,    hasData: false },
  { id: 'villarrica',   label: 'Villarrica',   group: 'Vacaciones',     center: { lat: -39.2803, lng: -72.2267 }, comuna: 'Villarrica',  siiCode: null,    hasData: false },
] as const

type ZoneId = (typeof ZONES)[number]['id']
type SortKey = 'avaluo_desc' | 'avaluo_asc' | 'superficie_desc' | 'rol_asc'

function fmtCLP(n: number | null) {
  if (!n) return '—'
  if (n >= 1_000_000_000) return `$${(n/1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${Math.round(n/1_000_000)}M`
  return `$${n.toLocaleString('es-CL')}`
}

export default function CatastroPage() {
  const [zoneId, setZoneId] = useState<ZoneId>('vitacura')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const zone = ZONES.find((z) => z.id === zoneId)!

  // Search & filter state
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [destino, setDestino] = useState('')
  const [sort, setSort] = useState<SortKey>('avaluo_desc')
  const [page, setPage] = useState(1)

  // Data state
  const [stats, setStats] = useState<any>(null)
  const [roles, setRoles] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selectedRol, setSelectedRol] = useState<any>(null)
  const [rolDetail, setRolDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const PAGE_SIZE = 50

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [zoneId, destino, sort])

  // Fetch stats
  useEffect(() => {
    if (!zone.siiCode) { setStats(null); return }
    fetch(`/api/chile/sii-stats?sii_comuna_code=${zone.siiCode}`)
      .then(r => r.json()).then(d => { if (d.success) setStats(d) }).catch(() => {})
  }, [zone.siiCode])

  // Fetch roles list
  useEffect(() => {
    if (!zone.siiCode) { setRoles([]); setTotal(0); return }
    const controller = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({
      sii_comuna_code: zone.siiCode,
      page: String(page),
      page_size: String(PAGE_SIZE),
      sort,
      serie: 'no_agricola',
    })
    if (search) params.set('q', search)
    if (destino) params.set('destino', destino)
    fetch(`/api/chile/sii-roles-list?${params}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setRoles(d.data)
          setTotal(d.total)
          setTotalPages(d.total_pages)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [zone.siiCode, page, search, destino, sort])

  // Fetch rol detail
  useEffect(() => {
    if (!selectedRol || !zone.siiCode) { setRolDetail(null); return }
    setDetailLoading(true)
    fetch(`/api/chile/sii-rol-detail?sii_comuna_code=${zone.siiCode}&rol=${encodeURIComponent(selectedRol.rol)}`)
      .then(r => r.json())
      .then(d => { if (d.success) setRolDetail(d) })
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }, [selectedRol, zone.siiCode])

  const parcels = useMemo(() => MOCK_PARCELS.filter((p) => p.comuna === zone.comuna), [zone.comuna])
  const pins = useMemo(() => MOCK_LISTING_PINS.filter((p) => p.comuna === zone.comuna), [zone.comuna])

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--c-bg)]">
      {/* ── Top bar ── */}
      <header className="flex-none flex items-center gap-3 px-4 py-2.5 border-b border-[var(--c-border-card)] bg-[var(--c-bg)]">
        <Link href="/chile" className="text-slate-600 hover:text-slate-400 transition-colors">
          <ChevronLeft size={16} />
        </Link>
        <div>
          <h1 className="text-sm font-semibold text-slate-200 leading-none">Catastro Chile</h1>
          <p className="text-[10px] text-slate-600 mt-0.5">Roles SII · IDE Chile · Triangulación</p>
        </div>

        <div className="w-px h-5 bg-[var(--c-border-card)] mx-1" />

        {/* Commune dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className="flex items-center gap-2 text-xs font-medium bg-[var(--c-card)] border border-[var(--c-border-card)] text-slate-200 px-3 py-1.5 rounded-lg hover:border-blue-600/40 transition-colors min-w-[140px]"
          >
            {zone.hasData && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            {zone.label}
            <ChevronDown size={12} className={`ml-auto transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {dropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-50 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-xl shadow-xl shadow-black/40 py-1.5 w-[180px]">
              {(['Barrio alto RM', 'Vacaciones'] as const).map(g => (
                <div key={g}>
                  <p className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">{g}</p>
                  {ZONES.filter(z => z.group === g).map(z => (
                    <button key={z.id} onClick={() => { setZoneId(z.id); setDropdownOpen(false); setSelectedRol(null) }}
                      className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors ${z.id === zoneId ? 'text-blue-400 bg-blue-950/30' : 'text-slate-400 hover:text-slate-200 hover:bg-[var(--c-surface)]'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${z.hasData ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                      {z.label}
                      {z.hasData && <span className="ml-auto text-[9px] text-emerald-500 font-bold">SII</span>}
                    </button>
                  ))}
                </div>
              ))}
              <div className="border-t border-[var(--c-border-card)] mt-1.5 pt-1.5 px-3 pb-1">
                <Link href="/settings" onClick={() => setDropdownOpen(false)} className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors">
                  <Upload size={10} />Subir más comunas SII
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Quick stats in header */}
        {stats && (
          <>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-card)] border border-[var(--c-border-card)]">
              <Database size={12} className="text-emerald-400" />
              <span className="text-xs font-semibold text-slate-200">{Number(stats.total_roles).toLocaleString('es-CL')}</span>
              <span className="text-[10px] text-slate-600">roles</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-card)] border border-[var(--c-border-card)]">
              <Building2 size={12} className="text-blue-400" />
              <span className="text-xs font-semibold text-slate-200">{Number(stats.habitacional).toLocaleString('es-CL')}</span>
              <span className="text-[10px] text-slate-600">habit.</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--c-card)] border border-[var(--c-border-card)]">
              <TrendingUp size={12} className="text-amber-400" />
              <span className="text-xs font-semibold text-slate-200">{fmtCLP(stats.avaluo_promedio)}</span>
              <span className="text-[10px] text-slate-600">avalúo prom.</span>
            </div>
          </>
        )}

        {!zone.hasData && (
          <Link href="/settings" className="flex items-center gap-1.5 ml-2 text-xs text-amber-400 border border-amber-900/50 bg-amber-950/20 px-3 py-1.5 rounded-lg hover:bg-amber-950/40 transition-colors">
            <Upload size={12} />Sin datos SII — subir archivos
          </Link>
        )}
      </header>

      {/* ── Body: left panel + map ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: roles panel */}
        <div className="w-[42%] flex flex-col border-r border-[var(--c-border-card)] overflow-hidden">

          {/* Search & filters */}
          <div className="flex-none px-3 py-2.5 border-b border-[var(--c-border-card)] space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={zone.hasData ? 'Buscar dirección, rol...' : 'Sin datos para esta comuna'}
                disabled={!zone.hasData}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50 disabled:opacity-40"
              />
              {searchInput && (
                <button onClick={() => { setSearchInput(''); setSearch('') }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <select
                value={destino}
                onChange={e => setDestino(e.target.value)}
                disabled={!zone.hasData}
                className="flex-1 text-xs bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg px-2 py-1.5 text-slate-400 focus:outline-none focus:border-blue-600/50 disabled:opacity-40"
              >
                {DESTINO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                disabled={!zone.hasData}
                className="flex-1 text-xs bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg px-2 py-1.5 text-slate-400 focus:outline-none focus:border-blue-600/50 disabled:opacity-40"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Roles count */}
          <div className="flex-none flex items-center justify-between px-3 py-1.5 border-b border-[var(--c-border-card)]">
            <p className="text-[11px] text-slate-600">
              {total > 0 ? <><span className="text-slate-400 font-medium">{rangeStart}–{rangeEnd}</span> de <span className="text-slate-500">{total.toLocaleString('es-CL')}</span> roles</> : zone.hasData ? '0 roles' : 'Sin datos SII'}
            </p>
            {loading && <RefreshCw size={11} className="text-slate-600 animate-spin" />}
          </div>

          {/* Roles table + detail */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {!zone.hasData ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Database size={32} className="text-slate-700" />
                <div>
                  <p className="text-sm font-medium text-slate-500 mb-1">{zone.label} no tiene datos SII</p>
                  <p className="text-xs text-slate-700 mb-4">Descarga el archivo plano en sii.cl y súbelo para ver los roles catastrales.</p>
                  <Link href="/settings" className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors mx-auto w-fit">
                    <Upload size={12} />Subir datos SII
                  </Link>
                </div>
              </div>
            ) : selectedRol ? (
              /* Detail panel */
              <div className="flex-1 overflow-y-auto">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--c-border-card)] sticky top-0 bg-[var(--c-bg)] z-10">
                  <button onClick={() => { setSelectedRol(null); setRolDetail(null) }} className="text-slate-500 hover:text-slate-300 transition-colors">
                    <ChevronLeft size={15} />
                  </button>
                  <span className="text-xs font-semibold text-slate-200">Rol {selectedRol.rol}</span>
                  <span className="ml-auto text-[10px] text-slate-600">{zone.label}</span>
                </div>
                {detailLoading ? (
                  <div className="flex items-center justify-center h-32 text-slate-700 text-xs">Cargando...</div>
                ) : rolDetail ? (
                  <div className="p-4 space-y-4">
                    {/* Main info */}
                    <div>
                      <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Información catastral</p>
                      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
                        {[
                          ['Rol', rolDetail.rol?.rol],
                          ['Dirección', rolDetail.rol?.direccion],
                          ['Destino', rolDetail.rol?.codigo_destino_principal ? `${rolDetail.rol.codigo_destino_principal} — ${DESTINO_LABELS[rolDetail.rol.codigo_destino_principal] ?? ''}` : null],
                          ['Ubicación', rolDetail.rol?.codigo_ubicacion === 'U' ? 'Urbano' : rolDetail.rol?.codigo_ubicacion === 'R' ? 'Rural' : null],
                          ['Sup. terreno', rolDetail.rol?.superficie_terreno_m2 ? `${rolDetail.rol.superficie_terreno_m2} m²` : null],
                          ['Serie', rolDetail.rol?.serie],
                        ].map(([label, value]) => value ? (
                          <div key={label as string} className="flex px-3 py-2 border-b border-[var(--c-border-card)]/40 last:border-0">
                            <span className="text-[11px] text-slate-600 w-28 flex-shrink-0">{label}</span>
                            <span className="text-[11px] text-slate-300 font-medium">{value}</span>
                          </div>
                        ) : null)}
                      </div>
                    </div>

                    {/* Avalúos */}
                    <div>
                      <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Avalúos fiscales</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: 'Total', value: rolDetail.rol?.avaluo_fiscal_total, color: 'text-slate-200' },
                          { label: 'Exento', value: rolDetail.rol?.avaluo_exento, color: 'text-slate-400' },
                          { label: 'Contrib. sem.', value: rolDetail.rol?.contribucion_semestral, color: 'text-amber-300' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="rounded-lg bg-[var(--c-card)] border border-[var(--c-border-card)] p-2.5">
                            <p className="text-[10px] text-slate-600 mb-1">{label}</p>
                            <p className={`text-sm font-bold ${color}`}>{fmtCLP(value)}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Construcciones */}
                    {rolDetail.construcciones?.length > 0 && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Construcciones ({rolDetail.construcciones.length})</p>
                        <div className="space-y-1.5">
                          {rolDetail.construcciones.map((c: any, i: number) => (
                            <div key={i} className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] px-3 py-2.5 flex items-center gap-3">
                              <Building2 size={14} className="text-slate-600 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-300 font-medium">{c.destino ?? 'Sin destino'}</p>
                                <p className="text-[10px] text-slate-600 mt-0.5">
                                  {[c.anio_construccion && `Año ${c.anio_construccion}`, c.numero_pisos && `${c.numero_pisos} pisos`, c.calidad && c.calidad].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                              {c.superficie_m2 && <p className="text-xs font-semibold text-slate-300 flex-shrink-0">{c.superficie_m2} m²</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : <div className="flex items-center justify-center h-32 text-slate-700 text-xs">Sin datos</div>}
              </div>
            ) : (
              /* Roles list */
              <div className="flex-1 overflow-y-auto">
                {loading && roles.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-slate-700 text-xs">Cargando roles...</div>
                ) : roles.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-slate-700 text-xs">Sin resultados</div>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-[var(--c-bg)] z-10">
                      <tr className="border-b border-[var(--c-border-card)] text-slate-600">
                        <th className="text-left px-3 py-2 font-medium">Rol</th>
                        <th className="text-left px-3 py-2 font-medium">Dirección</th>
                        <th className="text-right px-3 py-2 font-medium">Avalúo</th>
                        <th className="text-right px-3 py-2 font-medium">m²</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map((r, i) => (
                        <tr
                          key={r.rol}
                          onClick={() => setSelectedRol(r)}
                          className={`border-b border-[var(--c-border-card)]/30 cursor-pointer hover:bg-[var(--c-active)] transition-colors ${i % 2 === 1 ? 'bg-[var(--c-card)]/30' : ''}`}
                        >
                          <td className="px-3 py-2 font-mono text-blue-400 whitespace-nowrap">{r.rol}</td>
                          <td className="px-3 py-2 text-slate-400 max-w-[160px] truncate">{r.direccion ?? '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-300 font-medium whitespace-nowrap">{fmtCLP(r.avaluo_fiscal_total)}</td>
                          <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{r.superficie_terreno_m2 ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!selectedRol && totalPages > 1 && (
            <div className="flex-none flex items-center justify-between px-3 py-2 border-t border-[var(--c-border-card)]">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft size={13} />Anterior
              </button>
              <span className="text-[11px] text-slate-600">{page} / {totalPages.toLocaleString('es-CL')}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                Siguiente<ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: map */}
        <div className="flex-1 relative">
          <CadastreMap parcels={parcels} pins={pins} center={zone.center} zoom={15} />
        </div>
      </div>
    </div>
  )
}
