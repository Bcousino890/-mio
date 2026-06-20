'use client'

import { useState } from 'react'
import { Search, Loader2, Building2 } from 'lucide-react'

interface SiiAddressMatch {
  rol: string
  direccion: string
  similarity: number
}

interface SiiRolMetadata {
  rol: string
  direccion: string | null
  avaluo_fiscal_total: number | null
  superficie_terreno_m2: number | null
  sqm: number | null
  superficie_construida_total_m2: number | null
  numero_pisos: number | null
  anio_construccion: number | null
  property_type: string | null
  codigo_destino_principal: string | null
  rol_bien_comun_1: string | null
  rol_bien_comun_2: string | null
  rol_padre: string | null
}

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })

interface Props {
  comunaCode: string
  comunaLabel: string
}

/**
 * Buscador de Roles SII reales (Detalle Catastral + Rol de Cobro), ingeridos
 * vía scraper/lib/sii-catastro-cl.mjs desde un archivo subido manualmente
 * desde sii.cl — NUNCA scraping en vivo. Disponible solo para comunas con
 * datos ya ingeridos (ver migración 0021_sii_catastro_cl.sql).
 */
export default function SiiRolSearchPanel({ comunaCode, comunaLabel }: Props) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [matches, setMatches] = useState<SiiAddressMatch[]>([])
  const [selected, setSelected] = useState<SiiRolMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setSelected(null)
    setSearched(true)
    try {
      const res = await fetch(`/api/chile/sii-roles?comuna=${comunaCode}&address=${encodeURIComponent(query.trim())}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error desconocido')
      setMatches(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al buscar')
      setMatches([])
    } finally {
      setLoading(false)
    }
  }

  async function handleSelect(rol: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/chile/sii-roles?comuna=${comunaCode}&rol=${encodeURIComponent(rol)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Error desconocido')
      setSelected(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el rol')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 h-[560px] flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <Building2 size={14} className="text-emerald-400" />
        <p className="text-sm font-semibold text-slate-200">Rol SII real</p>
      </div>
      <p className="text-[11px] text-slate-600 mb-3">
        Datos catastrales reales de {comunaLabel} (avalúo, m², destino) — descarga oficial de sii.cl, subida manualmente.
      </p>

      <form onSubmit={handleSearch} className="flex items-center gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Dirección, ej. Estocolmo 540"
          className="flex-1 bg-[var(--c-hover)] border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Buscar
        </button>
      </form>

      <div className="flex-1 overflow-y-auto">
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

        {selected ? (
          <RolDetailCard data={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="space-y-1.5">
            {searched && !loading && matches.length === 0 && !error && (
              <p className="text-xs text-slate-600">Sin coincidencias para &quot;{query}&quot;.</p>
            )}
            {matches.map((m) => (
              <button
                key={m.rol}
                onClick={() => handleSelect(m.rol)}
                className="w-full text-left bg-[var(--c-hover)] hover:bg-[var(--c-active)] border border-[var(--c-border)] rounded-lg px-3 py-2 transition-colors"
              >
                <p className="text-xs text-slate-200 font-medium">{m.direccion}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[11px] text-slate-500">Rol {m.rol}</span>
                  <span className="text-[10px] text-emerald-400">{Math.round(m.similarity * 100)}% similar</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RolDetailCard({ data, onBack }: { data: SiiRolMetadata; onBack: () => void }) {
  return (
    <div>
      <button onClick={onBack} className="text-[11px] text-blue-400 hover:text-blue-300 mb-2">
        ← Volver a resultados
      </button>
      <div className="space-y-2.5">
        <div>
          <p className="text-sm font-semibold text-slate-200">{data.direccion ?? 'Sin dirección'}</p>
          <p className="text-[11px] text-slate-500">Rol {data.rol}</p>
        </div>
        <Row label="Avalúo fiscal" value={data.avaluo_fiscal_total != null ? CLP.format(data.avaluo_fiscal_total) : '—'} />
        <Row label="Destino" value={data.property_type ?? '—'} />
        <Row label="Superficie terreno" value={data.superficie_terreno_m2 != null ? `${data.superficie_terreno_m2} m²` : '—'} />
        <Row label="Superficie construida" value={data.superficie_construida_total_m2 != null ? `${data.superficie_construida_total_m2} m²` : '—'} />
        <Row label="Pisos" value={data.numero_pisos != null ? String(data.numero_pisos) : '—'} />
        <Row label="Año construcción" value={data.anio_construccion != null ? String(data.anio_construccion) : '—'} />
        {data.rol_bien_comun_1 && <Row label="Rol bien común" value={data.rol_bien_comun_1} />}
        {data.rol_padre && <Row label="Rol padre" value={data.rol_padre} />}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--c-border)] pb-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="text-[11px] text-slate-300 font-medium text-right">{value}</span>
    </div>
  )
}
