import { NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET() {
  try {
    const [codesRes, serieRes, sampleRes, tableCheckRes] = await Promise.all([
      pool.query(`SELECT sii_comuna_code, COUNT(*) as cnt FROM sii_roles_cl GROUP BY sii_comuna_code ORDER BY cnt DESC LIMIT 20`),
      pool.query(`SELECT serie, COUNT(*) as cnt FROM sii_roles_cl GROUP BY serie ORDER BY cnt DESC LIMIT 20`),
      pool.query(`SELECT * FROM sii_roles_cl LIMIT 3`),
      pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'sii_roles_cl' ORDER BY ordinal_position`),
    ])
    return NextResponse.json({
      success: true,
      codes: codesRes.rows,
      series: serieRes.rows,
      sample: sampleRes.rows,
      columns: tableCheckRes.rows.map((r: any) => r.column_name),
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) })
  }
}
