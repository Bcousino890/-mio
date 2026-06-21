'use client'

import { useState } from 'react'
import PageShell from '@/components/PageShell'
import {
  Link2, Search, Building2, MapPin, Layers, ExternalLink,
  AlertCircle, CheckCircle2, RefreshCw, Home, DollarSign,
  Maximize2, BedDouble, Bath
} from 'lucide-react'

const DESTINO_LABELS: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

function fmtCLP(n: number | null) {
  if (!n) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`
  return `$${n.toLocaleString('es-CL')}`
}

export default function CaptarUrlPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/chile/parse-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
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
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.portalinmobiliario.com/MLC-..."
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
          Pega la URL de cualquier propiedad de portalinmobiliario.com — se extraen datos del anuncio y se cruzan con los roles SII disponibles.
        </p>
      </form>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-red-900/50 bg-red-950/20 text-red-400 text-sm mb-6">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-5">
          {/* Header: URL + commune */}
          <div className="flex items-center gap-3 p-4 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-600 mb-1">URL analizada</p>
              <a href={result.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 truncate">
                {result.url}<ExternalLink size={11} />
              </a>
            </div>
            {result.comuna_label && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-900/50">
                <MapPin size={12} className="text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">{result.comuna_label}</span>
                {result.sii_code && <span className="text-[10px] text-emerald-600">SII {result.sii_code}</span>}
              </div>
            )}
          </div>

          {/* Extracted property data */}
          <div>
            <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold mb-3">Datos extraídos del anuncio</p>
            <div className="grid grid-cols-2 gap-3">
              {ext.title && (
                <div className="col-span-2 p-3 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]">
                  <p className="text-[10px] text-slate-600 mb-0.5">Título</p>
                  <p className="text-sm text-slate-200 font-medium">{ext.title}</p>
                </div>
              )}
              {[
                { label: 'Operación', value: ext.operation === 'rent' ? 'Arriendo' : ext.operation === 'sale' ? 'Venta' : null, icon: Home },
                { label: 'Tipo', value: ext.property_type, icon: Building2 },
                { label: 'Habitaciones', value: ext.bedrooms, icon: BedDouble },
                { label: 'Baños', value: ext.bathrooms, icon: Bath },
                { label: 'Superficie', value: ext.sqm ? `${ext.sqm} m²` : null, icon: Maximize2 },
                { label: 'Precio', value: ext.price_raw ? `${ext.price_raw} ${ext.currency ?? ''}` : null, icon: DollarSign },
              ].map(({ label, value, icon: Icon }) => value != null ? (
                <div key={label} className="flex items-center gap-2.5 p-3 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]">
                  <Icon size={14} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-600">{label}</p>
                    <p className="text-sm text-slate-200 font-medium capitalize">{String(value)}</p>
                  </div>
                </div>
              ) : null)}
              {ext.address && (
                <div className="col-span-2 flex items-center gap-2.5 p-3 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]">
                  <MapPin size={14} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-600">Dirección extraída</p>
                    <p className="text-sm text-slate-200 font-medium">{ext.address}</p>
                  </div>
                </div>
              )}
              {ext.lat && ext.lng && (
                <div className="col-span-2 flex items-center gap-2.5 p-3 rounded-xl border border-emerald-900/40 bg-emerald-950/20">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-600">Coordenadas detectadas</p>
                    <p className="text-sm text-emerald-300 font-mono">{ext.lat}, {ext.lng}</p>
                  </div>
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
                {result.sii_candidates.map((rol: any, i: number) => (
                  <a
                    key={rol.rol}
                    href={`/chile/catastro`}
                    className="flex items-center gap-3 p-3 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] hover:border-blue-700/50 hover:bg-blue-950/20 transition-colors group"
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
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-slate-200">{fmtCLP(rol.avaluo_fiscal_total)}</p>
                      {rol.superficie_terreno_m2 && (
                        <p className="text-[10px] text-slate-600">{rol.superficie_terreno_m2} m²</p>
                      )}
                    </div>
                    <ExternalLink size={12} className="text-slate-700 group-hover:text-slate-400 flex-shrink-0" />
                  </a>
                ))}
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
      )}
    </PageShell>
  )
}
