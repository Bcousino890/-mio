import { NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

interface SiiCoverageRow {
  sii_comuna_code: string
  roles: number
}

/**
 * GET /api/chile/sii-coverage
 *
 * Lista de solo lectura de los `sii_comuna_code` que tienen datos reales ya
 * ingeridos en `sii_roles_cl` (ver 0021_sii_catastro_cl.sql), junto con el
 * conteo de roles por comuna. Existe porque el código de comuna que usa el
 * SII en sus archivos de descarga NO siempre coincide con el código INE
 * político-administrativo (ver comentario en 0020/0022_sii_comuna_codes.sql:
 * esos códigos son adivinanzas no confirmadas) — en vez de adivinar el
 * código SII real de una comuna recién subida, esta ruta permite leerlo
 * directamente desde los datos ya ingeridos.
 *
 * No hace ninguna petición a sii.cl: solo consulta la tabla local poblada
 * por archivos subidos manualmente vía /configuracion.
 */
export async function GET() {
  try {
    const res = await pool.query<SiiCoverageRow>(
      `SELECT sii_comuna_code, count(*) AS roles
       FROM sii_roles_cl
       GROUP BY sii_comuna_code
       ORDER BY roles DESC`
    )

    const data = res.rows.map((row) => ({
      sii_comuna_code: row.sii_comuna_code,
      roles: Number(row.roles),
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Error fetching SII coverage:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch SII coverage' }, { status: 500 })
  }
}
