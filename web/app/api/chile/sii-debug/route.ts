import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export async function GET() {
  try {
    const [codesRes, serieRes, sampleRes, tableCheckRes, construDiag, migsRes] = await Promise.all([
      pool.query(`SELECT sii_comuna_code, COUNT(*) as cnt FROM sii_roles_cl GROUP BY sii_comuna_code ORDER BY cnt DESC LIMIT 20`),
      pool.query(`SELECT serie, COUNT(*) as cnt FROM sii_roles_cl GROUP BY serie ORDER BY cnt DESC LIMIT 20`),
      pool.query(`SELECT * FROM sii_roles_cl LIMIT 3`),
      pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'sii_roles_cl' ORDER BY ordinal_position`),
      // Diagnóstico temporal de construcciones por comuna (Lo Barnechea vs Vitacura)
      pool.query(`
        SELECT r.sii_comuna_code, COUNT(c.id)::int AS construcciones, COUNT(DISTINCT c.rol_id)::int AS roles_con_construccion
        FROM sii_roles_cl r JOIN sii_construcciones_cl c ON c.rol_id = r.id
        WHERE r.sii_comuna_code IN ('15161','15160','15108','15103')
        GROUP BY r.sii_comuna_code`),
      pool.query(`SELECT filename FROM schema_migrations WHERE filename LIKE '006%' ORDER BY filename`).catch(() => ({ rows: [] })),
    ])
    return NextResponse.json({
      success: true,
      codes: codesRes.rows,
      series: serieRes.rows,
      sample: sampleRes.rows,
      columns: tableCheckRes.rows.map((r: any) => r.column_name),
      construcciones_por_comuna: construDiag.rows,
      migraciones_006x: migsRes.rows.map((r: any) => r.filename),
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) })
  }
}
