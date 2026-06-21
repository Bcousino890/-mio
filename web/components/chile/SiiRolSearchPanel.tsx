'use client'

import { useState } from 'react'
import { Search, Loader2, Building2, MapPin } from 'lucide-react'

interface SiiAddressMatch {
  rol: string
  direccion: string
  similarity: number
}

interface SiiRolMetadata {
  rol: string
  direccion: string | null
  avaluo_fiscal_total: number | null
  avaluo_exento: number | null
  contribucion_semestral: number | null
  codigo_ubicacion: 'R' | 'U' | 'E' | null
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
  rol_cobro_anio: number | null
  rol_cobro_semestre: number | null
  rol_cobro_avaluo_total: number | null
  rol_cobro_avaluo_exento: number | null
  rol_cobro_cuota_trimestral: number | null
}

const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })

const UBICACION_LABEL: Record<'R' | 'U' | 'E', string> = {
  U: 'Urbano',
  R: 'Rural',
  E: 'No documentado (E)',
}

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
        <span className="flex items-center gap-1 text-[10px] text-slate-500 bg-[var(--c-hover)] border border-[var(--c-border)] rounded px-1.5 py-0.5 ml-auto">
          <MapPin size={9} />
          {comunaLabel}
        </span>
      </div>
      <p className="text-[11px] text-slate-600 mb-3">
        Datos catastrales reales (avalúo, m², destino) — descarga oficial de sii.cl, subida manualmente.
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
          disabled={loading || !query.trim()}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Buscar
        </button>
      </form>

      <div className="flex-1 overflow-y-auto">
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

        {selected ? (
          <RolDetailCard data={selected} comunaLabel={comunaLabel} onBack={() => setSelected(null)} />
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500 py-8">
            <Loader2 size={13} className="animate-spin" />
            Buscando…
          </div>
        ) : (
          <div className="space-y-1.5">
            {!searched && (
              <p className="text-xs text-slate-600 text-center py-8">
                Ingresa una dirección de {comunaLabel} para buscar su Rol SII real.
              </p>
            )}
            {searched && matches.length === 0 && !error && (
              <p className="text-xs text-slate-600 text-center py-8">
                Sin coincidencias para &quot;{query}&quot; en {comunaLabel}.
              </p>
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

function RolDetailCard({
  data,
  comunaLabel,
  onBack,
}: {
  data: SiiRolMetadata
  comunaLabel: string
  onBack: () => void
}) {
  const cobroPeriodo =
    data.rol_cobro_anio != null && data.rol_cobro_semestre != null
      ? `${data.rol_cobro_anio} · ${data.rol_cobro_semestre}° semestre`
      : null

  return (
    <div>
      <button onClick={onBack} className="text-[11px] text-blue-400 hover:text-blue-300 mb-2">
        ← Volver a resultados
      </button>

      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-200">{data.direccion ?? 'Sin dirección'}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-[11px] text-slate-500">Rol {data.rol}</p>
          <span className="text-[10px] text-slate-600">·</span>
          <p className="text-[11px] text-slate-500">{comunaLabel}</p>
          {data.codigo_ubicacion && (
            <>
              <span className="text-[10px] text-slate-600">·</span>
              <span className="text-[10px] text-slate-400 bg-[var(--c-hover)] border border-[var(--c-border)] rounded px-1 py-0.5">
                {UBICACION_LABEL[data.codigo_ubicacion]}
              </span>
            </>
          )}
        </div>
      </div>

      <SectionLabel>Avalúo y contribución</SectionLabel>
      <div className="space-y-2 mb-3">
        <Row label="Avalúo afecto" value={data.avaluo_fiscal_total != null ? CLP.format(data.avaluo_fiscal_total) : '—'} />
        <Row label="Avalúo exento" value={data.avaluo_exento != null ? CLP.format(data.avaluo_exento) : '—'} />
        <Row
          label="Contribución semestral"
          value={data.contribucion_semestral != null ? CLP.format(data.contribucion_semestral) : '—'}
        />
        {(cobroPeriodo || data.rol_cobro_cuota_trimestral != null) && (
          <Row
            label={`Rol de cobro${cobroPeriodo ? ` (${cobroPeriodo})` : ''}`}
            value={data.rol_cobro_cuota_trimestral != null ? `${CLP.format(data.rol_cobro_cuota_trimestral)} / cuota` : '—'}
          />
        )}
      </div>

      <SectionLabel>Superficie y construcción</SectionLabel>
      <div className="space-y-2 mb-3">
        <Row label="Destino" value={data.property_type ?? '—'} />
        <Row label="Superficie terreno" value={data.superficie_terreno_m2 != null ? `${data.superficie_terreno_m2} m²` : '—'} />
        <Row
          label="Superficie construida"
          value={data.superficie_construida_total_m2 != null ? `${data.superficie_construida_total_m2} m²` : '—'}
        />
        <Row label="Pisos" value={data.numero_pisos != null ? String(data.numero_pisos) : '—'} />
        <Row label="Año construcción" value={data.anio_construccion != null ? String(data.anio_construccion) : '—'} />
      </div>

      {(data.rol_bien_comun_1 || data.rol_padre) && (
        <>
          <SectionLabel>Copropiedad</SectionLabel>
          <div className="space-y-2">
            {data.rol_bien_comun_1 && <Row label="Rol bien común" value={data.rol_bien_comun_1} />}
            {data.rol_padre && <Row label="Rol padre" value={data.rol_padre} />}
          </div>
        </>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{children}</p>
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--c-border)] pb-1.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="text-[11px] text-slate-300 font-medium text-right">{value}</span>
    </div>
  )
}
