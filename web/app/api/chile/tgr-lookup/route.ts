import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { consultarTgrRol, tgrCooldownRemainingMs } from '@/lib/tgr'

// Mismo esquema de "rol" que usa scraper/tgr/run-tgr.sh al exportar el CSV
// para el scraper masivo: sii_comuna_code + "-" + rol (manzana-predio). Usar
// la misma clave permite que esta consulta on-demand y el scraper por lotes
// compartan fila en tgr_certificados (ON CONFLICT (rol) DO UPDATE) en vez de
// duplicar datos.
function buildRolCompleto(siiComunaCode: string, rol: string) {
  return `${siiComunaCode}-${rol}`
}

// No re-consultar si ya tenemos un certificado reciente (menos de 24h) y
// exitoso/sin_deuda — evita golpear un sitio con historial de bloqueos WAF
// por cada apertura de la ficha del predio.

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const rol = sp.get('rol')?.trim()
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  if (!rol || !siiComunaCode) {
    return NextResponse.json({ success: false, error: 'rol y sii_comuna_code son requeridos' }, { status: 400 })
  }

  const rolCompleto = buildRolCompleto(siiComunaCode, rol)
  try {
    const { rows } = await pool.query(`SELECT * FROM tgr_certificados WHERE rol = $1 LIMIT 1`, [rolCompleto])
    return NextResponse.json({ success: true, certificado: rows[0] ?? null, cooldown_ms: tgrCooldownRemainingMs() })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const rol = String(body?.rol ?? '').trim()
  const comuna = String(body?.comuna ?? '').trim()
  const siiComunaCode = String(body?.sii_comuna_code ?? '').trim()
  const force = body?.force === true

  if (!/^\d+-\d+$/.test(rol)) {
    return NextResponse.json({ success: false, error: 'Formato de rol inválido (esperado manzana-predio, ej. 3671-19)' }, { status: 400 })
  }
  if (!comuna || !siiComunaCode) {
    return NextResponse.json({ success: false, error: 'comuna y sii_comuna_code son requeridos' }, { status: 400 })
  }

  const [manzana, predio] = rol.split('-')
  const rolCompleto = buildRolCompleto(siiComunaCode, rol)

  try {
    if (!force) {
      const cached = await pool.query(
        `SELECT * FROM tgr_certificados
         WHERE rol = $1 AND estado IN ('exitosa', 'sin_deuda') AND fecha_consulta > now() - interval '24 hours'
         LIMIT 1`,
        [rolCompleto]
      )
      if (cached.rows[0]) {
        return NextResponse.json({ success: true, certificado: cached.rows[0], from_cache: true })
      }
    }

    const cert = await consultarTgrRol(manzana, predio, comuna, rolCompleto)

    const { rows } = await pool.query(
      `INSERT INTO tgr_certificados (
         rol, comuna, nombre, direccion, total_deuda_no_vencida, total_deuda_morosa,
         total_acogido_art_196_197, tiene_deuda, fecha_emision_certificado, liquidada_al,
         emitido_a_las, codigo_verificacion, estado, intentos, error, fecha_consulta, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14, now(), now())
       ON CONFLICT (rol) DO UPDATE SET
         comuna = excluded.comuna, nombre = excluded.nombre, direccion = excluded.direccion,
         total_deuda_no_vencida = excluded.total_deuda_no_vencida,
         total_deuda_morosa = excluded.total_deuda_morosa,
         total_acogido_art_196_197 = excluded.total_acogido_art_196_197,
         tiene_deuda = excluded.tiene_deuda,
         fecha_emision_certificado = excluded.fecha_emision_certificado,
         liquidada_al = excluded.liquidada_al, emitido_a_las = excluded.emitido_a_las,
         codigo_verificacion = excluded.codigo_verificacion,
         estado = excluded.estado, intentos = tgr_certificados.intentos + 1, error = excluded.error,
         fecha_consulta = now(), updated_at = now()
       RETURNING *`,
      [
        rolCompleto, cert.comuna, cert.nombre, cert.direccion,
        cert.totalDeudaNoVencida, cert.totalDeudaMorosa, cert.totalAcogidoArt196197,
        cert.tieneDeuda, cert.fechaEmisionCertificado, cert.liquidadaAl, cert.emitidoALas,
        cert.codigoVerificacion, cert.estado, cert.error,
      ]
    )

    if (cert.estado === 'error' || cert.estado === 'bloqueado') {
      return NextResponse.json({ success: false, error: cert.error, certificado: rows[0] }, { status: 502 })
    }

    return NextResponse.json({ success: true, certificado: rows[0], from_cache: false })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
