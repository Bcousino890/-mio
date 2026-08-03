import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { pool } from '@/lib/db'

// Estado del verificador de WhatsApp + el QR de vinculación, para el panel de
// Configuración.
//
// El QR lo escribe el worker en `whatsapp_verificador_cl.qr` como el string
// crudo que emite WhatsApp. Acá se convierte a PNG (data URI) para poder
// escanearlo desde la pantalla: sin esto había que entrar al contenedor a leer
// logs o sacar el string por SQL y renderizarlo a mano.
//
// El QR caduca en ~60 s y el worker emite uno nuevo automáticamente, por eso
// el panel repregunta cada pocos segundos mientras está esperando.

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT estado, numero_e164, qr, ultimo_error, conectado_at,
              CASE WHEN checks_dia_fecha = CURRENT_DATE THEN checks_dia ELSE 0 END AS checks_hoy,
              updated_at,
              -- Latido: el worker toca esta fila al emitir cada QR (~60 s) y
              -- en cada verificación. Sin latido reciente, el contenedor está
              -- apagado — que es la causa nº 1 de "no aparece el QR", y el
              -- panel tiene que poder decirlo en vez de dejar esperando.
              updated_at > now() - interval '3 minutes' AS latido,
              modo
         FROM whatsapp_verificador_cl WHERE id = true`
    )
    const v = rows[0]
    if (!v) {
      return NextResponse.json({ success: true, estado: 'desvinculado', pendientes: null })
    }

    // Dos colas distintas y conviene no mezclarlas:
    //  · `pedidos`     → lo que alguien pidió a mano. Es lo ÚNICO que el
    //                    worker toca en modo 'solicitados'.
    //  · `pendientes`  → todo lo que nunca se verificó. Solo se consume en
    //                    modo 'barrido'.
    const { rows: [cola] } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM whatsapp_verificaciones_cl
           WHERE revalidar_pedido_at IS NOT NULL) AS pedidos,
         (SELECT count(*)::int
            FROM (SELECT DISTINCT p.phone_e164
                    FROM dealernet_phones_cl p
                    LEFT JOIN whatsapp_verificaciones_cl w ON w.phone_e164 = p.phone_e164
                   WHERE p.clasificacion IS DISTINCT FROM 'F'
                     AND (w.phone_e164 IS NULL OR w.verificado_at IS NULL)) q) AS pendientes`
    )
    const { rows: [hechas] } = await pool.query(
      `SELECT count(*) FILTER (WHERE tiene_whatsapp)::int AS con_whatsapp,
              count(*) FILTER (WHERE tiene_whatsapp = false)::int AS sin_whatsapp,
              count(*) FILTER (WHERE tiene_foto)::int AS con_foto
         FROM whatsapp_verificaciones_cl WHERE estado = 'ok'`
    )

    // El QR se renderiza en el servidor: el string crudo nunca hace falta en
    // el navegador y así el panel no arrastra una librería de QR al cliente.
    let qrDataUrl: string | null = null
    if (v.qr && v.estado === 'esperando_qr') {
      qrDataUrl = await QRCode.toDataURL(v.qr, { width: 320, margin: 2 })
    }

    return NextResponse.json({
      success: true,
      estado: v.estado,
      numero_e164: v.numero_e164,
      ultimo_error: v.ultimo_error,
      conectado_at: v.conectado_at,
      checks_hoy: v.checks_hoy,
      latido: v.latido,
      actualizado_at: v.updated_at,
      qr_data_url: qrDataUrl,
      modo: v.modo ?? 'solicitados',
      pedidos: cola?.pedidos ?? 0,
      pendientes: cola?.pendientes ?? 0,
      verificados: hechas ?? null,
    })
  } catch (error) {
    // Sin la migración 0095 aplicada el panel dice justo eso, en vez de
    // reventar la página de Configuración entera.
    const msg = error instanceof Error ? error.message : 'Error consultando el verificador'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/**
 * Cambia el modo de trabajo (migración 0097).
 *
 *   'solicitados' → el worker NO barre nada por su cuenta: solo verifica lo
 *        que se pide desde las fichas. Es el defecto, y el que respeta que el
 *        presupuesto del verificador (800/día, y el riesgo de que Meta banee
 *        el número) se gaste en lo que de verdad interesa hoy.
 *   'barrido'     → además, va completando el resto de la base por antigüedad.
 *
 * El worker relee el modo en cada pasada, así que el cambio surte efecto en
 * segundos, sin reiniciar el contenedor.
 */
export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const modo = body?.modo
  if (modo !== 'solicitados' && modo !== 'barrido') {
    return NextResponse.json({ success: false, error: 'Modo no válido' }, { status: 400 })
  }

  try {
    await pool.query(`UPDATE whatsapp_verificador_cl SET modo = $1 WHERE id = true`, [modo])
    return NextResponse.json({ success: true, modo })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error guardando el modo'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
