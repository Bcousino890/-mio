// ─────────────────────────────────────────────────────────────────────────────
// Verificación en vivo de WhatsApp para los teléfonos de DealerNet (Chile).
//
// Qué resuelve: DealerNet entrega `ind_whatsapp` y una foto de perfil, pero
// son una copia de SU base, sin fecha. Números de baja siguen marcados como
// WhatsApp y la foto es la que capturaron cuando armaron el registro. Acá se
// consulta a WhatsApp directamente y se guarda el resultado CON su fecha
// (tabla whatsapp_verificaciones_cl, migración 0095).
//
// Cómo: el mismo mecanismo que usa WhatsApp Web al sincronizar la agenda
// (`onWhatsApp`) más la consulta de foto (`profilePictureUrl`). No envía
// ningún mensaje y el titular del número no se entera.
//
// Este módulo es DELIBERADAMENTE agnóstico de Baileys: recibe `onWhatsApp`,
// `profilePictureUrl` y `fetchImagen` inyectados (mismo patrón que
// resilient-fetch.mjs / dedup-cl.mjs) para poder testear la lógica —
// incluido el ritmo, que es lo que decide si el número verificador sobrevive
// — sin red real ni sesión de WhatsApp. El cableado con Baileys vive en
// scraper/whatsapp-verify-worker.mjs.
//
// ⚠️ Riesgo operativo (baneo del número verificador) y encuadre legal:
// docs/WHATSAPP-VERIFICACION.md.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'

/** Techo de bytes que aceptamos guardar de una foto de perfil (son ~10-60 KB). */
export const MAX_FOTO_BYTES = 512 * 1024

/**
 * Ritmo por defecto. Conservador a propósito: la evidencia pública de baneos
 * por verificación masiva es anecdótica (un número "Standard" baneado tras
 * >10.000 checks, whatsapp-web.js#2213) y ningún mantenedor publica un umbral
 * seguro. Se arranca lento y se sube solo si el número aguanta semanas limpio.
 */
export const RITMO_POR_DEFECTO = {
  porMinuto: 15,        // techo duro de checks/minuto
  jitterMs: [1500, 4000], // espera aleatoria entre checks (rompe el patrón mecánico)
  pausaCada: 150,       // cada N checks…
  pausaMs: 7 * 60_000,  // …una pausa larga
  topeDiario: 800,      // techo por día (muy por debajo de los 10k con ban documentado)
}

/** Solo dígitos, como los quiere el protocolo: "+56 9 9542 9258" → "56995429258". */
export function soloDigitos(phoneE164) {
  return String(phoneE164 ?? '').replace(/\D/g, '')
}

/**
 * ¿Vale la pena gastar un check en este número?
 *
 * Los fijos chilenos (clasificación "F" de DealerNet) prácticamente nunca
 * están en WhatsApp, y cada check tiene costo de riesgo — se dejan fuera por
 * defecto. `incluirFijos` los reactiva si algún día se quiere barrerlos.
 */
export function esVerificable(phone, { incluirFijos = false } = {}) {
  const digits = soloDigitos(phone?.phone_e164)
  // +56 9 XXXXXXXX = 11 dígitos; se acepta cualquier E.164 plausible por si
  // aparecen números extranjeros en la ficha.
  if (digits.length < 8 || digits.length > 15) return false
  if (!incluirFijos && phone?.clasificacion === 'F') return false
  return true
}

/**
 * Cola de trabajo: qué números tocan ahora.
 *
 * Orden (el índice idx_wa_verif_cl_pendientes lo cubre):
 *   1. lo pedido a mano desde la ficha (`revalidar_pedido_at`),
 *   2. lo nunca verificado,
 *   3. lo más viejo que el TTL.
 *
 * Se leen los teléfonos de DealerNet (fuente de verdad de qué existe) y se
 * hace LEFT JOIN con las verificaciones: así un número nuevo entra a la cola
 * sin que nadie tenga que darlo de alta en la tabla de verificaciones.
 */
export async function selectPendingPhonesCl(client, { limit = 25, ttlDias = 30, incluirFijos = false } = {}) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (p.phone_e164)
            p.phone_e164,
            p.clasificacion,
            v.verificado_at,
            v.revalidar_pedido_at,
            v.foto_sha256
       FROM dealernet_phones_cl p
       LEFT JOIN whatsapp_verificaciones_cl v ON v.phone_e164 = p.phone_e164
      WHERE ($3 OR p.clasificacion IS DISTINCT FROM 'F')
        AND (
          v.phone_e164 IS NULL
          OR v.verificado_at IS NULL
          OR v.revalidar_pedido_at IS NOT NULL
          OR v.verificado_at < now() - ($2 || ' days')::interval
        )
      ORDER BY p.phone_e164,
               v.revalidar_pedido_at DESC NULLS LAST,
               v.verificado_at ASC NULLS FIRST
      LIMIT $1`,
    [limit, String(ttlDias), incluirFijos]
  )
  return rows
}

/**
 * Un check completo de un número: ¿está en WhatsApp? ¿tiene foto visible?
 *
 * Devuelve SIEMPRE un objeto de resultado (nunca lanza): un número que falla
 * no debe tumbar el barrido, se guarda con `estado: 'error'` y se reintenta
 * en la siguiente pasada.
 *
 * Sobre la foto: `profilePictureUrl` devuelve vacío o lanza (401/404/
 * not-authorized) tanto cuando NO hay foto como cuando la privacidad la
 * restringe a contactos. Son indistinguibles desde fuera, así que
 * `tiene_foto: false` significa "no visible para nosotros" — la UI lo rotula
 * así, no como "no tiene foto".
 */
export async function verifyPhoneCl(phoneE164, deps) {
  const { onWhatsApp, profilePictureUrl, fetchImagen } = deps
  const digits = soloDigitos(phoneE164)
  const base = { phone_e164: phoneE164, verificado_at: new Date() }

  let existe = false
  let jid = null
  try {
    const res = await onWhatsApp(digits)
    const hit = Array.isArray(res) ? res[0] : res
    existe = Boolean(hit?.exists)
    jid = hit?.jid ?? null
  } catch (e) {
    return { ...base, estado: 'error', error: `check registro: ${e?.message ?? e}` }
  }

  if (!existe) {
    // Sin WhatsApp no hay foto que pedir: se ahorra media consulta (y medio
    // riesgo) por cada número muerto de la base.
    return { ...base, estado: 'ok', tiene_whatsapp: false, jid: null, tiene_foto: false, foto: null }
  }

  let url = null
  try {
    url = await profilePictureUrl(jid ?? `${digits}@s.whatsapp.net`, 'image')
  } catch {
    url = null // sin foto visible, o rate-limit puntual: no es un error del check
  }

  let foto = null
  if (url) {
    try {
      const descarga = await fetchImagen(url)
      if (descarga?.bytes?.length && descarga.bytes.length <= MAX_FOTO_BYTES) {
        foto = {
          bytes: descarga.bytes,
          mime: descarga.mime ?? 'image/jpeg',
          sha256: createHash('sha256').update(descarga.bytes).digest('hex'),
        }
      }
    } catch {
      foto = null // la URL caduca rápido; se reintenta en la próxima pasada
    }
  }

  return {
    ...base,
    estado: 'ok',
    tiene_whatsapp: true,
    jid,
    tiene_foto: Boolean(foto),
    foto,
  }
}

/**
 * Persiste un resultado. `foto_cambiada_at` solo se mueve cuando el sha256 de
 * la foto es DISTINTO del guardado — que es justo el dato que se pidió: saber
 * si la foto está actualizada, no solo si existe.
 *
 * Un resultado con `estado: 'error'` NO pisa la última foto buena conocida:
 * se conserva lo que había y solo se anota el fallo.
 *
 * Además deja rastro en whatsapp_verificaciones_hist_cl (migración 0096) para
 * poder responder "¿este número TENÍA WhatsApp cuando lo captamos?" — la
 * pregunta que importa cuando una ficha de hace meses no contesta: si el
 * número murió o si nunca estuvo. Se escribe una fila por CAMBIO (alta, cambio
 * de registro, cambio de foto), no por pasada: verificar 30 veces lo mismo no
 * es información.
 *
 * Todo va en UNA sentencia con CTEs: las CTE `prev`/`up` ven el estado ANTES
 * del upsert, así que la comparación es atómica y no hay ventana en la que dos
 * pasadas concurrentes escriban historial de más (o de menos).
 */
export async function saveVerificationCl(client, result) {
  if (result.estado === 'error') {
    await client.query(
      `INSERT INTO whatsapp_verificaciones_cl (phone_e164, estado, error, intentos, verificado_at, revalidar_pedido_at)
       VALUES ($1, 'error', $2, 1, $3, NULL)
       ON CONFLICT (phone_e164) DO UPDATE SET
         estado = 'error',
         error = EXCLUDED.error,
         intentos = whatsapp_verificaciones_cl.intentos + 1,
         verificado_at = EXCLUDED.verificado_at,
         revalidar_pedido_at = NULL`,
      [result.phone_e164, String(result.error ?? '').slice(0, 500), result.verificado_at]
    )
    return { guardado: true, fotoCambiada: false }
  }

  const foto = result.foto ?? null
  const { rows } = await client.query(
    `WITH prev AS (
       SELECT tiene_whatsapp, foto_sha256
         FROM whatsapp_verificaciones_cl WHERE phone_e164 = $1
     ), up AS (
     INSERT INTO whatsapp_verificaciones_cl
       (phone_e164, tiene_whatsapp, jid, tiene_foto, foto_mime, foto_bytes, foto_sha256,
        foto_cambiada_at, estado, error, intentos, verificado_at, revalidar_pedido_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE $8::timestamptz END,
             'ok', NULL, 1, $8, NULL)
     ON CONFLICT (phone_e164) DO UPDATE SET
       tiene_whatsapp = EXCLUDED.tiene_whatsapp,
       jid = EXCLUDED.jid,
       tiene_foto = EXCLUDED.tiene_foto,
       -- Foto nueva pisa a la vieja; una pasada sin foto (privada o
       -- rate-limit) NO borra la última que sí conseguimos.
       foto_mime = COALESCE(EXCLUDED.foto_mime, whatsapp_verificaciones_cl.foto_mime),
       foto_bytes = COALESCE(EXCLUDED.foto_bytes, whatsapp_verificaciones_cl.foto_bytes),
       foto_sha256 = COALESCE(EXCLUDED.foto_sha256, whatsapp_verificaciones_cl.foto_sha256),
       foto_cambiada_at = CASE
         WHEN EXCLUDED.foto_sha256 IS NOT NULL
              AND EXCLUDED.foto_sha256 IS DISTINCT FROM whatsapp_verificaciones_cl.foto_sha256
           THEN EXCLUDED.verificado_at
         ELSE whatsapp_verificaciones_cl.foto_cambiada_at
       END,
       estado = 'ok',
       error = NULL,
       intentos = whatsapp_verificaciones_cl.intentos + 1,
       verificado_at = EXCLUDED.verificado_at,
       revalidar_pedido_at = NULL
     RETURNING phone_e164, tiene_whatsapp, jid, tiene_foto, foto_mime, foto_bytes,
               foto_sha256, verificado_at, (xmax = 0) AS insertado,
               foto_cambiada_at = verificado_at AS foto_cambiada
     ), calc AS (
       -- El estado nuevo (up) junto al viejo (prev), para no repetir la
       -- comparación en cada rama de abajo.
       SELECT up.*,
              EXISTS (SELECT 1 FROM prev) AS habia,
              (SELECT tiene_whatsapp FROM prev) IS DISTINCT FROM up.tiene_whatsapp AS cambio_wa,
              (up.foto_sha256 IS NOT NULL
               AND (SELECT foto_sha256 FROM prev) IS DISTINCT FROM up.foto_sha256) AS cambio_foto
         FROM up
     ), hist AS (
       INSERT INTO whatsapp_verificaciones_hist_cl
         (phone_e164, tiene_whatsapp, jid, tiene_foto, foto_mime, foto_bytes,
          foto_sha256, cambios, verificado_at)
       SELECT phone_e164, tiene_whatsapp, jid, tiene_foto,
              -- La foto solo se copia al historial cuando ES la novedad. Si la
              -- fila existe por un cambio de registro, la imagen ya está
              -- guardada en su propia fila anterior: duplicarla sería pagar
              -- los bytes dos veces por el mismo dato.
              CASE WHEN cambio_foto THEN foto_mime END,
              CASE WHEN cambio_foto THEN foto_bytes END,
              CASE WHEN cambio_foto THEN foto_sha256 END,
              -- Qué disparó la fila. 'alta' solo la primera vez; después,
              -- exactamente lo que cambió respecto de la pasada anterior.
              CASE WHEN NOT habia THEN ARRAY['alta']
                   ELSE ARRAY[]::text[]
                     || CASE WHEN cambio_wa THEN ARRAY['whatsapp'] ELSE ARRAY[]::text[] END
                     || CASE WHEN cambio_foto THEN ARRAY['foto'] ELSE ARRAY[]::text[] END
              END,
              verificado_at
         FROM calc
        WHERE NOT habia OR cambio_wa OR cambio_foto
       RETURNING 1
     )
     SELECT up.insertado, up.foto_cambiada, (SELECT count(*) FROM hist)::int AS historial
       FROM up`,
    [
      result.phone_e164,
      result.tiene_whatsapp ?? null,
      result.jid ?? null,
      result.tiene_foto ?? null,
      foto?.mime ?? null,
      foto?.bytes ?? null,
      foto?.sha256 ?? null,
      result.verificado_at,
    ]
  )
  return {
    guardado: true,
    fotoCambiada: Boolean(rows[0]?.foto_cambiada),
    // true si esta pasada dejó rastro en el historial (alta o cambio real).
    historial: (rows[0]?.historial ?? 0) > 0,
  }
}

/**
 * Historial de un número, de lo más nuevo a lo más viejo: cuándo se verificó
 * por primera vez, cuándo ganó o perdió WhatsApp y cuándo cambió de foto.
 *
 * No devuelve los bytes de las fotos antiguas (están en la tabla, pero pesan y
 * casi nunca se necesitan en la misma consulta): quien las quiera las pide por
 * `id`.
 */
export async function historialPhoneCl(client, phoneE164, { limit = 20 } = {}) {
  const { rows } = await client.query(
    `SELECT id, tiene_whatsapp, tiene_foto, foto_sha256, cambios, verificado_at
       FROM whatsapp_verificaciones_hist_cl
      WHERE phone_e164 = $1
      ORDER BY verificado_at DESC
      LIMIT $2`,
    [phoneE164, limit]
  )
  return rows
}

/**
 * Ritmo del barrido. Devuelve cuántos ms esperar ANTES del siguiente check,
 * y si ya se agotó el techo del día.
 *
 * Es una función pura sobre `{ hechos }` (con `random` inyectable) para poder
 * afirmar en tests que el ritmo es el que decimos que es: es el único
 * parámetro que separa "enriquecer la base" de "perder el número".
 */
export function calcularEspera(hechos, ritmo = RITMO_POR_DEFECTO, random = Math.random) {
  const { porMinuto, jitterMs, pausaCada, pausaMs, topeDiario } = { ...RITMO_POR_DEFECTO, ...ritmo }
  if (hechos >= topeDiario) return { esperaMs: 0, topeAlcanzado: true }
  // Pausa larga cada `pausaCada` checks: un flujo continuo a ritmo constante
  // es exactamente lo que distingue a un cliente automatizado de una persona.
  if (hechos > 0 && hechos % pausaCada === 0) return { esperaMs: pausaMs, topeAlcanzado: false }

  const minimoPorRitmo = Math.ceil(60_000 / porMinuto)
  const [lo, hi] = jitterMs
  const jitter = lo + random() * (hi - lo)
  return { esperaMs: Math.max(minimoPorRitmo, Math.round(jitter)), topeAlcanzado: false }
}

/** Estado del verificador (fila única). Lo lee la UI para no mentir con "pendiente". */
export async function setVerificadorEstadoCl(client, patch) {
  const campos = ['estado', 'numero_e164', 'qr', 'ultimo_error', 'conectado_at']
  const sets = []
  const params = []
  for (const campo of campos) {
    if (!(campo in patch)) continue
    params.push(patch[campo])
    sets.push(`${campo} = $${params.length}`)
  }
  if (sets.length === 0) return
  await client.query(`UPDATE whatsapp_verificador_cl SET ${sets.join(', ')} WHERE id = true`, params)
}

/**
 * Suma 1 al contador del día y devuelve cuántos van HOY. El contador se
 * reinicia solo al cambiar de fecha (por eso `checks_dia_fecha`): así el tope
 * diario sobrevive a reinicios del contenedor, que es cuando de verdad
 * importa no volver a empezar de cero.
 */
export async function contarCheckDiaCl(client) {
  const { rows } = await client.query(
    `UPDATE whatsapp_verificador_cl
        SET checks_dia = CASE WHEN checks_dia_fecha = CURRENT_DATE THEN checks_dia + 1 ELSE 1 END,
            checks_dia_fecha = CURRENT_DATE
      WHERE id = true
      RETURNING checks_dia`
  )
  return rows[0]?.checks_dia ?? 0
}

/** Cuántos checks van hoy, sin sumar (para decidir si arrancar la pasada). */
export async function checksDeHoyCl(client) {
  const { rows } = await client.query(
    `SELECT CASE WHEN checks_dia_fecha = CURRENT_DATE THEN checks_dia ELSE 0 END AS n
       FROM whatsapp_verificador_cl WHERE id = true`
  )
  return rows[0]?.n ?? 0
}
