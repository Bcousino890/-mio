import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/admin/mercado-agregado-upload
 *
 * Importa indicadores AGREGADOS de mercado a `mercado_agregado_cl` (migración
 * 0057). Pensado para las estadísticas de transferencias del SII descargadas a
 * mano (nº de operaciones y monto por comuna/período), y para cargar a mano
 * indicadores de valor de suelo si se exportan de MINVU a CSV. La geometría de
 * zona (MINVU) NO se importa por aquí — para eso está `scraper/ingest-minvu-suelo.mjs`.
 *
 * No hay precios de cierre públicos por predio (ver docs/CBR-TRANSACCIONES-REPOS-2026.md):
 * esta tabla es el ancla de mercado a nivel zona/comuna que calibra el AVM.
 *
 * Cuerpo: el CSV como texto plano (Content-Type text/csv o text/plain).
 * Delimitador `;` o `,` (autodetectado). Primera línea = cabecera. Columnas
 * aceptadas (las demás se ignoran; el orden no importa):
 *
 *   sii_comuna_code  (requerido)  código SII de la comuna, ej. 13101
 *   periodo          (requerido)  ej. 2024 | 2024-S1 | 2024-03
 *   fuente                        'sii_transferencias' (por defecto) | 'minvu_suelo'
 *   zona_id                       id de zona MINVU (opcional)
 *   valor_uf_m2                   numérico (MINVU)
 *   n_operaciones                 entero (SII)
 *   monto_total_uf                numérico (SII)
 */

const KNOWN_COLS = new Set([
  'sii_comuna_code', 'periodo', 'fuente', 'zona_id',
  'valor_uf_m2', 'n_operaciones', 'monto_total_uf',
])

function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === delim) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function toIntOrNull(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v.replace(/[.\s]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n) : null
}
function toNumOrNull(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export async function POST(request: NextRequest) {
  try {
    const text = await request.text()
    if (!text.trim()) return NextResponse.json({ success: false, error: 'CSV vacío' }, { status: 400 })

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
    if (lines.length < 2) return NextResponse.json({ success: false, error: 'CSV sin filas de datos' }, { status: 400 })

    const delim = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
    const header = splitLine(lines[0], delim).map(h => h.toLowerCase())
    const idx: Record<string, number> = {}
    header.forEach((h, i) => { if (KNOWN_COLS.has(h)) idx[h] = i })

    if (idx.sii_comuna_code == null || idx.periodo == null) {
      return NextResponse.json({ success: false, error: 'Faltan columnas obligatorias sii_comuna_code y/o periodo' }, { status: 400 })
    }

    const rows: (string | number | null)[][] = []
    let skipped = 0
    for (let i = 1; i < lines.length; i++) {
      const f = splitLine(lines[i], delim)
      const comuna = f[idx.sii_comuna_code]?.trim()
      const periodo = f[idx.periodo]?.trim()
      if (!comuna || !periodo) { skipped++; continue }
      const fuente = (idx.fuente != null ? f[idx.fuente]?.trim() : '') || 'sii_transferencias'
      rows.push([
        fuente, comuna, periodo,
        idx.zona_id != null ? (f[idx.zona_id]?.trim() || null) : null,
        toNumOrNull(idx.valor_uf_m2 != null ? f[idx.valor_uf_m2] : undefined),
        toIntOrNull(idx.n_operaciones != null ? f[idx.n_operaciones] : undefined),
        toNumOrNull(idx.monto_total_uf != null ? f[idx.monto_total_uf] : undefined),
      ])
    }

    if (rows.length === 0) return NextResponse.json({ success: false, error: 'No se pudo leer ninguna fila válida', skipped }, { status: 400 })

    const BATCH = 1000
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const cols = batch[0].map((_, c) => batch.map(r => r[c]))
      await pool.query(
        `INSERT INTO mercado_agregado_cl
           (fuente, sii_comuna_code, periodo, zona_id, valor_uf_m2, n_operaciones, monto_total_uf, raw_source)
         SELECT *, 'upload'::text FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::integer[], $7::numeric[]
         ) AS t(fuente, sii_comuna_code, periodo, zona_id, valor_uf_m2, n_operaciones, monto_total_uf)`,
        cols
      )
      inserted += batch.length
    }

    return NextResponse.json({ success: true, inserted, skipped })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
