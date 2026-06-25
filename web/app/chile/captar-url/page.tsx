'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import PageShell from '@/components/PageShell'
import {
  Link2, Search, Building2, MapPin, Layers, ExternalLink,
  AlertCircle, CheckCircle2, RefreshCw, Home, DollarSign,
  Maximize2, BedDouble, Bath, Car, Calendar, Compass,
  Sofa, Archive, PawPrint, Receipt, Waves, Dumbbell,
  Flame, Wind, Tv, Phone, Droplets, Zap, ChevronLeft, ChevronRight
} from 'lucide-react'

const ListingMatchMap = dynamic(() => import('@/components/map/ListingMatchMap'), { ssr: false })

const DESTINO_LABELS: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

const AMENITY_ICONS: Record<string, React.ElementType> = {
  parrilla: Flame,
  calefaccion: Flame,
  aire_acondicionado: Wind,
  tv_cable: Tv,
  tv_satelital: Tv,
  linea_telefonica: Phone,
  gas_natural: Zap,
  agua_corriente: Droplets,
  caldera: Flame,
  piscina: Waves,
  gimnasio: Dumbbell,
  conexion_lavarropas: Droplets,
  alarma: AlertCircle,
  conserjeria: Home,
  ascensor: Archive,
  terraza: Compass,
  lavanderia: Droplets,
}

function fmtCLP(n: number | null) {
  if (!n) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`
  return `$${n.toLocaleString('es-CL')}`
}

function Chip({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex flex-col p-2.5 rounded-lg border ${highlight ? 'border-emerald-900/50 bg-emerald-950/20' : 'border-[var(--c-border-card)] bg-[var(--c-card)]'}`}>
      <span className="text-[10px] text-slate-600 mb-0.5">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-emerald-300' : 'text-slate-200'}`}>{value}</span>
    </div>
  )
}

export default function CaptarUrlPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [photoIdx, setPhotoIdx] = useState(0)
  const [selectedRol, setSelectedRol] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    let urlToSubmit = url.trim()
    if (!urlToSubmit) return

    // Auto-agregar https:// si falta el protocolo
    if (!urlToSubmit.startsWith('http://') && !urlToSubmit.startsWith('https://')) {
      urlToSubmit = 'https://' + urlToSubmit
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setSelectedRol(null)

    try {
      const res = await fetch('/api/chile/parse-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToSubmit }),
      })
      const data = await res.json()
      if (data.success) {
        setResult(data)
      } else {
        setError(data.error ?? 'Error al procesar la URL')
      }
    } catch {
      setError('Error de red')
    } finally {
      setLoading(false)
    }
  }

  const ext = result?.extracted ?? {}
  const amenities: Record<string, string> = ext.amenities ?? {}

  return (
    <PageShell
      title="Captar desde URL"
      subtitle="Extrae datos de un anuncio de Portal Inmobiliario y cruza con el catastro SII"
    >
      {/* URL input */}
      <form onSubmit={handleSubmit} className="mb-6">
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
            disabled={loading || !url.trim()}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            {loading ? 'Analizando...' : 'Analizar'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-700">
          Pega la URL de cualquier propiedad de portalinmobiliario.com — se extraen todos los datos del anuncio y se cruzan con los roles SII disponibles.
        </p>
      </form>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-red-900/50 bg-red-950/20 text-red-400 text-sm mb-6">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Ficha estilo España */}
          <div className="rounded-2xl overflow-hidden ring-1 ring-white/5 bg-[var(--c-card)]">
            {/* Image area with gradient overlay */}
            <div className="relative h-64 bg-[var(--c-card)] overflow-hidden group">
              {ext.lat && ext.lng ? (
                <ListingMatchMap
                  listingLat={ext.lat}
                  listingLng={ext.lng}
                  candidates={result.sii_candidates ?? []}
                  selectedRol={selectedRol}
                  onSelectCandidate={setSelectedRol}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-700 text-sm bg-gradient-to-br from-slate-900 to-slate-800">
                  Sin coordenadas — no se pudo ubicar el anuncio en el mapa
                </div>
              )}

              {/* Dark scrim bottom */}
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

              {/* Top-right: URL link */}
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white/70 flex items-center justify-center hover:bg-black/70 hover:text-white transition-all"
              >
                <ExternalLink size={14} />
              </a>

              {/* Bottom-left: price + currency */}
              <div className="absolute bottom-3 left-4">
                <div className="text-white font-bold text-lg leading-none">
                  {ext.price_raw} {ext.currency}
                </div>
              </div>

              {/* Bottom-right: operation badge */}
              {ext.operation && (
                <div className="absolute bottom-3 right-4">
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded ${
                    ext.operation === 'rent'
                      ? 'bg-violet-600/80 text-white'
                      : 'bg-blue-600/80 text-white'
                  }`}>
                    {ext.operation === 'rent' ? 'ARRIENDO' : 'VENTA'}
                  </span>
                </div>
              )}
            </div>

            {/* Content area */}
            <div className="px-4 py-4 space-y-3.5">
              {/* Commune tag */}
              {result.comuna_label && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-950/30 border border-emerald-900/50 rounded-lg w-fit">
                  <MapPin size={11} className="text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-300">{result.comuna_label}</span>
                </div>
              )}

              {/* Title */}
              <h2 className="text-slate-200 text-base font-semibold leading-snug line-clamp-2">
                {ext.title || 'Propiedad en ' + result.comuna_label}
              </h2>

              {/* Specs line */}
              <p className="text-slate-500 text-xs">
                {ext.sqm && `${ext.sqm} m²`}
                {ext.bedrooms != null && ` · ${ext.bedrooms} dorm.`}
                {ext.bathrooms != null && ` · ${ext.bathrooms} baño${ext.bathrooms !== 1 ? 's' : ''}`}
                {ext.floors && ` · ${ext.floors} piso${ext.floors !== 1 ? 's' : ''}`}
              </p>

              {/* Address */}
              {(ext.address || ext.address_full) && (
                <p className="text-slate-400 text-xs flex items-center gap-2">
                  <MapPin size={12} className="text-slate-600 flex-shrink-0" />
                  <span className="truncate">{ext.address_full ?? ext.address}</span>
                </p>
              )}

              {/* Geo coordinates link */}
              {ext.lat && ext.lng && (
                <a
                  href={`https://www.google.com/maps?q=${ext.lat},${ext.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[11px] text-blue-400 hover:text-blue-300"
                >
                  <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
                  Ver ubicación exacta ({ext.lat}, {ext.lng})
                </a>
              )}
            </div>
          </div>

          {/* Detalles expandibles */}
          <div className="space-y-6">
            {/* Core metrics */}
            <div>
              <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold mb-3">Características completas</p>
              <div className="grid grid-cols-3 gap-2">
                {ext.operation && <Chip label="Operación" value={ext.operation === 'rent' ? 'Arriendo' : 'Venta'} />}
                {(ext.property_type || ext.property_type_detail) && (
                  <Chip label="Tipo" value={ext.property_type_detail ?? ext.property_type} />
                )}
                {ext.price_raw && <Chip label="Precio" value={`${ext.price_raw} ${ext.currency ?? ''}`} highlight />}
                {ext.sqm && <Chip label="Sup. total" value={`${ext.sqm} m²`} />}
                {ext.sqm_util && <Chip label="Sup. útil" value={`${ext.sqm_util} m²`} />}
                {ext.bedrooms != null && <Chip label="Dormitorios" value={String(ext.bedrooms)} />}
                {ext.bathrooms != null && <Chip label="Baños" value={String(ext.bathrooms)} />}
                {ext.parking != null && <Chip label="Estacionamientos" value={String(ext.parking)} />}
                {ext.storage != null && <Chip label="Bodegas" value={String(ext.storage)} />}
                {ext.floors != null && <Chip label="Pisos" value={String(ext.floors)} />}
                {ext.antiquity && <Chip label="Antigüedad" value={String(ext.antiquity)} />}
                {ext.orientation && <Chip label="Orientación" value={String(ext.orientation)} />}
                {ext.furnished && <Chip label="Amoblado" value={String(ext.furnished)} />}
                {ext.allows_pets && <Chip label="Mascotas" value={String(ext.allows_pets)} />}
                {ext.common_expenses && <Chip label="Gastos comunes" value={String(ext.common_expenses)} />}
              </div>
            </div>

          {/* Amenities */}
          {Object.keys(amenities).length > 0 && (
            <div>
              <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold mb-3">Comodidades y servicios</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(amenities).map(([key, val]) => {
                  const Icon = AMENITY_ICONS[key] ?? CheckCircle2
                  const isYes = val.toLowerCase() === 'sí' || val.toLowerCase() === 'si' || val === '1' || val.toLowerCase() === 'yes'
                  return (
                    <div key={key} className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${
                      isYes
                        ? 'border-emerald-900/40 bg-emerald-950/10 text-emerald-300'
                        : 'border-[var(--c-border-card)] bg-[var(--c-card)] text-slate-600'
                    }`}>
                      <Icon size={12} className="flex-shrink-0" />
                      <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Geo */}
          <div>
            <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold mb-3">Ubicación</p>
            <div className="space-y-2">
              {(ext.address || ext.address_full) && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]">
                  <MapPin size={14} className="text-slate-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] text-slate-600 mb-0.5">Dirección</p>
                    <p className="text-sm text-slate-200 font-medium">{ext.address_full ?? ext.address}</p>
                    {ext.address_full && ext.address && ext.address_full !== ext.address && (
                      <p className="text-[11px] text-slate-600 mt-0.5">{ext.address}</p>
                    )}
                  </div>
                </div>
              )}
              {ext.lat && ext.lng && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl border border-emerald-900/40 bg-emerald-950/20">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] text-slate-600 mb-0.5">Coordenadas (pin del mapa)</p>
                    <p className="text-sm text-emerald-300 font-mono">{ext.lat}, {ext.lng}</p>
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${ext.lat},${ext.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                  >
                    Ver <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* SII cross-reference */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold">
                Roles SII candidatos {result.sii_candidates?.length > 0 ? `(${result.sii_candidates.length})` : ''}
              </p>
              {result.sii_code && (
                <a
                  href={`/chile/catastro?zona=${result.sii_code}`}
                  className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                >
                  Ver en catastro <ExternalLink size={10} />
                </a>
              )}
            </div>

            {!result.sii_code ? (
              <div className="p-4 rounded-xl border border-amber-900/40 bg-amber-950/20 text-amber-400 text-sm flex items-center gap-2">
                <AlertCircle size={14} />
                No se detectó una comuna con datos SII disponibles. Comunas disponibles: Vitacura, Las Condes, Lo Barnechea, Colina.
              </div>
            ) : result.sii_candidates?.length === 0 ? (
              <div className="p-4 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] text-slate-600 text-sm">
                Sin coincidencias en el catastro SII para {result.comuna_label}.
                {!ext.address && ' No se pudo extraer la dirección del anuncio para filtrar.'}
              </div>
            ) : (
              <div className="space-y-2">
                {result.sii_candidates.map((rol: any, i: number) => {
                  const score = rol.match_score as number | undefined
                  const percentScore = score ? Math.round(score * 100) : null

                  let confidence_level = 'low_candidate'
                  let scoreBadgeColor = 'bg-red-950/40 border-red-900/50 text-red-400'
                  if (percentScore && percentScore >= 92) {
                    confidence_level = 'confirmed'
                    scoreBadgeColor = 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400'
                  } else if (percentScore && percentScore >= 80) {
                    confidence_level = 'high_candidate'
                    scoreBadgeColor = 'bg-green-950/40 border-green-900/50 text-green-400'
                  } else if (percentScore && percentScore >= 65) {
                    confidence_level = 'candidate'
                    scoreBadgeColor = 'bg-amber-950/40 border-amber-900/50 text-amber-400'
                  }

                  const isSelected = selectedRol === rol.rol
                  return (
                    <button
                      key={rol.rol}
                      type="button"
                      onClick={() => setSelectedRol(rol.rol)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors group ${
                        isSelected ? 'border-blue-600 bg-blue-950/30' : 'border-[var(--c-border-card)] bg-[var(--c-card)] hover:border-blue-700/50 hover:bg-blue-950/20'
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-950 border border-blue-800/50 flex items-center justify-center text-[10px] font-bold text-blue-400 flex-shrink-0">
                        {i + 1}
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
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        {percentScore != null && (
                          <div className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${scoreBadgeColor}`}>
                            {percentScore}%
                          </div>
                        )}
                        <p className="text-sm font-semibold text-slate-200">{fmtCLP(rol.avaluo_fiscal_total)}</p>
                      </div>
                      <a
                        href="/chile/catastro"
                        onClick={(e) => e.stopPropagation()}
                        className="flex-shrink-0"
                      >
                        <ExternalLink size={12} className="text-slate-700 group-hover:text-slate-400" />
                      </a>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

            {ext.fetch_error && (
              <p className="text-[11px] text-slate-700 flex items-center gap-1.5">
                <AlertCircle size={11} className="text-amber-700" />
                Nota: no se pudo cargar la página del anuncio ({ext.fetch_error}) — los datos provienen solo del slug de la URL.
              </p>
            )}
          </div>
        </div>
      )}
    </PageShell>
  )
}
