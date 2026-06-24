'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import nextDynamicImport from 'next/dynamic'
import Link from 'next/link'
import {
  Search, ChevronDown, ChevronLeft, ChevronRight,
  X, Database, Upload, MapPin, Building2, TrendingUp,
  BarChart3, RefreshCw, ExternalLink, Filter, Layers, ToggleRight, Clock,
  Phone, MessageCircle
} from 'lucide-react'
import { MOCK_LISTING_PINS, type CadastreListingPin } from '@/lib/mock-chile-cadastre'
import { formatCLP, formatUF, getUFValue } from '@/lib/currency-formatter'
import { useCadastreParcels } from '@/lib/use-cadastre-parcels'
import { useSiiRolePins } from '@/lib/use-sii-role-pins'
import SurfaceDistributionBar from '@/components/SurfaceDistributionBar'
import type { DrawnShape } from '@/components/map/CadastreMap'

const CadastreMap = nextDynamicImport(() => import('@/components/map/CadastreMap'), { ssr: false })

const CONFIDENCE_LABEL: Record<CadastreListingPin['location_confidence'], string> = {
  confirmed: 'Confirmado (catastro)',
  candidate: 'Candidato',
  pin_suspect: 'Pin sospechoso',
  none: 'Sin resolver',
}

const CONFIDENCE_COLOR: Record<CadastreListingPin['location_confidence'], string> = {
  confirmed: '#22c55e',
  candidate: '#f59e0b',
  pin_suspect: '#ef4444',
  none: '#94a3b8',
}

const LAYER_TABS = [
  { id: 'catastro', label: 'Catastro' },
  { id: 'oferta', label: 'Oferta' },
  { id: 'ventas', label: 'Ventas' },
] as const
type LayerTab = (typeof LAYER_TABS)[number]['id']

// SII destination code labels
const DESTINO_LABELS: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  A: 'Agrícola', B: 'Agroindustrial', D: 'Deporte/Recreación',
  E: 'Educación', F: 'Forestal', G: 'Hotel/Motel', L: 'Bodega',
  M: 'Minería', P: 'Administración Pública', Q: 'Culto',
  S: 'Salud', T: 'Transporte', V: 'Otros', W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

// Clases de material según resolución SII (verificado externamente; el código
// "D" y los códigos de condición especial no están documentados públicamente,
// por eso no se incluyen — se muestra el código crudo en esos casos).
const MATERIAL_LABELS: Record<string, string> = {
  A: 'Acero',
  B: 'Hormigón armado',
  C: 'Albañilería (ladrillo, piedra o bloque de cemento)',
  E: 'Madera',
}

const CALIDAD_LABELS: Record<string, string> = {
  '1': 'Superior',
  '2': 'Media superior',
  '3': 'Media',
  '4': 'Media inferior',
  '5': 'Inferior',
}

const DESTINO_OPTIONS = Object.entries(DESTINO_LABELS).map(([value, label]) => ({ value, label }))

const UBICACION_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'U', label: 'Urbano' },
  { value: 'R', label: 'Rural' },
]

const SORT_OPTIONS = [
  { value: 'avaluo_desc', label: 'Mayor avalúo' },
  { value: 'avaluo_asc', label: 'Menor avalúo' },
  { value: 'superficie_desc', label: 'Mayor superficie' },
  { value: 'rol_asc', label: 'Rol (A-Z)' },
]

const ZONES = [
  { id: 'vitacura',      label: 'Vitacura',     group: 'Barrio alto RM', center: { lat: -33.3895, lng: -70.5979 }, comuna: 'Vitacura',    siiCode: '15160', hasData: true  },
  { id: 'las-condes',   label: 'Las Condes',   group: 'Barrio alto RM', center: { lat: -33.4095, lng: -70.5677 }, comuna: 'Las Condes',  siiCode: '15108', hasData: true  },
  { id: 'lo-barnechea', label: 'Lo Barnechea', group: 'Barrio alto RM', center: { lat: -33.3504, lng: -70.5167 }, comuna: 'Lo Barnechea',siiCode: '15161', hasData: true  },
  { id: 'colina',       label: 'Colina',        group: 'Barrio alto RM', center: { lat: -33.2007, lng: -70.6769 }, comuna: 'Colina',      siiCode: '14201', hasData: true  },
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
  return formatCLP(n)
}

export default function CatastroPage() {
  const [zoneId, setZoneId] = useState<ZoneId>('vitacura')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const zone = ZONES.find((z) => z.id === zoneId)!

  // Search & filter state
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [destinos, setDestinos] = useState<string[]>([])
  const [destinoDropdownOpen, setDestinoDropdownOpen] = useState(false)
  const [sort, setSort] = useState<SortKey>('avaluo_desc')
  const [page, setPage] = useState(1)
  // Filtros avanzados (avalúo, superficie, ubicación)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [avaluoMinInput, setAvaluoMinInput] = useState('')
  const [avaluoMaxInput, setAvaluoMaxInput] = useState('')
  const [avaluoMin, setAvaluoMin] = useState('')
  const [avaluoMax, setAvaluoMax] = useState('')
  const [superficieMinInput, setSuperficieMinInput] = useState('')
  const [superficieMaxInput, setSuperficieMaxInput] = useState('')
  const [superficieMin, setSuperficieMin] = useState('')
  const [superficieMax, setSuperficieMax] = useState('')
  const [ubicacion, setUbicacion] = useState('')

  // Currency display state
  const [showUF, setShowUF] = useState(false)

  // Data state
  const [stats, setStats] = useState<any>(null)
  const [roles, setRoles] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selectedRol, setSelectedRol] = useState<any>(null)
  const [rolDetail, setRolDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // DealerNet (contactabilidad / directorio teléfonos del propietario)
  const [dealernetContact, setDealernetContact] = useState<any>(null)
  const [dealernetPhones, setDealernetPhones] = useState<any[]>([])
  const [dealernetLoading, setDealernetLoading] = useState(false)
  const [dealernetError, setDealernetError] = useState<string | null>(null)
  const [dealernetRutInput, setDealernetRutInput] = useState('')
  // Building units state
  const [buildingUnits, setBuildingUnits] = useState<any[]>([])
  const [buildingUnitsLoading, setBuildingUnitsLoading] = useState(false)
  const [showBuildingUnits, setShowBuildingUnits] = useState(false)
  // Filter by building
  const [filterRolPadre, setFilterRolPadre] = useState<string | null>(null)
  // Layer tab: Catastro (roles SII) / Oferta (anuncios) / Ventas (próximamente, requiere CBR)
  const [layerTab, setLayerTab] = useState<LayerTab>('catastro')
  // Drawn zone (polygon/circle/rectangle) + record count within it
  const [drawnShape, setDrawnShape] = useState<DrawnShape | null>(null)
  const [zoneCount, setZoneCount] = useState<number | null>(null)
  const [zoneCountLoading, setZoneCountLoading] = useState(false)

  const PAGE_SIZE = 50

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // Debounce numeric range filters
  useEffect(() => {
    const t = setTimeout(() => setAvaluoMin(avaluoMinInput.trim()), 350)
    return () => clearTimeout(t)
  }, [avaluoMinInput])
  useEffect(() => {
    const t = setTimeout(() => setAvaluoMax(avaluoMaxInput.trim()), 350)
    return () => clearTimeout(t)
  }, [avaluoMaxInput])
  useEffect(() => {
    const t = setTimeout(() => setSuperficieMin(superficieMinInput.trim()), 350)
    return () => clearTimeout(t)
  }, [superficieMinInput])
  useEffect(() => {
    const t = setTimeout(() => setSuperficieMax(superficieMaxInput.trim()), 350)
    return () => clearTimeout(t)
  }, [superficieMaxInput])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [zoneId, destinos, sort, filterRolPadre, avaluoMin, avaluoMax, superficieMin, superficieMax, ubicacion])

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
    })
    if (search) params.set('q', search)
    if (destinos.length > 0) params.set('destino', destinos.join(','))
    if (filterRolPadre) params.set('rol_padre', filterRolPadre)
    if (avaluoMin) params.set('avaluo_min', avaluoMin)
    if (avaluoMax) params.set('avaluo_max', avaluoMax)
    if (superficieMin) params.set('superficie_min', superficieMin)
    if (superficieMax) params.set('superficie_max', superficieMax)
    if (ubicacion) params.set('ubicacion', ubicacion)
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
  }, [zone.siiCode, page, search, destinos, sort, filterRolPadre, avaluoMin, avaluoMax, superficieMin, superficieMax, ubicacion])

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

  // Fetch contacto DealerNet ya guardado para este rol (cache — no vuelve a
  // golpear el web service hasta que el usuario pida "Actualizar")
  useEffect(() => {
    setDealernetContact(null)
    setDealernetPhones([])
    setDealernetError(null)
    setDealernetRutInput('')
    if (!selectedRol || !zone.siiCode) return
    fetch(`/api/chile/dealernet-lookup?sii_rol=${encodeURIComponent(selectedRol.rol)}&sii_comuna_code=${zone.siiCode}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.contact) {
          setDealernetContact(d.contact)
          setDealernetPhones(d.phones ?? [])
        }
      })
      .catch(() => {})
  }, [selectedRol, zone.siiCode])

  const searchDealernet = useCallback((rutOverride?: string) => {
    if (!selectedRol || !zone.siiCode) return
    const rut = (rutOverride ?? dealernetRutInput).trim()
    if (!rut) return
    setDealernetLoading(true)
    setDealernetError(null)
    fetch('/api/chile/dealernet-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut, sii_rol: selectedRol.rol, sii_comuna_code: zone.siiCode }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setDealernetContact({ nombre_titular: d.nombre_titular, retcode: d.retcode, retmsg: d.retmsg })
          setDealernetPhones(d.phones ?? [])
        } else {
          setDealernetError(d.error ?? 'Error consultando DealerNet')
        }
      })
      .catch(() => setDealernetError('Error de red consultando DealerNet'))
      .finally(() => setDealernetLoading(false))
  }, [selectedRol, zone.siiCode, dealernetRutInput])

  // Fetch building units when user clicks "Ver departamentos"
  const loadBuildingUnits = useCallback((rolPadre: string) => {
    if (!zone.siiCode) return
    setBuildingUnitsLoading(true)
    setBuildingUnits([])
    setShowBuildingUnits(true)
    fetch(`/api/chile/sii-building-units?sii_comuna_code=${zone.siiCode}&rol_padre=${encodeURIComponent(rolPadre)}`)
      .then(r => r.json())
      .then(d => { if (d.success) setBuildingUnits(d.units) })
      .catch(() => {})
      .finally(() => setBuildingUnitsLoading(false))
  }, [zone.siiCode])

  // Count SII roles within a drawn zone (polygon/circle/rectangle)
  useEffect(() => {
    if (!drawnShape || !zone.siiCode) { setZoneCount(null); return }
    const controller = new AbortController()
    setZoneCountLoading(true)
    fetch('/api/chile/sii-roles-in-zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sii_comuna_code: zone.siiCode, shape: drawnShape }),
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(d => { if (d.success) setZoneCount(d.count) })
      .catch(() => setZoneCount(null))
      .finally(() => setZoneCountLoading(false))
    return () => controller.abort()
  }, [drawnShape, zone.siiCode])

  const { parcels } = useCadastreParcels(zone.siiCode, zone.comuna)
  const { rolePoints } = useSiiRolePins(zone.siiCode)
  const allPins = useMemo(() => MOCK_LISTING_PINS.filter((p) => p.comuna === zone.comuna), [zone.comuna])
  const pins = layerTab === 'catastro' ? allPins : []
  const activeRolePoints = layerTab === 'catastro' ? rolePoints : []

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  const toggleDestino = (value: string) => {
    setDestinos(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  const hasAdvancedFilters = !!(avaluoMinInput || avaluoMaxInput || superficieMinInput || superficieMaxInput || ubicacion)
  const hasAnyFilter = destinos.length > 0 || hasAdvancedFilters || !!filterRolPadre

  const clearAllFilters = () => {
    setDestinos([])
    setAvaluoMinInput(''); setAvaluoMaxInput('')
    setAvaluoMin(''); setAvaluoMax('')
    setSuperficieMinInput(''); setSuperficieMaxInput('')
    setSuperficieMin(''); setSuperficieMax('')
    setUbicacion('')
    setFilterRolPadre(null)
  }

  // Helper to render currency with optional dual display
  const renderCurrency = (value: number | null) => {
    if (!value) return '—'
    if (showUF) {
      return formatUF(value, 2)
    }
    return formatCLP(value)
  }

  // Helper to render currency with both units for detail views
  const renderCurrencyDual = (value: number | null) => {
    if (!value) return '—'
    const clp = formatCLP(value)
    const uf = formatUF(value, 2)
    return (
      <div className="flex flex-col gap-0.5">
        <span className={showUF ? 'text-blue-400 font-semibold' : 'text-slate-300'}>{showUF ? uf : clp}</span>
        <span className={`text-[10px] ${showUF ? 'text-slate-500' : 'text-slate-600'}`}>{showUF ? clp : uf}</span>
      </div>
    )
  }

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

          {/* Layer tabs */}
          <div className="flex-none flex items-center gap-1 px-3 pt-2.5">
            {LAYER_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setLayerTab(t.id)}
                className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                  layerTab === t.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-[var(--c-card)] border-[var(--c-border-card)] text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {layerTab === 'catastro' && (
          <>
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
              <div className="relative flex-1">
                <button
                  type="button"
                  onClick={() => setDestinoDropdownOpen(v => !v)}
                  disabled={!zone.hasData}
                  className="w-full flex items-center gap-1.5 text-xs bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg px-2 py-1.5 text-slate-400 focus:outline-none focus:border-blue-600/50 disabled:opacity-40 hover:border-blue-600/30 transition-colors"
                >
                  <span className="flex-1 text-left truncate">
                    {destinos.length === 0 ? 'Todos los destinos' : destinos.length === 1 ? (DESTINO_LABELS[destinos[0]] ?? destinos[0]) : `${destinos.length} destinos`}
                  </span>
                  <ChevronDown size={11} className={`flex-shrink-0 transition-transform ${destinoDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {destinoDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1.5 z-50 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-xl shadow-xl shadow-black/40 p-1.5 w-[220px] max-h-64 overflow-y-auto">
                    {DESTINO_OPTIONS.map(o => (
                      <label key={o.value} className="flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:bg-[var(--c-surface)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={destinos.includes(o.value)}
                          onChange={() => toggleDestino(o.value)}
                          className="accent-blue-600"
                        />
                        <span className="font-mono text-slate-500">{o.value}</span>
                        {o.label}
                      </label>
                    ))}
                    {destinos.length > 0 && (
                      <button
                        onClick={() => setDestinos([])}
                        className="w-full mt-1 pt-1.5 border-t border-[var(--c-border-card)] text-[10px] text-slate-600 hover:text-slate-400 text-left px-2"
                      >
                        Limpiar destinos
                      </button>
                    )}
                  </div>
                )}
              </div>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                disabled={!zone.hasData}
                className="flex-1 text-xs bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg px-2 py-1.5 text-slate-400 focus:outline-none focus:border-blue-600/50 disabled:opacity-40"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setFiltersOpen(v => !v)}
                disabled={!zone.hasData}
                className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                  filtersOpen || hasAdvancedFilters
                    ? 'bg-blue-950/40 border-blue-900/50 text-blue-400'
                    : 'bg-[var(--c-card)] border-[var(--c-border-card)] text-slate-400 hover:border-blue-600/30'
                }`}
                title="Más filtros"
              >
                <Filter size={12} />
                {hasAdvancedFilters && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
              </button>
            </div>

            {filtersOpen && (
              <div className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)]/60 p-2 space-y-2">
                <div>
                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-semibold mb-1">Avalúo ({showUF ? 'UF' : 'CLP'})</p>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={avaluoMinInput}
                      onChange={e => setAvaluoMinInput(e.target.value)}
                      placeholder="Mín."
                      className="w-1/2 text-[11px] bg-[var(--c-bg)] border border-[var(--c-border-card)] rounded-lg px-2 py-1 text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50"
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      value={avaluoMaxInput}
                      onChange={e => setAvaluoMaxInput(e.target.value)}
                      placeholder="Máx."
                      className="w-1/2 text-[11px] bg-[var(--c-bg)] border border-[var(--c-border-card)] rounded-lg px-2 py-1 text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-semibold mb-1">Superficie (m²)</p>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={superficieMinInput}
                      onChange={e => setSuperficieMinInput(e.target.value)}
                      placeholder="Mín."
                      className="w-1/2 text-[11px] bg-[var(--c-bg)] border border-[var(--c-border-card)] rounded-lg px-2 py-1 text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50"
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      value={superficieMaxInput}
                      onChange={e => setSuperficieMaxInput(e.target.value)}
                      placeholder="Máx."
                      className="w-1/2 text-[11px] bg-[var(--c-bg)] border border-[var(--c-border-card)] rounded-lg px-2 py-1 text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-blue-600/50"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-semibold mb-1">Ubicación</p>
                  <select
                    value={ubicacion}
                    onChange={e => setUbicacion(e.target.value)}
                    className="w-full text-[11px] bg-[var(--c-bg)] border border-[var(--c-border-card)] rounded-lg px-2 py-1 text-slate-300 focus:outline-none focus:border-blue-600/50"
                  >
                    {UBICACION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Roles count + Currency toggle */}
          <div className="flex-none flex items-center justify-between px-3 py-1.5 border-b border-[var(--c-border-card)]">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <p className="text-[11px] text-slate-600">
                {total > 0 ? <><span className="text-slate-400 font-medium">{rangeStart}–{rangeEnd}</span> de <span className="text-slate-500">{total.toLocaleString('es-CL')}</span> roles</> : zone.hasData ? '0 roles' : 'Sin datos SII'}
              </p>
              {filterRolPadre && (
                <button
                  onClick={() => setFilterRolPadre(null)}
                  className="flex items-center gap-1 text-[10px] bg-purple-950/40 border border-purple-900/50 text-purple-400 px-1.5 py-0.5 rounded hover:bg-purple-950/60 transition-colors"
                >
                  <Layers size={9} />Edificio {filterRolPadre}<X size={9} />
                </button>
              )}
              {hasAnyFilter && (
                <button
                  onClick={clearAllFilters}
                  className="flex items-center gap-1 text-[10px] bg-slate-900/40 border border-slate-800/50 text-slate-500 px-1.5 py-0.5 rounded hover:text-slate-300 hover:bg-slate-900/60 transition-colors"
                >
                  <X size={9} />Limpiar filtros
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {loading && <RefreshCw size={11} className="text-slate-600 animate-spin" />}
              <button
                onClick={() => setShowUF(!showUF)}
                className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg border transition-colors ${
                  showUF
                    ? 'bg-blue-950/40 border-blue-900/50 text-blue-400'
                    : 'bg-slate-900/40 border-slate-800/50 text-slate-500 hover:text-slate-300'
                }`}
                title={`Mostrar en ${showUF ? 'CLP' : 'UF'} (1 UF ≈ ${getUFValue().toLocaleString('es-CL')} CLP)`}
              >
                <ToggleRight size={10} />
                {showUF ? 'UF' : 'CLP'}
              </button>
            </div>
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

                    {/* Propietario — el SII solo entrega el nombre (no RUT, no
                        teléfono). Para contactabilidad se consulta DealerNet por RUT
                        (ingresado a mano, ya que no hay búsqueda inversa por dirección
                        en su protocolo) y el resultado se guarda en BD para no repetir
                        la consulta cada vez que se abre la ficha. El Certificado de TGR
                        sigue de fallback manual (su formulario tiene reCAPTCHA). */}
                    <div>
                      <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Propietario</p>
                      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] px-3 py-2.5 space-y-2.5">
                        {rolDetail.rol?.nombre_propietario && (
                          <div>
                            <p className="text-[10px] text-slate-600">Nombre (SII)</p>
                            <p className="text-[11px] text-slate-300 font-medium">{rolDetail.rol.nombre_propietario}</p>
                          </div>
                        )}

                        {(dealernetContact?.nombre_titular) && (
                          <div>
                            <p className="text-[10px] text-slate-600">Titular (DealerNet)</p>
                            <p className="text-[11px] text-slate-300 font-medium">{dealernetContact.nombre_titular}</p>
                          </div>
                        )}

                        {dealernetPhones.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] text-slate-600">Teléfonos</p>
                            {dealernetPhones.map((p: any, i: number) => (
                              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                                <Phone size={11} className="text-slate-500 flex-shrink-0" />
                                <span className="font-mono text-slate-200">{p.phone_e164}</span>
                                {p.ind_whatsapp && <MessageCircle size={11} className="text-green-500 flex-shrink-0" aria-label="WhatsApp" />}
                                <span className={`text-[9px] px-1.5 py-0.5 rounded ${p.categoria === 'probable' ? 'bg-green-950/40 text-green-400 border border-green-900/40' : 'bg-slate-900/40 text-slate-500 border border-slate-800/50'}`}>
                                  {p.categoria === 'probable' ? 'probable' : 'alternativo'}
                                </span>
                                {p.clasificacion && (
                                  <span className="text-[9px] text-slate-600">{p.clasificacion === 'C' ? 'celular' : p.clasificacion === 'F' ? 'fijo' : p.clasificacion}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {dealernetError && (
                          <p className="text-[11px] text-red-400">{dealernetError}</p>
                        )}

                        <div className="flex items-center gap-1.5 pt-1">
                          <input
                            type="text"
                            value={dealernetRutInput}
                            onChange={(e) => setDealernetRutInput(e.target.value)}
                            placeholder="RUT propietario, ej. 12.345.678-9"
                            className="flex-1 text-[11px] bg-slate-900/40 border border-slate-800/50 rounded-lg px-2 py-1.5 text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-700"
                            onKeyDown={(e) => { if (e.key === 'Enter') searchDealernet() }}
                          />
                          <button
                            onClick={() => searchDealernet()}
                            disabled={dealernetLoading || !dealernetRutInput.trim()}
                            className="flex items-center gap-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                          >
                            {dealernetLoading ? <RefreshCw size={12} className="animate-spin" /> : <Phone size={12} />}
                            {dealernetContact ? 'Actualizar' : 'Buscar'}
                          </button>
                        </div>

                        <a
                          href="https://www.tgr.cl/tramites-tgr/certificado-de-deuda-de-contribuciones/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-400 hover:text-blue-300"
                        >
                          Consultar en TGR (Rol {rolDetail.rol?.rol ?? '—'}) <ExternalLink size={12} />
                        </a>
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
                            <div className="text-sm font-bold">
                              {renderCurrencyDual(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Distribución de superficies */}
                    {(rolDetail.rol?.superficie_terreno_m2 || rolDetail.construcciones?.length > 0) && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Distribución de superficies</p>
                        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-3">
                          <SurfaceDistributionBar
                            terrenoM2={rolDetail.rol?.superficie_terreno_m2 ?? null}
                            construcciones={rolDetail.construcciones ?? []}
                            destinoLabels={DESTINO_LABELS}
                          />
                        </div>
                      </div>
                    )}

                    {/* Construcciones */}
                    {rolDetail.construcciones?.length > 0 && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Construcciones ({rolDetail.construcciones.length})</p>
                        <div className="space-y-1.5">
                          {rolDetail.construcciones.map((c: any, i: number) => (
                            <div key={i} className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] px-3 py-2.5">
                              <div className="flex items-center gap-3">
                                <Building2 size={14} className="text-slate-600 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-slate-300 font-medium">{c.destino_code ? (DESTINO_LABELS[c.destino_code] ?? c.destino_code) : 'Sin destino'}</p>
                                  <p className="text-[10px] text-slate-600 mt-0.5">
                                    {[c.anio_construccion && `Año ${c.anio_construccion}`, c.numero_pisos && `${c.numero_pisos} pisos`].filter(Boolean).join(' · ')}
                                  </p>
                                </div>
                                {c.superficie_m2 && <p className="text-xs font-semibold text-slate-300 flex-shrink-0">{c.superficie_m2} m²</p>}
                              </div>
                              {(c.material_code || c.calidad_code || c.condicion_especial) && (
                                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[var(--c-border-card)]/40">
                                  {c.material_code && (
                                    <span className="text-[10px] bg-slate-900/40 border border-slate-800/50 text-slate-400 px-1.5 py-0.5 rounded">
                                      Material: {MATERIAL_LABELS[c.material_code] ?? c.material_code}
                                    </span>
                                  )}
                                  {c.calidad_code && (
                                    <span className="text-[10px] bg-slate-900/40 border border-slate-800/50 text-slate-400 px-1.5 py-0.5 rounded">
                                      Calidad: {CALIDAD_LABELS[c.calidad_code] ?? c.calidad_code}
                                    </span>
                                  )}
                                  {c.condicion_especial && (
                                    <span className="text-[10px] bg-amber-950/30 border border-amber-900/40 text-amber-500 px-1.5 py-0.5 rounded" title="Código SII sin etiqueta verificada públicamente">
                                      Cond. especial: {c.condicion_especial}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Ventas históricas — no disponible vía SII, requiere Conservador de Bienes Raíces */}
                    <div>
                      <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Ventas históricas</p>
                      <div className="rounded-xl border border-dashed border-[var(--c-border-card)] bg-[var(--c-card)]/50 px-3 py-4 text-center">
                        <span className="inline-block text-[10px] font-semibold bg-slate-800/60 text-slate-400 px-2 py-0.5 rounded mb-2">Próximamente</span>
                        <p className="text-[11px] text-slate-600">El historial de compraventas proviene del Conservador de Bienes Raíces, no del SII. Estamos evaluando fuentes de datos (ej. databam.cl) para incorporarlo.</p>
                      </div>
                    </div>

                    {/* Building links */}
                    {rolDetail.rol?.rol_padre && (
                      <div className="rounded-xl border border-purple-900/40 bg-purple-950/20 p-3">
                        <p className="text-[10px] text-purple-400 font-semibold mb-2 flex items-center gap-1.5">
                          <Layers size={11} />Esta unidad pertenece a un edificio
                        </p>
                        <p className="text-[11px] text-slate-500 mb-2">Rol padre: <span className="font-mono text-slate-300">{rolDetail.rol.rol_padre}</span></p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => loadBuildingUnits(rolDetail.rol.rol_padre)}
                            className="flex items-center gap-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <Layers size={12} />Ver todas las unidades del edificio
                          </button>
                        </div>
                      </div>
                    )}

                    {/* If this rol IS a building (no rol_padre but has bien_comun) */}
                    {!rolDetail.rol?.rol_padre && (rolDetail.rol?.rol_bien_comun_1 || rolDetail.rol?.rol_bien_comun_2) && (
                      <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 p-3">
                        <p className="text-[10px] text-blue-400 font-semibold mb-2 flex items-center gap-1.5">
                          <Building2 size={11} />Edificio con bienes comunes
                        </p>
                        <button
                          onClick={() => loadBuildingUnits(rolDetail.rol.rol)}
                          className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <Layers size={12} />Ver departamentos / unidades
                        </button>
                      </div>
                    )}

                    {/* Building units panel */}
                    {showBuildingUnits && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                            <Layers size={10} className="text-purple-400" />
                            Unidades del edificio {buildingUnits.length > 0 ? `(${buildingUnits.length})` : ''}
                          </p>
                          <button onClick={() => setShowBuildingUnits(false)} className="text-slate-600 hover:text-slate-400">
                            <X size={12} />
                          </button>
                        </div>
                        {buildingUnitsLoading ? (
                          <div className="text-center py-4 text-xs text-slate-700">Cargando unidades...</div>
                        ) : buildingUnits.length === 0 ? (
                          <div className="text-center py-4 text-xs text-slate-700">Sin unidades registradas</div>
                        ) : (
                          <div className="space-y-1 max-h-60 overflow-y-auto">
                            {buildingUnits.map((u: any) => (
                              <button
                                key={u.rol}
                                onClick={() => { setSelectedRol(u); setShowBuildingUnits(false) }}
                                className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] hover:border-purple-800/50 hover:bg-purple-950/20 transition-colors"
                              >
                                <Layers size={11} className="text-purple-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-mono text-blue-400">{u.rol}</p>
                                  <p className="text-[10px] text-slate-600 truncate">{u.direccion ?? '—'}</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className={`text-[11px] font-medium ${showUF ? 'text-blue-400' : 'text-slate-300'}`}>{renderCurrency(u.avaluo_fiscal_total)}</p>
                                  {u.superficie_terreno_m2 && <p className="text-[10px] text-slate-600">{u.superficie_terreno_m2} m²</p>}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
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
                      {roles.map((r, i) => {
                        const isUnit = !!r.rol_padre
                        const isBuilding = !r.rol_padre && r.codigo_destino_principal === 'H'
                        return (
                          <tr
                            key={r.rol}
                            onClick={() => { setSelectedRol(r); setShowBuildingUnits(false) }}
                            className={`border-b border-[var(--c-border-card)]/30 cursor-pointer hover:bg-[var(--c-active)] transition-colors ${i % 2 === 1 ? 'bg-[var(--c-card)]/30' : ''}`}
                          >
                            <td className="px-3 py-2 font-mono text-blue-400 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                {isUnit && <Layers size={9} className="text-purple-400 flex-shrink-0" aria-label="Unidad de edificio" />}
                                {r.rol}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-400 max-w-[160px] truncate">{r.direccion ?? '—'}</td>
                            <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${showUF ? 'text-blue-400' : 'text-slate-300'}`}>
                              {renderCurrency(r.avaluo_fiscal_total)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{r.superficie_terreno_m2 ?? '—'}</td>
                          </tr>
                        )
                      })}
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
          </>
          )}

          {layerTab === 'oferta' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <p className="text-[10px] text-slate-600 px-1">Anuncios de demostración — pendiente conexión a fuente de oferta en vivo (scraper Portalinmobiliario).</p>
              {allPins.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-slate-700 text-xs">Sin anuncios para {zone.label}</div>
              ) : (
                allPins.map((p) => (
                  <div key={p.id} className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] px-3 py-2.5">
                    <p className="text-xs font-medium text-slate-300">{p.title}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CONFIDENCE_COLOR[p.location_confidence] }} />
                      <span className="text-[10px] text-slate-500">{CONFIDENCE_LABEL[p.location_confidence]}</span>
                      {p.rol_matriz && <span className="text-[10px] text-slate-600 font-mono">Rol: {p.rol_matriz}</span>}
                      {p.agency_count > 1 && <span className="text-[10px] text-blue-400 font-medium">{p.agency_count} corredoras</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {layerTab === 'ventas' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <Clock size={32} className="text-slate-700" />
              <div className="max-w-xs">
                <span className="inline-block text-[10px] font-semibold bg-slate-800/60 text-slate-400 px-2 py-0.5 rounded mb-2">Próximamente</span>
                <p className="text-sm font-medium text-slate-500 mb-1">Historial de ventas</p>
                <p className="text-xs text-slate-700">El SII no publica compraventas ni propietarios — esos datos viven en el Conservador de Bienes Raíces. Estamos evaluando fuentes (ej. databam.cl) para incorporar esta capa.</p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: map */}
        <div className="flex-1 relative">
          <CadastreMap
            parcels={parcels}
            pins={pins}
            rolePoints={activeRolePoints}
            center={zone.center}
            zoom={15}
            highlightedParcelId={selectedRol?.matched_parcel_id || null}
            onMapClick={() => setSelectedRol(null)}
            onParcelClick={(parcel) => { if (parcel.rol) setSelectedRol({ rol: parcel.rol }) }}
            onRolePointClick={(point) => { if (point.rol) setSelectedRol({ rol: point.rol }) }}
            onShapeDrawn={setDrawnShape}
            zoneRecordCount={zoneCount}
            zoneRecordLoading={zoneCountLoading}
          />
        </div>
      </div>
    </div>
  )
}
