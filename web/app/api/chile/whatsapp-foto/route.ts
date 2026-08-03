import { NextRequest } from 'next/server'
import { pool } from '@/lib/db'

// Sirve la foto de perfil de WhatsApp verificada en vivo (migración 0095).
//
// Los bytes salen de la base, no de WhatsApp: las URL de pps.whatsapp.net
// caducan en horas, así que el worker descarga la imagen al verificar y acá
// solo se entrega. Es el equivalente "actualizado" del proxy de la foto de
// DealerNet (/api/chile/dealernet-imagen), que sirve la copia que DealerNet
// capturó en su día.
//
// Cache corto (no `immutable` como el de DealerNet) porque esta foto SÍ
// cambia: el `verificado_at` de la fila avanza con cada pasada del worker.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('phone')?.trim() ?? ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) {
    return new Response('teléfono inválido', { status: 400 })
  }

  try {
    const { rows } = await pool.query(
      `SELECT foto_bytes, foto_mime FROM whatsapp_verificaciones_cl
        WHERE phone_e164 = $1 AND foto_bytes IS NOT NULL`,
      [`+${digits}`]
    )
    const foto = rows[0]
    if (!foto) return new Response('sin foto verificada', { status: 404 })

    return new Response(foto.foto_bytes, {
      status: 200,
      headers: {
        'Content-Type': foto.foto_mime ?? 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return new Response('error consultando la foto', { status: 500 })
  }
}
