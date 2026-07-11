import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/admin/transacciones-upload
 *
 * Importa compraventas (Conservador de Bienes Raíces) a `sii_transacciones_cl`.
 * No existe un CSV público del CBR (ver docs/SII-ENRICHMENT-ROADMAP.md); este
 * endpoint es el punto de entrada para cargar un dataset obtenido de un
 * proveedor comercial (databam / TocToc / etc.) o de un ETL propio.
 *
 * Cuerpo: el CSV como texto plano en el body (Content-Type text/csv o
 * text/plain). Delimitador `;` o `,` (autodetectado por la cabecera). La
 * primera línea es la cabecera; se aceptan estas columnas (las demás se
 * ignoran; el orden no importa):
 *
 *   sii_comuna_code  (requerido)  código SII de la comuna, ej. 15108
 *   rol              (requerido)  "manzana-predio", ej. 795-198
 *   fecha_escritura              YYYY-MM-DD
 *   monto_clp                    entero en pesos
 *   monto_uf                     numérico
 *   superficie_m2                entero
 *   foja_numero_anio             ej. 12345/678/2023
 *   cbr_nombre                   ej. "CBR Santiago"
 *   h3_index                     H3 nivel 8 (opcional)
 *
 * uf_por_m2 es columna generada en la tabla — no se importa.
 */

const KNOWN_COLS = new Set([
  'sii_comuna_code', 'rol', 'fecha_escritura', 'monto_clp', 'monto_uf',
  'superficie_m2', 'foja_numero_anio', 'cbr_nombre', 'h3_index',
])

function splitLine(line: string, delim: string): string[] {
  // Parser CSV mínimo con soporte de comillas dobles (y "" escapado).
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
function toDateOrNull(v: string | undefined): string | null {
  if (!v) return null
  const m = v.match(/(\d{4})-(\d{2})-(\d{2})/) || v.match(/(\d{2})[/-](\d{2})[/-](\d{4})/)
  if (!m) return null
  return m[0].includes('-') && m[1].length === 4 ? m[0] : `${m[3]}-${m[2]}-${m[1]}`
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

    if (idx.sii_comuna_code == null || idx.rol == null) {
      return NextResponse.json({ success: false, error: 'Faltan columnas obligatorias sii_comuna_code y/o rol' }, { status: 400 })
    }

    const rows: (string | number | null)[][] = []
    let skipped = 0
    for (let i = 1; i < lines.length; i++) {
      const f = splitLine(lines[i], delim)
      const comuna = f[idx.sii_comuna_code]?.trim()
      const rol = f[idx.rol]?.trim()
      if (!comuna || !rol) { skipped++; continue }
      rows.push([
        comuna, rol,
        toDateOrNull(idx.fecha_escritura != null ? f[idx.fecha_escritura] : undefined),
        toIntOrNull(idx.monto_clp != null ? f[idx.monto_clp] : undefined),
        toNumOrNull(idx.monto_uf != null ? f[idx.monto_uf] : undefined),
        toIntOrNull(idx.superficie_m2 != null ? f[idx.superficie_m2] : undefined),
        idx.foja_numero_anio != null ? (f[idx.foja_numero_anio]?.trim() || null) : null,
        idx.cbr_nombre != null ? (f[idx.cbr_nombre]?.trim() || null) : null,
        idx.h3_index != null ? (f[idx.h3_index]?.trim() || null) : null,
      ])
    }

    if (rows.length === 0) return NextResponse.json({ success: false, error: 'No se pudo leer ninguna fila válida', skipped }, { status: 400 })

    // Inserción por lotes con unnest() — rápido y sin construir un VALUES gigante.
    const BATCH = 1000
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const cols = batch[0].map((_, c) => batch.map(r => r[c]))
      await pool.query(
        `INSERT INTO sii_transacciones_cl
           (sii_comuna_code, rol, fecha_escritura, monto_clp, monto_uf, superficie_m2, foja_numero_anio, cbr_nombre, h3_index, fuente, raw_source)
         SELECT * FROM unnest(
           $1::text[], $2::text[], $3::date[], $4::bigint[], $5::numeric[], $6::integer[], $7::text[], $8::text[], $9::text[]
         ) AS t(sii_comuna_code, rol, fecha_escritura, monto_clp, monto_uf, superficie_m2, foja_numero_anio, cbr_nombre, h3_index),
         LATERAL (SELECT 'cbr'::text, 'upload'::text) AS s(fuente, raw_source)`,
        cols
      )
      inserted += batch.length
    }

    return NextResponse.json({ success: true, inserted, skipped })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
