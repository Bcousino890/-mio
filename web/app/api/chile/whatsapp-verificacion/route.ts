import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// Verificación en vivo de WhatsApp de los teléfonos de la ficha (migración
// 0095). La ficha muestra dos datos DISTINTOS por número y conviene no
// confundirlos:
//
//   · `ind_whatsapp` / `idimagen` → lo que dice DealerNet, de su base, SIN
//     fecha. Puede tener años.
//   · lo que devuelve esta ruta   → lo que WhatsApp respondió en vivo, con la
//     fecha del check (`verificado_at`) y si la foto CAMBIÓ (`foto_cambiada_at`).
//
// Quien verifica es el worker `scraper/whatsapp-verify-worker.mjs`; esta ruta
// solo LEE lo ya verificado y, opcionalmente, deja pedido un re-check. Nunca
// consulta a WhatsApp desde el request: el ritmo es justo lo que protege al
// número verificador, y no puede depender de cuánta gente abra una ficha.

export const dynamic = 'force-dynamic'

/** Tope de números por request: una ficha con cientos de teléfonos no existe. */
const MAX_PHONES = 200

export interface VerificacionWhatsapp {
  phone_e164: string
  tiene_whatsapp: boolean | null
  tiene_foto: boolean | null
  estado: 'pendiente' | 'ok' | 'error'
  verificado_at: string | null
  foto_cambiada_at: string | null
  revalidar_pedido: boolean
  /** Últimos cambios conocidos, de lo más nuevo a lo más viejo. */
  historial: CambioWhatsapp[]
}

export interface CambioWhatsapp {
  tiene_whatsapp: boolean | null
  tiene_foto: boolean | null
  /** 'alta' | 'whatsapp' | 'foto' */
  cambios: string[]
  verificado_at: string
}

function normalizar(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) continue
    out.add(`+${digits}`)
    if (out.size >= MAX_PHONES) break
  }
  return Array.from(out)
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const phones = normalizar(body?.phones)
  const solicitar = body?.solicitar === true
  if (phones.length === 0) {
    return NextResponse.json({ success: false, error: 'Sin teléfonos válidos' }, { status: 400 })
  }

  try {
    // "Verificar ahora" no verifica: deja el número marcado para que la
    // próxima pasada del worker lo atienda antes que la cola por antigüedad.
    // Así el botón es instantáneo y el ritmo sigue siendo del worker.
    if (solicitar) {
      await pool.query(
        `INSERT INTO whatsapp_verificaciones_cl (phone_e164, revalidar_pedido_at)
         SELECT p, now() FROM unnest($1::text[]) AS p
         ON CONFLICT (phone_e164) DO UPDATE SET revalidar_pedido_at = now()`,
        [phones]
      )
    }

    const { rows } = await pool.query(
      `SELECT phone_e164, tiene_whatsapp, tiene_foto, estado, verificado_at,
              foto_cambiada_at, revalidar_pedido_at IS NOT NULL AS revalidar_pedido
         FROM whatsapp_verificaciones_cl
        WHERE phone_e164 = ANY($1::text[])`,
      [phones]
    )

    // El estado del verificador viaja en la misma respuesta para que la ficha
    // pueda decir "verificador sin vincular" en vez de dejar todos los
    // números en "pendiente" para siempre.
    const { rows: estadoRows } = await pool.query(
      `SELECT estado, numero_e164, conectado_at, ultimo_error FROM whatsapp_verificador_cl WHERE id = true`
    )

    // Historial (migración 0096): responde "¿este número TENÍA WhatsApp
    // cuando lo captamos?" — lo que importa cuando una ficha de hace meses no
    // contesta: si el número murió o si nunca estuvo. Solo los últimos
    // cambios de cada número; el archivo completo se consulta por SQL.
    const { rows: hist } = await pool.query(
      `SELECT phone_e164, tiene_whatsapp, tiene_foto, cambios, verificado_at
         FROM (SELECT h.*, row_number() OVER (PARTITION BY h.phone_e164
                                              ORDER BY h.verificado_at DESC) AS rn
                 FROM whatsapp_verificaciones_hist_cl h
                WHERE h.phone_e164 = ANY($1::text[])) x
        WHERE rn <= 5
        ORDER BY phone_e164, verificado_at DESC`,
      [phones]
    )

    const verificaciones: Record<string, VerificacionWhatsapp> = {}
    for (const r of rows) verificaciones[r.phone_e164] = { ...r, historial: [] }
    for (const h of hist) {
      const v = verificaciones[h.phone_e164]
      if (v) v.historial.push(h)
    }

    return NextResponse.json({
      success: true,
      verificador: estadoRows[0] ?? { estado: 'desvinculado' },
      verificaciones,
    })
  } catch (error) {
    // La migración 0095 puede no estar aplicada todavía en un entorno dado —
    // la ficha tiene que seguir funcionando con el dato de DealerNet.
    const msg = error instanceof Error ? error.message : 'Error consultando verificaciones'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
