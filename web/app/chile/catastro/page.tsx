'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import nextDynamicImport from 'next/dynamic'
import Link from 'next/link'
import {
  Search, ChevronDown, ChevronLeft, ChevronRight,
  X, Database, Upload, MapPin, Building2, TrendingUp,
  BarChart3, RefreshCw, ExternalLink, Filter, Layers, ToggleRight, Clock,
  Phone, MessageCircle, Landmark, Globe, Download, Bookmark, Trash2, Bell, Check
} from 'lucide-react'
import { googleEarthUrl, googleMapsUrl } from '@/lib/map-links'
import { formatCLP, formatUF, getUFValue } from '@/lib/currency-formatter'
import { DESTINO_LABELS, MATERIAL_LABELS, CALIDAD_LABELS } from '@/lib/sii-labels'
import { normalizeClRol } from '@/lib/rol-format'
import SurfaceDistributionBar from '@/components/SurfaceDistributionBar'

// Mapa unificado (ex Visor Catastral /chile/street): satélite de Google con
// polígonos de parcelas clicables desde cadastre_parcels_cl.
const StreetViewMap = nextDynamicImport(() => import('@/components/map/StreetViewMap'), { ssr: false })

interface DrawnShape {
  type: 'polygon' | 'circle' | 'rectangle'
  coordinates?: [number, number][]
  center?: [number, number]
  radius?: number
}

// Confianza de la resolución de identidad de un anuncio (listings_cl.location_confidence)
type LocationConfidence = 'confirmed' | 'candidate' | 'pin_suspect' | 'none'

const CONFIDENCE_LABEL: Record<LocationConfidence, string> = {
  confirmed: 'Confirmado (catastro)',
  candidate: 'Candidato',
  pin_suspect: 'Pin sospechoso',
  none: 'Sin resolver',
}

const CONFIDENCE_COLOR: Record<LocationConfidence, string> = {
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

/**
 * Sparkline SVG minimalista de la serie de avalúo (sin dependencias), en tema
 * oscuro para el panel del visor. Espejo del de informe-predio; degrada a null
 * con <2 puntos. NO es precio de venta — es avalúo fiscal.
 */
function AvaluoSparkline({ serie }: { serie: { periodo: string; avaluo_total: number | null }[] }) {
  const pts = serie.filter(p => p.avaluo_total != null) as { periodo: string; avaluo_total: number }[]
  if (pts.length < 2) return null
  const W = 220, H = 44, PAD = 3
  const vals = pts.map(p => p.avaluo_total)
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || 1
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (pts.length - 1)
  const y = (v: number) => H - PAD - ((v - min) * (H - 2 * PAD)) / span
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.avaluo_total).toFixed(1)}`).join(' ')
  const first = pts[0], last = pts[pts.length - 1]
  const pct = first.avaluo_total > 0 ? Math.round(((last.avaluo_total - first.avaluo_total) / first.avaluo_total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="flex-shrink-0">
        <path d={d} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(last.avaluo_total)} r={2.5} fill="#60a5fa" />
      </svg>
      <div className="text-[11px] text-slate-500">
        <span className={pct >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{pct >= 0 ? '+' : ''}{pct}%</span>
        {' '}<span className="text-slate-600">{first.periodo}→{last.periodo}</span>
      </div>
    </div>
  )
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
  // Default: solo directorio teléfonos (más barato); usuario puede añadir más
  const [dealernetProducts, setDealernetProducts] = useState<string[]>(['3410'])
  // Buscador Múltiple (DealerNet, producto 3460) por rol — candidatos a RUT
  // sin que el usuario tenga que escribirlo a mano (misma regla que
  // /chile/dealer: candidato → RUT → Directorio Teléfonos de una vez)
  const [dealernetCandidatos, setDealernetCandidatos] = useState<any[] | null>(null)
  const [dealernetCandidatosLoading, setDealernetCandidatosLoading] = useState(false)
  const [dealernetCandidatosError, setDealernetCandidatosError] = useState<string | null>(null)
  // TGR — certificado de deuda + nombre del dueño, consulta automática on-demand
  const [tgrCert, setTgrCert] = useState<any>(null)
  const [tgrLoading, setTgrLoading] = useState(false)
  const [tgrError, setTgrError] = useState<string | null>(null)
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
  // Farming: stats + roles dentro de la zona dibujada (sii-roles-in-zone)
  const [zoneStats, setZoneStats] = useState<{ avaluo_promedio: number | null; avaluo_total: number | null } | null>(null)
  const [zoneRoles, setZoneRoles] = useState<any[] | null>(null)
  // Capa analítica sobre los polígonos del mapa (coropletas)
  const [analyticLayer, setAnalyticLayer] = useState<'none' | 'avaluo_m2' | 'tgr'>('none')
  // Zonas guardadas (watchlist local, localStorage — sin backend)
  const [savedZones, setSavedZones] = useState<{ id: string; name: string; zoneId: ZoneId; shape: DrawnShape; savedAt: string }[]>([])
  const [savedZonesOpen, setSavedZonesOpen] = useState(false)
  // Watchlists de servidor (zonas seguidas con novedades de oferta)
  const [watchlists, setWatchlists] = useState<any[]>([])
  const [watchlistsOpen, setWatchlistsOpen] = useState(false)
  // Oferta: anuncios reales de listings_cl (pipeline Portal Inmobiliario)
  const [ofertaListings, setOfertaListings] = useState<any[]>([])
  const [ofertaLoading, setOfertaLoading] = useState(false)
  const [ofertaTotal, setOfertaTotal] = useState(0)
  const [ofertaPage, setOfertaPage] = useState(1)
  const [ofertaTotalPages, setOfertaTotalPages] = useState(1)
  const [ofertaOperation, setOfertaOperation] = useState<'all' | 'sale' | 'rent'>('all')
  const [ofertaSoloOportunidades, setOfertaSoloOportunidades] = useState(false)
  // Ventas: transacciones CBR (sii_transacciones_cl)
  const [ventasList, setVentasList] = useState<any[] | null>(null)
  const [ventasLoading, setVentasLoading] = useState(false)
  const [ventasTotal, setVentasTotal] = useState(0)
  const [ventasPage, setVentasPage] = useState(1)
  const [ventasTotalPages, setVentasTotalPages] = useState(1)
  // Historial de ventas CBR del rol seleccionado (ficha)
  const [rolVentas, setRolVentas] = useState<any[] | null>(null)
  // Import CSV de transacciones (estado vacío de la pestaña Ventas)
  const [ventasImport, setVentasImport] = useState<{ loading: boolean; msg: string | null }>({ loading: false, msg: null })
  // Valoración automática (AVM v1) por comparables de oferta
  const [avm, setAvm] = useState<any>(null)

  // Serie histórica de avalúo fiscal del rol (sparkline de tendencia)
  const [histAvaluo, setHistAvaluo] = useState<{ periodo: string; avaluo_total: number | null }[] | null>(null)

  // Pin/polígono del rol seleccionado en el mapa (parcel-geojson → coords SII)
  const [mapPin, setMapPin] = useState<{ lat: number; lng: number; label?: string; geojson?: object | null } | null>(null)
  const [mapZoomLevel, setMapZoomLevel] = useState(15)
  // Resultados de otras comunas cuando la búsqueda local no encuentra nada
  const [globalResults, setGlobalResults] = useState<any[] | null>(null)

  const PAGE_SIZE = 50

  // Deep-links: restaurar ?zona=&rol=&tab= al montar (URL compartible)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const zona = sp.get('zona')
    const rol = sp.get('rol')
    const tab = sp.get('tab')
    if (zona && ZONES.some(z => z.id === zona)) setZoneId(zona as ZoneId)
    if (rol) setSelectedRol({ rol: normalizeClRol(rol) })
    if (tab && LAYER_TABS.some(t => t.id === tab)) setLayerTab(tab as LayerTab)
  }, [])

  // Deep-links: reflejar zona/rol/tab en la URL sin recargar
  useEffect(() => {
    const sp = new URLSearchParams()
    if (zoneId !== 'vitacura') sp.set('zona', zoneId)
    if (selectedRol?.rol) sp.set('rol', selectedRol.rol)
    if (layerTab !== 'catastro') sp.set('tab', layerTab)
    const qs = sp.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [zoneId, selectedRol, layerTab])

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

  // Polígono catastral del rol seleccionado para el mapa — misma cadena de
  // fallback que tenía el visor /chile/street: polígono real de
  // cadastre_parcels_cl → coords del propio SII → solo centro de zona.
  useEffect(() => {
    setMapPin(null)
    const rol = rolDetail?.rol
    if (!rol || !zone.siiCode) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/chile/parcel-geojson?rol=${encodeURIComponent(rol.rol)}&comuna=${zone.siiCode}`)
        const data = await res.json()
        if (cancelled) return
        if (data.success && data.parcel) {
          setMapPin({ lat: data.parcel.lat, lng: data.parcel.lng, label: rol.direccion ?? undefined, geojson: data.parcel.geojson })
          return
        }
      } catch { /* ignore */ }
      if (!cancelled && rol.lat && rol.lng) {
        setMapPin({ lat: rol.lat, lng: rol.lng, label: rol.direccion ?? undefined })
      }
    })()
    return () => { cancelled = true }
  }, [rolDetail, zone.siiCode])

  // Clic en una parcela del mapa → abre la ficha completa del rol. Si la
  // parcela es de otra comuna con zona configurada, salta a esa zona.
  const handleParcelClick = useCallback((p: { rol: string; sii_comuna_code: string }) => {
    const targetZone = p.sii_comuna_code === zone.siiCode ? zone : ZONES.find(z => z.siiCode === p.sii_comuna_code)
    if (!targetZone) return
    if (targetZone.id !== zoneId) setZoneId(targetZone.id)
    setLayerTab('catastro')
    setShowBuildingUnits(false)
    setSelectedRol({ rol: normalizeClRol(p.rol) })
  }, [zone, zoneId])

  // Si la búsqueda no encuentra nada en la comuna activa, buscar en todas las
  // comunas (sii-search: rol o dirección con trigram + fallback mapasui) y
  // ofrecer el salto — conserva la búsqueda global que tenía /chile/street.
  useEffect(() => {
    if (!search || loading || roles.length > 0) { setGlobalResults(null); return }
    const controller = new AbortController()
    fetch(`/api/chile/sii-search?q=${encodeURIComponent(search)}&limit=8`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setGlobalResults(d.results ?? []) })
      .catch(() => {})
    return () => controller.abort()
  }, [search, loading, roles])

  // Oferta: anuncios reales de la comuna (listings_cl vía /api/chile/anuncios)
  useEffect(() => { setOfertaPage(1) }, [zoneId, ofertaOperation, ofertaSoloOportunidades])
  useEffect(() => {
    if (layerTab !== 'oferta' || !zone.siiCode) return
    const controller = new AbortController()
    setOfertaLoading(true)
    // with_discount=1 siempre: cada tarjeta muestra su descuento vs la
    // mediana $/m² de la comuna (misma CTE que /chile/oportunidades)
    const params = new URLSearchParams({ comuna_code: zone.siiCode, page: String(ofertaPage), page_size: '50', sort: 'recent', with_discount: '1' })
    if (ofertaOperation !== 'all') params.set('operation', ofertaOperation)
    if (ofertaSoloOportunidades) params.set('only_opportunities', 'true')
    fetch(`/api/chile/anuncios?${params}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setOfertaListings(d.data ?? [])
          setOfertaTotal(d.total ?? 0)
          setOfertaTotalPages(d.total_pages ?? 1)
        }
      })
      .catch(() => {})
      .finally(() => setOfertaLoading(false))
    return () => controller.abort()
  }, [layerTab, zone.siiCode, ofertaPage, ofertaOperation, ofertaSoloOportunidades])

  // Ventas: transacciones CBR de la comuna
  useEffect(() => { setVentasPage(1) }, [zoneId])
  useEffect(() => {
    if (layerTab !== 'ventas' || !zone.siiCode) return
    const controller = new AbortController()
    setVentasLoading(true)
    fetch(`/api/chile/sii-transacciones?sii_comuna_code=${zone.siiCode}&page=${ventasPage}&page_size=50`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setVentasList(d.data ?? [])
          setVentasTotal(d.total ?? 0)
          setVentasTotalPages(d.total_pages ?? 1)
        }
      })
      .catch(() => {})
      .finally(() => setVentasLoading(false))
    return () => controller.abort()
  }, [layerTab, zone.siiCode, ventasPage])

  // Historial de compraventas CBR del rol seleccionado (ficha)
  useEffect(() => {
    setRolVentas(null)
    if (!selectedRol || !zone.siiCode) return
    const controller = new AbortController()
    fetch(`/api/chile/sii-transacciones?sii_comuna_code=${zone.siiCode}&rol=${encodeURIComponent(selectedRol.rol)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setRolVentas(d.data ?? []) })
      .catch(() => {})
    return () => controller.abort()
  }, [selectedRol, zone.siiCode])

  // Valoración estimada (AVM) del rol seleccionado — comparables de oferta
  useEffect(() => {
    setAvm(null)
    if (!selectedRol || !zone.siiCode) return
    const controller = new AbortController()
    fetch(`/api/chile/avm?sii_comuna_code=${zone.siiCode}&rol=${encodeURIComponent(selectedRol.rol)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setAvm(d) })
      .catch(() => {})
    return () => controller.abort()
  }, [selectedRol, zone.siiCode])

  // Serie histórica de avalúo del rol seleccionado (sparkline en la ficha)
  useEffect(() => {
    setHistAvaluo(null)
    if (!selectedRol || !zone.siiCode) return
    const controller = new AbortController()
    fetch(`/api/chile/avaluo-historico?sii_comuna_code=${zone.siiCode}&rol=${encodeURIComponent(selectedRol.rol)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setHistAvaluo(d.serie ?? []) })
      .catch(() => {})
    return () => controller.abort()
  }, [selectedRol, zone.siiCode])

  // Pins de oferta en el mapa (solo en la pestaña Oferta), coloreados por
  // confianza de la resolución de identidad del anuncio
  const ofertaPins = useMemo(() => {
    if (layerTab !== 'oferta') return []
    return ofertaListings
      .filter((l: any) => l.latitude != null && l.longitude != null)
      .map((l: any) => ({
        id: String(l.id),
        lat: Number(l.latitude),
        lng: Number(l.longitude),
        color: CONFIDENCE_COLOR[(l.location_confidence ?? 'none') as LocationConfidence] ?? CONFIDENCE_COLOR.none,
        label: `${l.address ?? l.external_id} · ${l.price ? fmtCLP(l.price) : 's/precio'}${l.discount_ratio != null && l.discount_ratio >= 0.15 ? ` · −${Math.round(l.discount_ratio * 100)}% vs mediana` : ''}`,
      }))
  }, [layerTab, ofertaListings])

  const handleOfertaPinClick = useCallback((id: string) => {
    const l = ofertaListings.find((x: any) => String(x.id) === id)
    if (l?.latitude != null && l?.longitude != null) {
      setMapPin({ lat: Number(l.latitude), lng: Number(l.longitude), label: `${l.address ?? l.external_id} · ${l.price ? fmtCLP(l.price) : ''}` })
    }
  }, [ofertaListings])

  // Consulta DealerNet por RUT (producto según dealernetProducts, por defecto
  // solo Directorio Teléfonos) y guarda el resultado en BD para no repetir la
  // consulta cada vez que se abre la ficha.
  const searchDealernet = useCallback((rutOverride?: string, force = false) => {
    if (!selectedRol || !zone.siiCode) return
    const rut = (rutOverride ?? dealernetRutInput).trim()
    if (!rut || dealernetProducts.length === 0) return
    setDealernetLoading(true)
    setDealernetError(null)
    fetch('/api/chile/dealernet-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut, sii_rol: selectedRol.rol, sii_comuna_code: zone.siiCode, product_codes: dealernetProducts, force, source: 'ficha_catastro' }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setDealernetContact({ nombre_titular: d.nombre_titular, retcode: d.retcode, retmsg: d.retmsg })
          setDealernetPhones(d.phones ?? [])
        } else {
          setDealernetError(d.error ?? 'Error al obtener datos del dueño')
        }
      })
      .catch(() => setDealernetError('Error de red al obtener datos del dueño'))
      .finally(() => setDealernetLoading(false))
  }, [selectedRol, zone.siiCode, dealernetRutInput, dealernetProducts])

  // Al elegir un candidato no basta con copiar el RUT al formulario: el flujo
  // completo es candidato → RUT → solicitud de teléfonos de una vez (misma
  // regla que /chile/dealer, componente DuenoLookup).
  const usarCandidatoDealernet = useCallback((c: any) => {
    if (c.rut == null || !c.dv) return
    const rutStr = `${c.rut}-${c.dv}`
    setDealernetRutInput(rutStr)
    searchDealernet(rutStr)
  }, [searchDealernet])

  // Buscador Múltiple (DealerNet, producto 3460) por rol — mismo protocolo
  // que /chile/dealer para tipbusq="rol": args="manzana-predio, Comuna".
  // Encuentra el RUT del propietario sin que el usuario lo escriba a mano.
  // Si hay un único candidato con RUT, se usa automático (candidato → RUT →
  // Directorio Teléfonos, sin esperar clic); si hay varios, se listan para
  // que el usuario elija.
  const buscarCandidatoPorRol = useCallback(() => {
    if (!selectedRol || !zone.comuna) return
    setDealernetCandidatosLoading(true)
    setDealernetCandidatosError(null)
    setDealernetCandidatos(null)
    fetch('/api/chile/dealernet-buscar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipbusq: 'rol', args: `${selectedRol.rol}, ${zone.comuna}`, source: 'ficha_catastro' }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.success) {
          setDealernetCandidatosError(d.error ?? 'Error al buscar candidatos')
          return
        }
        const candidatos = d.candidatos ?? []
        setDealernetCandidatos(candidatos)
        if (candidatos.length === 1 && candidatos[0].rut != null && candidatos[0].dv) {
          usarCandidatoDealernet(candidatos[0])
        }
      })
      .catch(() => setDealernetCandidatosError('Error de red al buscar candidatos'))
      .finally(() => setDealernetCandidatosLoading(false))
  }, [selectedRol, zone.comuna, usarCandidatoDealernet])

  // Fetch contacto DealerNet ya guardado para este rol (cache — no vuelve a
  // golpear el web service hasta que el usuario lo pida). A diferencia de TGR
  // (scraping gratis de un sitio público), DealerNet cobra por consulta —
  // Buscador Múltiple y Directorio Teléfonos NO se disparan solos al abrir la
  // ficha, quedan detrás del botón "Buscar dueño (DealerNet)".
  useEffect(() => {
    setDealernetContact(null)
    setDealernetPhones([])
    setDealernetError(null)
    setDealernetRutInput('')
    setDealernetCandidatos(null)
    setDealernetCandidatosError(null)
    if (!selectedRol || !zone.siiCode) return
    let cancelled = false
    fetch(`/api/chile/dealernet-lookup?sii_rol=${encodeURIComponent(selectedRol.rol)}&sii_comuna_code=${zone.siiCode}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.success && d.contact) {
          setDealernetContact(d.contact)
          setDealernetPhones(d.phones ?? [])
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedRol, zone.siiCode])

  // Dispara la consulta automática al formulario de TGR (Certificado de Deuda)
  // para el rol seleccionado — reemplaza el flujo manual de abrir tesoreria.cl
  // y tipear el rol a mano. Puede tardar ~10-25s porque corre un navegador
  // headless de verdad contra el sitio de Tesorería.
  const consultarTgrAhora = useCallback((force = false) => {
    if (!selectedRol || !zone.siiCode) return
    setTgrLoading(true)
    setTgrError(null)
    fetch('/api/chile/tgr-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: selectedRol.rol, comuna: zone.comuna, sii_comuna_code: zone.siiCode, force }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setTgrCert(d.certificado)
        } else {
          setTgrError(d.error ?? 'No se pudo consultar TGR')
          if (d.certificado) setTgrCert(d.certificado)
        }
      })
      .catch(() => setTgrError('Error de red al consultar TGR'))
      .finally(() => setTgrLoading(false))
  }, [selectedRol, zone.siiCode, zone.comuna])

  // Certificado TGR ya guardado en BD para este rol (bulk scraper o consulta
  // on-demand previa) — se muestra de inmediato, sin golpear tesoreria.cl. Si
  // no hay nada cacheado todavía, dispara la consulta en vivo automáticamente
  // (el usuario ya no tiene que apretar "Consultar en TGR" a mano) — puede
  // demorar unos segundos porque corre un navegador headless real.
  useEffect(() => {
    setTgrCert(null)
    setTgrError(null)
    if (!selectedRol || !zone.siiCode) return
    let cancelled = false
    fetch(`/api/chile/tgr-lookup?rol=${encodeURIComponent(selectedRol.rol)}&sii_comuna_code=${zone.siiCode}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.success && d.certificado) {
          setTgrCert(d.certificado)
        } else {
          consultarTgrAhora()
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedRol, zone.siiCode, consultarTgrAhora])

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

  // Roles SII dentro de la zona dibujada: conteo + stats + lista (farming)
  useEffect(() => {
    if (!drawnShape || !zone.siiCode) { setZoneCount(null); setZoneStats(null); setZoneRoles(null); return }
    const controller = new AbortController()
    setZoneCountLoading(true)
    fetch('/api/chile/sii-roles-in-zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sii_comuna_code: zone.siiCode, shape: drawnShape, include_roles: true, roles_limit: 1000 }),
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setZoneCount(d.count)
          setZoneStats({ avaluo_promedio: d.avaluo_promedio, avaluo_total: d.avaluo_total })
          setZoneRoles(d.roles ?? [])
        }
      })
      .catch(() => { setZoneCount(null); setZoneStats(null); setZoneRoles(null) })
      .finally(() => setZoneCountLoading(false))
    return () => controller.abort()
  }, [drawnShape, zone.siiCode])

  // Zonas guardadas: persistencia en localStorage (watchlist ligera)
  const SAVED_ZONES_KEY = 'casafari:zonas-cl'
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_ZONES_KEY)
      if (raw) setSavedZones(JSON.parse(raw))
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistSavedZones = useCallback((zones: typeof savedZones) => {
    setSavedZones(zones)
    try { localStorage.setItem(SAVED_ZONES_KEY, JSON.stringify(zones)) } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveCurrentZone = useCallback(() => {
    if (!drawnShape) return
    const name = window.prompt('Nombre de la zona', `${zone.label} · ${new Date().toLocaleDateString('es-CL')}`)
    if (!name?.trim()) return
    persistSavedZones([
      ...savedZones,
      { id: crypto.randomUUID(), name: name.trim(), zoneId, shape: drawnShape, savedAt: new Date().toISOString() },
    ])
  }, [drawnShape, savedZones, zone.label, zoneId, persistSavedZones])

  const loadSavedZone = useCallback((z: typeof savedZones[number]) => {
    if (z.zoneId !== zoneId) { setZoneId(z.zoneId); setSelectedRol(null) }
    setDrawnShape(z.shape)
    setSavedZonesOpen(false)
  }, [zoneId])

  // Watchlists de servidor: cargar y refrescar novedades
  const fetchWatchlists = useCallback(() => {
    fetch('/api/chile/watchlists')
      .then(r => r.json())
      .then(d => { if (d.success) setWatchlists(d.data ?? []) })
      .catch(() => {})
  }, [])
  useEffect(() => { fetchWatchlists() }, [fetchWatchlists])

  const followCurrentZone = useCallback(() => {
    if (!drawnShape || !zone.siiCode) return
    const name = window.prompt('Nombre de la zona a seguir', `${zone.label} · seguimiento`)
    if (!name?.trim()) return
    fetch('/api/chile/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), sii_comuna_code: zone.siiCode, shape: drawnShape }),
    })
      .then(r => r.json())
      .then(d => { if (d.success) { fetchWatchlists(); setWatchlistsOpen(true) } })
      .catch(() => {})
  }, [drawnShape, zone.siiCode, zone.label, fetchWatchlists])

  const loadWatchlist = useCallback((w: any) => {
    const wz = ZONES.find(z => z.siiCode === w.sii_comuna_code)
    if (wz && wz.id !== zoneId) { setZoneId(wz.id); setSelectedRol(null) }
    setDrawnShape(w.shape as DrawnShape)
    setWatchlistsOpen(false)
  }, [zoneId])

  const markWatchlistSeen = useCallback((id: string) => {
    fetch('/api/chile/watchlists', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(() => fetchWatchlists()).catch(() => {})
  }, [fetchWatchlists])

  const deleteWatchlist = useCallback((id: string) => {
    fetch(`/api/chile/watchlists?id=${id}`, { method: 'DELETE' }).then(() => fetchWatchlists()).catch(() => {})
  }, [fetchWatchlists])

  const totalNovedades = useMemo(() => watchlists.reduce((s, w) => s + (w.novedades ?? 0), 0), [watchlists])

  // Subir CSV de compraventas al importador (pestaña Ventas)
  const uploadVentasCsv = useCallback((file: File) => {
    setVentasImport({ loading: true, msg: null })
    fetch('/api/admin/transacciones-upload', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: file })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setVentasImport({ loading: false, msg: `Importadas ${d.inserted} filas${d.skipped ? ` (${d.skipped} omitidas)` : ''}.` })
          setVentasPage(1)
          // recargar la lista de la pestaña
          if (zone.siiCode) {
            fetch(`/api/chile/sii-transacciones?sii_comuna_code=${zone.siiCode}&page=1&page_size=50`)
              .then(r => r.json()).then(dd => { if (dd.success) { setVentasList(dd.data ?? []); setVentasTotal(dd.total ?? 0); setVentasTotalPages(dd.total_pages ?? 1) } }).catch(() => {})
          }
        } else {
          setVentasImport({ loading: false, msg: `Error: ${d.error ?? 'no se pudo importar'}` })
        }
      })
      .catch(() => setVentasImport({ loading: false, msg: 'Error de red al importar' }))
  }, [zone.siiCode])

  // Export CSV de los roles de la zona dibujada (separador ; + BOM para Excel es-CL)
  const exportZoneCsv = useCallback(() => {
    if (!zoneRoles || zoneRoles.length === 0) return
    const header = ['rol', 'direccion', 'destino', 'avaluo_fiscal_total', 'superficie_terreno_m2', 'nombre_propietario', 'lat', 'lng']
    const lines = [header, ...zoneRoles.map((r: any) => [
      r.rol, r.direccion ?? '', r.codigo_destino_principal ?? '', r.avaluo_fiscal_total ?? '',
      r.superficie_terreno_m2 ?? '', r.nombre_propietario ?? '', r.lat ?? '', r.lng ?? '',
    ])]
    const csv = '\ufeff' + lines.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `roles-${zone.id}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [zoneRoles, zone.id])


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
                  <a
                    href={`/chile/informe-predio?comuna=${zone.siiCode}&rol=${encodeURIComponent(selectedRol.rol)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:text-blue-300 border border-blue-900/50 bg-blue-950/30 rounded-md px-2 py-1 transition-colors"
                    title="Abrir informe imprimible del predio"
                  >
                    <ExternalLink size={10} />
                    Informe
                  </a>
                  <span className="text-[10px] text-slate-600">{zone.label}</span>
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
                        <div className="flex px-3 py-2 border-b border-[var(--c-border-card)]/40">
                          <span className="text-[11px] text-slate-600 w-28 flex-shrink-0">Coordenadas</span>
                          {rolDetail.rol?.lat && rolDetail.rol?.lng ? (
                            <span className="inline-flex items-center gap-2 flex-wrap">
                              <a
                                href={googleMapsUrl(rolDetail.rol.lat, rolDetail.rol.lng)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-blue-400 hover:text-blue-300 font-medium cursor-pointer inline-flex items-center gap-1"
                              >
                                {rolDetail.rol.lat.toFixed(6)}, {rolDetail.rol.lng.toFixed(6)}
                                <ExternalLink size={9} />
                              </a>
                              <a
                                href={googleEarthUrl(rolDetail.rol.lat, rolDetail.rol.lng)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Ver en Google Earth (vista 3D)"
                                className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5"
                              >
                                <Globe size={9} />
                                Google Earth
                              </a>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500 italic">Cargando coordenadas...</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Propietario — el SII solo entrega el nombre (no RUT, no
                        teléfono). Misma regla que /chile/dealer: Buscador Múltiple
                        por rol (producto 3460) encuentra el RUT sin que el usuario lo
                        escriba, y con ese RUT se pide de una vez Directorio Teléfonos
                        (producto 3410, el más económico) — pero a diferencia de TGR
                        (scraping gratis) esto consulta un servicio pago de DealerNet,
                        así que queda detrás de un botón en vez de dispararse solo al
                        abrir la ficha. El resultado se guarda en BD para no repetir la
                        consulta la próxima vez. */}
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
                            <p className="text-[10px] text-slate-600">Titular</p>
                            <p className="text-[11px] text-slate-300 font-medium">{dealernetContact.nombre_titular}</p>
                          </div>
                        )}

                        {!dealernetContact && (
                          <button
                            onClick={buscarCandidatoPorRol}
                            disabled={dealernetCandidatosLoading}
                            className="flex items-center gap-1.5 text-[11px] font-medium text-purple-400 hover:text-purple-300 disabled:opacity-40"
                          >
                            {dealernetCandidatosLoading ? <RefreshCw size={11} className="animate-spin" /> : <Search size={11} />}
                            {dealernetCandidatosLoading ? 'Buscando RUT por rol…' : 'Buscar dueño por rol (DealerNet)'}
                          </button>
                        )}

                        {dealernetCandidatosError && (
                          <p className="text-[11px] text-red-400">{dealernetCandidatosError}</p>
                        )}

                        {!dealernetContact && dealernetCandidatos && (
                          dealernetCandidatos.length === 0 ? (
                            <p className="text-[11px] text-slate-600">Sin candidatos por rol en DealerNet — ingresa el RUT a mano abajo.</p>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-[10px] text-slate-600">Candidatos (Buscador Múltiple, rol)</p>
                              {dealernetCandidatos.map((c: any, i: number) => (
                                <button
                                  key={i}
                                  onClick={() => usarCandidatoDealernet(c)}
                                  disabled={c.rut == null || !c.dv || dealernetLoading}
                                  className="w-full flex items-center gap-2 text-left rounded-lg border border-slate-800/50 bg-slate-900/30 hover:border-emerald-700/60 hover:bg-emerald-950/20 px-2 py-1.5 transition-colors disabled:opacity-40"
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] text-slate-200 font-medium truncate">
                                      {c.razonSocial || `${c.nombres ?? ''} ${c.apellidos ?? ''}`.trim() || 'Sin nombre'}
                                    </p>
                                    <p className="text-[10px] text-slate-500">
                                      {c.rut != null ? `RUT ${c.rut.toLocaleString('es-CL')}-${c.dv}` : 'Sin RUT'}
                                    </p>
                                  </div>
                                  {c.probabilidad && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800/50 text-slate-400 flex-shrink-0">
                                      {c.probabilidad}{c.similitud != null ? ` ${c.similitud}%` : ''}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )
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

                        {/* Selector de servicios */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] text-slate-600 mr-0.5">Servicio:</span>
                          {[
                            { code: '3410', label: 'Tel.' },
                            { code: '3407', label: 'Contact.' },
                            { code: '3408', label: 'Verif.' },
                          ].map(({ code, label }) => (
                            <button
                              key={code}
                              onClick={() => setDealernetProducts(prev =>
                                prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
                              )}
                              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${dealernetProducts.includes(code) ? 'bg-blue-700/30 border-blue-600/50 text-blue-300' : 'bg-slate-900/30 border-slate-800/40 text-slate-600 hover:text-slate-400'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={dealernetRutInput}
                            onChange={(e) => setDealernetRutInput(e.target.value)}
                            placeholder="RUT propietario, ej. 12.345.678-9"
                            className="flex-1 text-[11px] bg-slate-900/40 border border-slate-800/50 rounded-lg px-2 py-1.5 text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-700"
                            onKeyDown={(e) => { if (e.key === 'Enter') searchDealernet(undefined, !!dealernetContact) }}
                          />
                          <button
                            onClick={() => searchDealernet(undefined, !!dealernetContact)}
                            disabled={dealernetLoading || !dealernetRutInput.trim() || dealernetProducts.length === 0}
                            className="flex items-center gap-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                          >
                            {dealernetLoading ? <RefreshCw size={12} className="animate-spin" /> : <Phone size={12} />}
                            {dealernetContact ? 'Actualizar' : 'Obtener dueño'}
                          </button>
                        </div>

                        {rolDetail.rol?.nombre_propietario && (
                          <div className="flex items-center gap-1 flex-wrap pt-0.5">
                            <span className="text-[10px] text-slate-600">¿No tienes el RUT?</span>
                            <a
                              href={`https://www.nombrerutyfirma.com/buscar?t=nombre&r=${encodeURIComponent(rolDetail.rol.nombre_propietario)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-amber-400 hover:text-amber-300 inline-flex items-center gap-0.5"
                            >
                              Buscar en rutificador <ExternalLink size={9} />
                            </a>
                          </div>
                        )}

                        <div className="pt-2 border-t border-[var(--c-border-card)]/40 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-600">Certificado TGR (Rol {rolDetail.rol?.rol ?? '—'})</span>
                            <div className="flex items-center gap-1.5">
                              <a
                                href="https://www.tgr.cl/tramites-tgr/certificado-de-deuda-de-contribuciones/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-slate-600 hover:text-slate-400 inline-flex items-center gap-0.5"
                                title="Abrir el sitio de TGR manualmente"
                              >
                                manual <ExternalLink size={9} />
                              </a>
                              <button
                                onClick={() => consultarTgrAhora(!!tgrCert)}
                                disabled={tgrLoading}
                                className="flex items-center gap-1.5 text-[11px] font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-2.5 py-1 rounded-lg transition-colors"
                              >
                                {tgrLoading ? <RefreshCw size={11} className="animate-spin" /> : <Landmark size={11} />}
                                {tgrLoading ? 'Consultando…' : tgrCert ? 'Reconsultar' : 'Consultar en TGR (automático)'}
                              </button>
                            </div>
                          </div>

                          {tgrError && (
                            <p className="text-[11px] text-red-400">{tgrError}</p>
                          )}

                          {tgrCert && (
                            <div className="rounded-lg bg-slate-900/40 border border-slate-800/50 px-2.5 py-2 space-y-1.5">
                              {tgrCert.nombre && (
                                <div>
                                  <p className="text-[10px] text-slate-600">Nombre (TGR)</p>
                                  <p className="text-[11px] text-slate-200 font-medium">{tgrCert.nombre}</p>
                                </div>
                              )}
                              <p className="text-[10px] text-slate-500">
                                {tgrCert.tiene_deuda
                                  ? `Con deuda${tgrCert.total_deuda_no_vencida ? ` · ${fmtCLP(Number(tgrCert.total_deuda_no_vencida))}` : ''}`
                                  : tgrCert.estado === 'sin_deuda' ? 'Sin deuda registrada' : `Estado: ${tgrCert.estado}`}
                              </p>
                            </div>
                          )}
                        </div>
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

                    {/* Valoración estimada (AVM v1) — comparables de oferta */}
                    {avm && avm.enough && avm.estimated_value != null && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Valoración estimada</p>
                        <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 p-3">
                          <div className="flex items-baseline justify-between">
                            <span className="text-lg font-bold text-blue-300">{fmtCLP(avm.estimated_value)}</span>
                            <span className="text-[10px] text-slate-500">{formatUF(avm.estimated_value, 0)}</span>
                          </div>
                          {avm.estimated_min != null && avm.estimated_max != null && (
                            <p className="text-[11px] text-slate-500 mt-0.5">Rango {fmtCLP(avm.estimated_min)} – {fmtCLP(avm.estimated_max)}</p>
                          )}
                          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-blue-900/30 text-[10px] text-slate-500">
                            <BarChart3 size={10} className="text-blue-400 flex-shrink-0" />
                            <span>
                              {avm.median_sqm ? `${fmtCLP(Math.round(avm.median_sqm))}/m² · ` : ''}
                              {avm.n_comparables} anuncios de venta {avm.scope === 'radio' ? '(1 km)' : '(comuna)'} · {avm.base_surface_m2} m² {avm.base_surface_type}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-600 mt-1.5 italic">Valor de oferta (no de cierre) — referencial, con sesgo al alza. No es tasación.</p>
                        </div>
                      </div>
                    )}
                    {avm && !avm.enough && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Valoración estimada</p>
                        <div className="rounded-xl border border-dashed border-[var(--c-border-card)] bg-[var(--c-card)]/50 px-3 py-2.5 text-[11px] text-slate-600">
                          Muestra insuficiente de anuncios de venta en {zone.label} para estimar ({avm.n_comparables} comparables, se necesitan ≥5).
                        </div>
                      </div>
                    )}

                    {/* Mercado realizado — valor de suelo MINVU (AVM v2) */}
                    {avm?.suelo_minvu && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">
                          Suelo MINVU {avm.suelo_minvu.scope === 'zona' ? '(zona)' : '(comuna)'}
                        </p>
                        <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3">
                          <div className="flex items-baseline justify-between">
                            <span className="text-lg font-bold text-emerald-300">{avm.suelo_minvu.valor_uf_m2} UF/m²</span>
                            {avm.suelo_minvu.valor_clp_m2 != null && (
                              <span className="text-[10px] text-slate-500">{fmtCLP(avm.suelo_minvu.valor_clp_m2)}/m²</span>
                            )}
                          </div>
                          {avm.suelo_minvu.valor_suelo_estimado != null && (
                            <p className="text-[11px] text-slate-500 mt-0.5">Valor de suelo del predio {fmtCLP(avm.suelo_minvu.valor_suelo_estimado)}</p>
                          )}
                          <p className="text-[10px] text-slate-600 mt-1.5 italic">
                            Observatorio del Mercado de Suelo (MINVU){avm.suelo_minvu.periodo ? ` · ${avm.suelo_minvu.periodo}` : ''} — valor de terreno, no de construcción.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Tendencia de avalúo fiscal (histórico) — sparkline */}
                    {histAvaluo && histAvaluo.filter(p => p.avaluo_total != null).length >= 2 && (
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Tendencia de avalúo</p>
                        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]/50 p-3">
                          <AvaluoSparkline serie={histAvaluo} />
                          <p className="text-[10px] text-slate-600 mt-1.5 italic">Avalúo fiscal SII por período — no es precio de venta.</p>
                        </div>
                      </div>
                    )}

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

                    {/* Ventas históricas — compraventas CBR (sii_transacciones_cl) */}
                    <div>
                      <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">Ventas históricas (CBR)</p>
                      {rolVentas === null ? (
                        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]/50 px-3 py-3 text-center text-[11px] text-slate-600">Buscando compraventas…</div>
                      ) : rolVentas.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[var(--c-border-card)] bg-[var(--c-card)]/50 px-3 py-3 text-center">
                          <p className="text-[11px] text-slate-600">Sin compraventas registradas para este rol en el dataset CBR cargado.</p>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
                          {rolVentas.map((t: any, i: number) => (
                            <div key={`${t.foja_numero_anio ?? i}`} className="flex items-center gap-2 px-3 py-2 border-b border-[var(--c-border-card)]/40 last:border-0">
                              <span className="text-[11px] text-slate-400 whitespace-nowrap flex-shrink-0">{t.fecha_escritura ? new Date(t.fecha_escritura).toLocaleDateString('es-CL') : '—'}</span>
                              <span className="text-[10px] text-slate-600 truncate flex-1">{t.foja_numero_anio ? `Foja ${t.foja_numero_anio}` : ''}{t.cbr_nombre ? ` · ${t.cbr_nombre}` : ''}</span>
                              <span className="text-[11px] font-semibold text-slate-200 whitespace-nowrap">
                                {t.monto_uf != null ? `${t.monto_uf.toLocaleString('es-CL')} UF` : t.monto_clp != null ? fmtCLP(t.monto_clp) : '—'}
                              </span>
                              {t.uf_por_m2 != null && <span className="text-[10px] text-slate-500 whitespace-nowrap">{t.uf_por_m2.toLocaleString('es-CL')} UF/m²</span>}
                            </div>
                          ))}
                        </div>
                      )}
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
                  <div className="p-3">
                    <div className="flex items-center justify-center h-20 text-slate-700 text-xs">Sin resultados en {zone.label}</div>
                    {globalResults && globalResults.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold px-1">Resultados en otras comunas</p>
                        {globalResults.map((g: any) => {
                          const gz = ZONES.find(z => z.siiCode === g.sii_comuna_code)
                          return (
                            <button
                              key={g.id}
                              disabled={!gz}
                              onClick={() => {
                                if (!gz) return
                                setZoneId(gz.id)
                                setSearchInput(''); setSearch('')
                                setShowBuildingUnits(false)
                                setSelectedRol({ rol: g.rol })
                              }}
                              className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] hover:border-blue-800/50 hover:bg-blue-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={gz ? `Ver en ${g.comuna_nombre}` : 'Comuna sin zona configurada en este visor'}
                            >
                              <MapPin size={11} className="text-blue-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-300 truncate">{g.direccion ?? '—'}</p>
                                <p className="text-[10px] text-slate-600 font-mono">
                                  {g.comuna_nombre} · Rol {g.rol}
                                  {g.source === 'mapasui_scrape' && <span className="ml-1.5 text-amber-500 font-sans">no oficial</span>}
                                </p>
                              </div>
                              {g.avaluo_fiscal_total != null && (
                                <span className="text-[11px] text-slate-400 font-medium flex-shrink-0">{fmtCLP(g.avaluo_fiscal_total)}</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
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
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-[var(--c-border-card)]">
                <select
                  value={ofertaOperation}
                  onChange={e => setOfertaOperation(e.target.value as 'all' | 'sale' | 'rent')}
                  className="text-xs bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg px-2 py-1.5 text-slate-400 focus:outline-none focus:border-blue-600/50"
                >
                  <option value="all">Venta + arriendo</option>
                  <option value="sale">Venta</option>
                  <option value="rent">Arriendo</option>
                </select>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={ofertaSoloOportunidades}
                    onChange={e => setOfertaSoloOportunidades(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  Solo oportunidades <span className="text-slate-600">(≥15% bajo mediana)</span>
                </label>
                <p className="text-[11px] text-slate-600 ml-auto">
                  {ofertaLoading ? 'Cargando…' : `${ofertaTotal.toLocaleString('es-CL')} anuncios`}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {!ofertaLoading && ofertaListings.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-4">
                    <p className="text-xs text-slate-600">Sin anuncios para {zone.label}</p>
                    <p className="text-[10px] text-slate-700">La oferta se alimenta del pipeline de captación (Portal Inmobiliario → <Link href="/chile/captar-url" className="text-blue-500 hover:text-blue-400">Captar desde URL</Link>).</p>
                  </div>
                )}
                {ofertaListings.map((l: any) => {
                  const conf = (l.location_confidence ?? 'none') as LocationConfidence
                  return (
                    <div
                      key={l.id}
                      onClick={() => handleOfertaPinClick(String(l.id))}
                      className="rounded-lg border border-[var(--c-border-card)] bg-[var(--c-card)] px-3 py-2.5 cursor-pointer hover:border-blue-800/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-slate-300 flex-1">{l.address ?? l.external_id}</p>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-semibold text-emerald-300">{l.price ? fmtCLP(l.price) : '—'}</p>
                          {l.price_uf != null && <p className="text-[10px] text-slate-600">{Number(l.price_uf).toLocaleString('es-CL')} UF</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${l.operation === 'rent' ? 'bg-violet-950/50 text-violet-400' : 'bg-blue-950/50 text-blue-400'}`}>
                          {l.operation === 'rent' ? 'Arriendo' : 'Venta'}
                        </span>
                        {l.square_meters > 0 && <span className="text-[10px] text-slate-500">{l.square_meters} m²{l.price_sqm > 0 ? ` · ${fmtCLP(l.price_sqm)}/m²` : ''}</span>}
                        {l.bedrooms != null && <span className="text-[10px] text-slate-500">{l.bedrooms}D{l.bathrooms != null ? `/${l.bathrooms}B` : ''}</span>}
                        {l.days_on_market != null && <span className="text-[10px] text-slate-600">{l.days_on_market} días</span>}
                        {l.advertiser_type === 'particular' && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-950/50 text-emerald-400">Particular</span>}
                        {l.discount_ratio != null && l.discount_ratio >= 0.15 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300" title={l.median_sqm ? `Mediana comuna: ${fmtCLP(Number(l.median_sqm))}/m²` : undefined}>
                            −{Math.round(l.discount_ratio * 100)}% vs mediana
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CONFIDENCE_COLOR[conf] }} />
                        <span className="text-[10px] text-slate-500">{CONFIDENCE_LABEL[conf]}</span>
                        {l.rol_matriz_candidate && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowBuildingUnits(false); setLayerTab('catastro'); setSelectedRol({ rol: l.rol_matriz_candidate }) }}
                            className="text-[10px] font-mono text-blue-400 hover:text-blue-300"
                            title="Abrir ficha del rol"
                          >
                            Rol {l.rol_matriz_candidate}
                          </button>
                        )}
                        {l.source_url && (
                          <a
                            href={l.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 inline-flex items-center gap-1"
                          >
                            Portal <ExternalLink size={9} />
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {ofertaTotalPages > 1 && (
                <div className="flex-none flex items-center justify-between px-3 py-2 border-t border-[var(--c-border-card)]">
                  <button onClick={() => setOfertaPage(p => Math.max(1, p - 1))} disabled={ofertaPage <= 1}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft size={13} />Anterior
                  </button>
                  <span className="text-[11px] text-slate-600">{ofertaPage} / {ofertaTotalPages.toLocaleString('es-CL')}</span>
                  <button onClick={() => setOfertaPage(p => Math.min(ofertaTotalPages, p + 1))} disabled={ofertaPage >= ofertaTotalPages}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Siguiente<ChevronRight size={13} />
                  </button>
                </div>
              )}
            </div>
          )}

          {layerTab === 'ventas' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-[var(--c-border-card)]">
                <p className="text-[11px] text-slate-500">Compraventas CBR · {zone.label}</p>
                <p className="text-[11px] text-slate-600 ml-auto">
                  {ventasLoading ? 'Cargando…' : `${ventasTotal.toLocaleString('es-CL')} escrituras`}
                </p>
              </div>
              {!ventasLoading && ventasList !== null && ventasList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <Clock size={32} className="text-slate-700" />
                  <div className="max-w-xs">
                    <p className="text-sm font-medium text-slate-500 mb-1">Sin transacciones cargadas para {zone.label}</p>
                    <p className="text-xs text-slate-700 mb-3">Las compraventas provienen del Conservador de Bienes Raíces (no hay CSV público; se cargan desde un proveedor comercial o ETL propio). Importa un CSV para poblar <span className="font-mono">sii_transacciones_cl</span>.</p>
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors cursor-pointer">
                      <Upload size={12} />
                      {ventasImport.loading ? 'Importando…' : 'Importar CSV de compraventas'}
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        disabled={ventasImport.loading}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadVentasCsv(f); e.target.value = '' }}
                      />
                    </label>
                    {ventasImport.msg && <p className="text-[11px] text-slate-500 mt-2">{ventasImport.msg}</p>}
                    <p className="text-[10px] text-slate-700 mt-2">Columnas: sii_comuna_code, rol, fecha_escritura, monto_clp, monto_uf, superficie_m2, foja_numero_anio, cbr_nombre.</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-[var(--c-bg)] z-10">
                      <tr className="border-b border-[var(--c-border-card)] text-slate-600">
                        <th className="text-left px-3 py-2 font-medium">Fecha</th>
                        <th className="text-left px-3 py-2 font-medium">Rol / Dirección</th>
                        <th className="text-right px-3 py-2 font-medium">Monto</th>
                        <th className="text-right px-3 py-2 font-medium">UF/m²</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ventasList ?? []).map((t: any, i: number) => (
                        <tr
                          key={`${t.rol}-${t.foja_numero_anio ?? i}`}
                          onClick={() => { setShowBuildingUnits(false); setLayerTab('catastro'); setSelectedRol({ rol: t.rol }) }}
                          className={`border-b border-[var(--c-border-card)]/30 cursor-pointer hover:bg-[var(--c-active)] transition-colors ${i % 2 === 1 ? 'bg-[var(--c-card)]/30' : ''}`}
                        >
                          <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{t.fecha_escritura ? new Date(t.fecha_escritura).toLocaleDateString('es-CL') : '—'}</td>
                          <td className="px-3 py-2">
                            <span className="font-mono text-blue-400">{t.rol}</span>
                            {t.direccion && <span className="text-slate-500 ml-1.5">{t.direccion}</span>}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <span className="text-slate-300 font-medium">{t.monto_uf != null ? `${t.monto_uf.toLocaleString('es-CL')} UF` : t.monto_clp != null ? fmtCLP(t.monto_clp) : '—'}</span>
                            {t.monto_uf != null && t.monto_clp != null && <span className="block text-[10px] text-slate-600">{fmtCLP(t.monto_clp)}</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">{t.uf_por_m2 != null ? t.uf_por_m2.toLocaleString('es-CL') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {ventasTotalPages > 1 && (
                <div className="flex-none flex items-center justify-between px-3 py-2 border-t border-[var(--c-border-card)]">
                  <button onClick={() => setVentasPage(p => Math.max(1, p - 1))} disabled={ventasPage <= 1}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft size={13} />Anterior
                  </button>
                  <span className="text-[11px] text-slate-600">{ventasPage} / {ventasTotalPages.toLocaleString('es-CL')}</span>
                  <button onClick={() => setVentasPage(p => Math.min(ventasTotalPages, p + 1))} disabled={ventasPage >= ventasTotalPages}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Siguiente<ChevronRight size={13} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: map — satélite Google + polígonos de parcelas clicables */}
        <div className="flex-1 relative">
          <StreetViewMap
            center={mapPin ? { lat: mapPin.lat, lng: mapPin.lng } : zone.center}
            zoom={mapPin ? 18 : 15}
            pin={mapPin}
            comunaCode={zone.siiCode}
            onParcelClick={handleParcelClick}
            onZoomChange={setMapZoomLevel}
            analyticLayer={analyticLayer}
            enableDraw
            onShapeDrawn={setDrawnShape}
            drawnShape={drawnShape}
            extraPins={ofertaPins}
            onExtraPinClick={handleOfertaPinClick}
            showLocate
          />
          {mapZoomLevel < 15 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none rounded-full bg-black/60 backdrop-blur px-3 py-1.5 text-[11px] text-slate-200">
              Acércate para ver las parcelas — clic en una abre su ficha
            </div>
          )}

          {/* Selector de capa analítica + zonas guardadas */}
          <div className="absolute top-3 right-3 z-[1000] flex gap-1 rounded-lg bg-black/60 backdrop-blur p-1">
            {([
              { id: 'none', label: 'Parcelas' },
              { id: 'avaluo_m2', label: 'Avalúo/m²' },
              { id: 'tgr', label: 'Deuda TGR' },
            ] as const).map(l => (
              <button
                key={l.id}
                onClick={() => setAnalyticLayer(l.id)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  analyticLayer === l.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                {l.label}
              </button>
            ))}
            {savedZones.length > 0 && (
              <button
                onClick={() => { setSavedZonesOpen(v => !v); setWatchlistsOpen(false) }}
                className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  savedZonesOpen ? 'bg-cyan-700 text-white' : 'text-cyan-300 hover:bg-white/10'
                }`}
                title="Zonas guardadas (este navegador)"
              >
                <Bookmark size={11} />
                {savedZones.length}
              </button>
            )}
            {watchlists.length > 0 && (
              <button
                onClick={() => { setWatchlistsOpen(v => !v); setSavedZonesOpen(false) }}
                className={`relative flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  watchlistsOpen ? 'bg-amber-600 text-white' : 'text-amber-300 hover:bg-white/10'
                }`}
                title="Zonas seguidas (servidor)"
              >
                <Bell size={11} />
                {watchlists.length}
                {totalNovedades > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{totalNovedades}</span>
                )}
              </button>
            )}
          </div>

          {/* Dropdown de zonas guardadas */}
          {savedZonesOpen && savedZones.length > 0 && (
            <div className="absolute top-12 right-3 z-[1000] w-64 rounded-xl bg-black/80 backdrop-blur border border-white/10 overflow-hidden">
              <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-white/70 border-b border-white/10">Zonas guardadas</p>
              <div className="max-h-56 overflow-y-auto">
                {savedZones.map(z => {
                  const zMeta = ZONES.find(zz => zz.id === z.zoneId)
                  return (
                    <div key={z.id} className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 transition-colors">
                      <button onClick={() => loadSavedZone(z)} className="flex-1 min-w-0 text-left">
                        <p className="text-[11px] font-medium text-white truncate">{z.name}</p>
                        <p className="text-[10px] text-slate-500">{zMeta?.label ?? z.zoneId} · {new Date(z.savedAt).toLocaleDateString('es-CL')}</p>
                      </button>
                      <button
                        onClick={() => persistSavedZones(savedZones.filter(sz => sz.id !== z.id))}
                        className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
                        title="Eliminar zona guardada"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Dropdown de zonas seguidas (watchlists de servidor) */}
          {watchlistsOpen && watchlists.length > 0 && (
            <div className="absolute top-12 right-3 z-[1000] w-72 rounded-xl bg-black/80 backdrop-blur border border-white/10 overflow-hidden">
              <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-white/70 border-b border-white/10">Zonas seguidas · novedades de oferta</p>
              <div className="max-h-60 overflow-y-auto">
                {watchlists.map(w => {
                  const wz = ZONES.find(z => z.siiCode === w.sii_comuna_code)
                  return (
                    <div key={w.id} className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 transition-colors">
                      <button onClick={() => loadWatchlist(w)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[11px] font-medium text-white truncate">{w.name}</p>
                          {w.novedades > 0 && (
                            <span className="flex-shrink-0 text-[9px] font-bold text-white bg-red-500 rounded-full px-1.5">+{w.novedades}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {wz?.label ?? w.sii_comuna_code} · {w.current_listings} anuncios · {w.baseline_roles} roles
                        </p>
                      </button>
                      {w.novedades > 0 && (
                        <button
                          onClick={() => markWatchlistSeen(w.id)}
                          className="text-slate-400 hover:text-emerald-400 transition-colors flex-shrink-0"
                          title="Marcar como visto (poner el contador de novedades a cero)"
                        >
                          <Check size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => deleteWatchlist(w.id)}
                        className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
                        title="Dejar de seguir"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Panel de zona dibujada (farming) */}
          {drawnShape && (
            <div className="absolute bottom-8 right-3 z-[1000] w-72 rounded-xl bg-black/75 backdrop-blur border border-white/10 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                <MapPin size={12} className="text-cyan-400 flex-shrink-0" />
                <p className="text-[11px] font-semibold text-white flex-1">Zona dibujada</p>
                <button
                  onClick={saveCurrentZone}
                  className="flex items-center gap-1 text-[10px] font-semibold text-cyan-300 hover:text-cyan-200 transition-colors"
                  title="Guardar esta zona en este navegador"
                >
                  <Bookmark size={11} />
                  Guardar
                </button>
                <button
                  onClick={followCurrentZone}
                  className="flex items-center gap-1 text-[10px] font-semibold text-amber-300 hover:text-amber-200 transition-colors"
                  title="Seguir esta zona en el servidor (novedades de oferta para el equipo)"
                >
                  <Bell size={11} />
                  Seguir
                </button>
                <button
                  onClick={() => setDrawnShape(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="Quitar zona"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {zoneCountLoading ? (
                  <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><RefreshCw size={10} className="animate-spin" />Analizando zona…</p>
                ) : zoneCount != null ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] text-slate-400">Roles SII</span>
                      <span className="text-xs font-bold text-white">{zoneCount.toLocaleString('es-CL')}</span>
                    </div>
                    {zoneStats?.avaluo_promedio != null && (
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10px] text-slate-400">Avalúo promedio</span>
                        <span className="text-[11px] font-semibold text-emerald-300">{fmtCLP(zoneStats.avaluo_promedio)}</span>
                      </div>
                    )}
                    {zoneStats?.avaluo_total != null && (
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10px] text-slate-400">Avalúo total</span>
                        <span className="text-[11px] font-semibold text-slate-200">{fmtCLP(zoneStats.avaluo_total)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500">Sin roles en la zona</p>
                )}
              </div>
              {zoneRoles && zoneRoles.length > 0 && (
                <>
                  <div className="max-h-40 overflow-y-auto border-t border-white/10">
                    {zoneRoles.slice(0, 200).map((r: any) => (
                      <button
                        key={r.rol}
                        onClick={() => { setShowBuildingUnits(false); setLayerTab('catastro'); setSelectedRol({ rol: r.rol }) }}
                        className="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-white/10 transition-colors"
                      >
                        <span className="text-[10px] font-mono text-blue-300 flex-shrink-0">{r.rol}</span>
                        <span className="text-[10px] text-slate-400 truncate flex-1">{r.direccion ?? '—'}</span>
                        {r.avaluo_fiscal_total != null && (
                          <span className="text-[10px] text-slate-300 flex-shrink-0">{fmtCLP(r.avaluo_fiscal_total)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="px-3 py-2 border-t border-white/10">
                    <button
                      onClick={exportZoneCsv}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5 transition-colors"
                    >
                      <Download size={12} />
                      Exportar CSV ({zoneRoles.length}{zoneCount != null && zoneCount > zoneRoles.length ? ` de ${zoneCount}` : ''})
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="absolute bottom-1 left-2 z-[1000] pointer-events-none text-[9px] text-white/60 drop-shadow">
            Datos: SII catastral.cl · Mapa: Google
          </div>
        </div>
      </div>
    </div>
  )
}
