'use client'

import { useEffect, useState } from 'react'
import { Database, Loader2 } from 'lucide-react'

interface SiiCoverageRow {
  sii_comuna_code: string
  roles: number
}

interface Props {
  /** Mapa código SII → etiqueta legible, para las comunas que ya conocemos (ver ZONES en page.tsx). */
  knownCodes: Record<string, string>
}

/**
 * Indicador de solo lectura: qué `sii_comuna_code` tienen datos reales ya
 * ingeridos (vía /api/chile/sii-coverage → tabla `sii_roles_cl`) y cuántas
 * filas. Sirve para leer el código SII real de una comuna recién subida
 * (ej. Lo Barnechea) directamente desde la verdad ingerida, en vez de
 * adivinarlo como hizo la migración 0022_sii_comuna_codes.sql con códigos
 * INE no confirmados.
 */
export default function SiiCoverageIndicator({ knownCodes }: Props) {
  const [rows, setRows] = useState<SiiCoverageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/chile/sii-coverage')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        if (!json.success) throw new Error(json.error ?? 'Error desconocido')
        setRows(json.data ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error al cargar cobertura SII')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex items-center gap-2 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg px-3 py-1.5">
      <Database size={12} className="text-emerald-400 flex-shrink-0" />
      <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">Cobertura SII:</span>
      {loading && <Loader2 size={11} className="animate-spin text-slate-500" />}
      {!loading && error && <span className="text-[11px] text-red-400">{error}</span>}
      {!loading && !error && rows && rows.length === 0 && (
        <span className="text-[11px] text-slate-600">Sin datos ingeridos todavía</span>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {rows.map((row) => (
            <span
              key={row.sii_comuna_code}
              title={`${row.roles.toLocaleString('es-CL')} roles ingeridos`}
              className="text-[11px] text-slate-300 bg-[var(--c-hover)] border border-[var(--c-border)] rounded px-1.5 py-0.5"
            >
              {knownCodes[row.sii_comuna_code] ?? row.sii_comuna_code}
              <span className="text-slate-600"> · {row.roles.toLocaleString('es-CL')}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
