import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/admin/avaluo-historico-upload
 *
 * Importa la serie histórica de avalúo por rol a `sii_avaluo_historico_cl`
 * (migración 0058). Fuente: CSVs históricos del SII procesados por
 * catastral.cl / roles-backend (`catastro_historico`, 16 períodos 2018-2025).
 *
 * NO es precio de venta: es la evolución del AVALÚO FISCAL (ver
 * docs/CBR-TRANSACCIONES-REPOS-2026.md). Para transformar el CSV histórico de
 * catastral.cl a este formato basta con proyectar sus columnas por período a
 * (sii_comuna_code, rol, periodo, avaluo_total, avaluo_exento).
 *
 * Cuerpo: CSV como texto plano (text/csv o text/plain). Delimitador `;`/`,`
 * autodetectado. Cabecera en la primera línea. Columnas aceptadas:
 *
 *   sii_comuna_code  (requerido)
 *   rol              (requerido)  "manzana-predio"
 *   periodo          (requerido)  'YYYY-1' | 'YYYY-2'
 *   avaluo_total                  entero (CLP)
 *   avaluo_exento                 entero (CLP)
 *
 * Upsert por (sii_comuna_code, rol, periodo): reprocesar el mismo período
 * actualiza los montos en vez de duplicar.
 */

const KNOWN_COLS = new Set([
  'sii_comuna_code', 'rol', 'periodo', 'avaluo_total', 'avaluo_exento',
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

    if (idx.sii_comuna_code == null || idx.rol == null || idx.periodo == null) {
      return NextResponse.json({ success: false, error: 'Faltan columnas obligatorias sii_comuna_code, rol y/o periodo' }, { status: 400 })
    }

    const rows: (string | number | null)[][] = []
    let skipped = 0
    for (let i = 1; i < lines.length; i++) {
      const f = splitLine(lines[i], delim)
      const comuna = f[idx.sii_comuna_code]?.trim()
      const rol = f[idx.rol]?.trim()
      const periodo = f[idx.periodo]?.trim()
      if (!comuna || !rol || !periodo) { skipped++; continue }
      rows.push([
        comuna, rol, periodo,
        toIntOrNull(idx.avaluo_total != null ? f[idx.avaluo_total] : undefined),
        toIntOrNull(idx.avaluo_exento != null ? f[idx.avaluo_exento] : undefined),
      ])
    }

    if (rows.length === 0) return NextResponse.json({ success: false, error: 'No se pudo leer ninguna fila válida', skipped }, { status: 400 })

    const BATCH = 1000
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const cols = batch[0].map((_, c) => batch.map(r => r[c]))
      await pool.query(
        `INSERT INTO sii_avaluo_historico_cl
           (sii_comuna_code, rol, periodo, avaluo_total, avaluo_exento)
         SELECT * FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::bigint[], $5::bigint[]
         ) AS t(sii_comuna_code, rol, periodo, avaluo_total, avaluo_exento)
         ON CONFLICT (sii_comuna_code, rol, periodo) DO UPDATE SET
           avaluo_total = EXCLUDED.avaluo_total,
           avaluo_exento = EXCLUDED.avaluo_exento`,
        cols
      )
      inserted += batch.length
    }

    return NextResponse.json({ success: true, inserted, skipped })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
