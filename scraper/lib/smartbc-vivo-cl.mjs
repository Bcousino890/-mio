// ─────────────────────────────────────────────────────────────────────────────
// Propagación en vivo al CRM comercial, dentro del worker 24/7.
//
// Dos despertadores para el mismo trabajo, y hacen falta los dos:
//
//   · LISTEN/NOTIFY — la migración 0098 avisa en cuanto una captación se
//     ensucia. Es lo que hace que el cambio llegue en segundos y no cuando
//     toque.
//   · Un barrido periódico — un NOTIFY emitido mientras el worker estaba caído
//     no lo recibe nadie NUNCA. La fila sí quedó en la bandeja. Sin el barrido,
//     un reinicio en mal momento deja cambios sin propagar para siempre.
//
// El estado vive en la tabla; esto solo decide CUÁNDO mirarla. Por eso perder
// un aviso cuesta latencia, no datos.
//
// Vive en scraper/ y no en web/lib porque es el ritmo del worker (conexiones,
// temporizadores, apagado limpio). La lógica de qué se envía es de
// web/lib/smartbc/realtime.mjs, compartida con el resto del repo.
// ─────────────────────────────────────────────────────────────────────────────

import pg from 'pg'
import { CANAL_DIRTY, drainOutbox } from '../../web/lib/smartbc/realtime.mjs'
import { buildNormalizer, fetchCatalogo } from '../../web/lib/smartbc/catalogo.mjs'

/** Barrido de seguridad. No es la vía normal — es la red bajo el trapecio. */
export const BARRIDO_MS = 60_000

/**
 * Espera tras un aviso antes de drenar.
 *
 * Guardar una ficha dispara varios UPDATE seguidos (la captación, su property,
 * sus listings). Sin esta pausa, cada uno sería un envío con un estado
 * intermedio que nadie llegó a ver. Con ella, la ráfaga se cobra una sola vez y
 * lo que viaja es el estado final.
 */
export const DEBOUNCE_MS = 2_000

/**
 * Normalizador geográfico con caché.
 *
 * El sincronizador nocturno descarga el catálogo una vez por corrida y lo
 * reparte entre las 100 captaciones del lote. Aquí las captaciones llegan de
 * una en una, así que sin caché serían 2 peticiones + 1 por comuna CADA VEZ —
 * con un límite de 120/min, eso es gastar la cuota en preguntar lo que ya
 * sabemos.
 *
 * Se cachea por comuna porque las zonas se piden por comuna. Una hora de vida:
 * el catálogo de regiones y comunas de Chile no cambia en una tarde.
 */
export function crearNormalizerCache(smartbc, { ttlMs = 3_600_000, ahora = () => Date.now() } = {}) {
  const cache = new Map()   // comuna plegada → { normalizer, expira }

  return async function normalizerPara(comuna) {
    const clave = String(comuna ?? '').toLowerCase().trim() || '—'
    const hit = cache.get(clave)
    if (hit && hit.expira > ahora()) return hit.normalizer

    let normalizer
    try {
      normalizer = buildNormalizer(await fetchCatalogo(smartbc, {
        comunasDeInteres: comuna ? [comuna] : [],
      }))
    } catch {
      // Sin catálogo NO se manda texto libre: región/comuna/zona se quedan
      // vacías y se reintenta a la siguiente. Es la misma regla del
      // sincronizador — inventar la nomenclatura es lo que el contrato prohíbe.
      return buildNormalizer({ regiones: [], comunas: [], zonasPorComuna: new Map() })
    }
    cache.set(clave, { normalizer, expira: ahora() + ttlMs })
    return normalizer
  }
}

/**
 * Arranca la propagación en vivo. Devuelve `{ stop }` para el apagado limpio.
 *
 * Conexiones propias, separadas de las del worker: la del LISTEN no puede
 * quedar atrapada dentro de la transacción del drenaje, y el drenaje no puede
 * competir con pg-boss por la conexión del resto de las colas.
 */
export function startSmartbcVivo({
  databaseUrl,
  smartbc,
  baseUrl = null,
  dryRun = false,
  barridoMs = BARRIDO_MS,
  debounceMs = DEBOUNCE_MS,
  log = (m) => console.log(`[smartbc-vivo] ${m}`),
} = {}) {
  const { Client } = pg
  const escucha = new Client({ connectionString: databaseUrl })
  const trabajo = new Client({ connectionString: databaseUrl })
  const normalizerPara = crearNormalizerCache(smartbc)

  let corriendo = false
  let pendiente = false
  let parado = false
  let temporizador = null
  let barrido = null

  async function drenar() {
    // Nunca dos drenajes a la vez sobre la misma conexión: el segundo aviso se
    // anota y se atiende al terminar. Sin esto, dos BEGIN se pisarían.
    if (corriendo) { pendiente = true; return }
    if (parado) return
    corriendo = true
    try {
      // El normalizador se resuelve por captación dentro de pushCaptacion... y
      // como drainOutbox no sabe de comunas, se le pasa uno por lote basado en
      // la primera pendiente. Es correcto porque el lote en vivo es pequeño y
      // casi siempre de una sola ficha; el nocturno sigue haciendo el lote
      // grande con su propio catálogo.
      const { rows } = await trabajo.query(
        `SELECT c.comuna_label, com.name AS comuna_name
           FROM smartbc_outbox_cl o
           JOIN captaciones_cl c ON c.id = o.captacion_id
           LEFT JOIN LATERAL (
             SELECT ch.name FROM chile_comunas ch
              WHERE ch.sii_comuna_code = c.sii_comuna_code LIMIT 1
           ) com ON true
          WHERE o.next_try_at <= now()
          ORDER BY o.dirty_at
          LIMIT 1`,
      )
      if (!rows.length) return

      const normalizer = await normalizerPara(rows[0].comuna_name ?? rows[0].comuna_label)
      const r = await drainOutbox({ client: trabajo, smartbc }, {
        normalizer, baseUrl, dryRun, log,
      })
      if (r.enviadas || r.fallidas) {
        log(`${r.enviadas} enviada(s) · ${r.sinCambios} sin cambios · ` +
            `${r.descartadas} descartada(s) · ${r.fallidas} fallida(s)` +
            (r.contactosRetirados ? ` · ${r.contactosRetirados} contacto(s) retirado(s) del CRM` : ''))
      }
    } catch (err) {
      // Un fallo del drenaje no puede tumbar el worker: las demás colas siguen.
      log(`error drenando: ${err?.message ?? err}`)
    } finally {
      corriendo = false
      if (pendiente && !parado) { pendiente = false; setTimeout(drenar, 0) }
    }
  }

  function programar() {
    if (parado) return
    clearTimeout(temporizador)
    temporizador = setTimeout(drenar, debounceMs)
  }

  async function start() {
    await escucha.connect()
    await trabajo.connect()
    escucha.on('notification', programar)
    // Una conexión de LISTEN que se cae en silencio deja de despertar a nadie y
    // no hay forma de notarlo desde fuera: el barrido seguiría cubriendo, pero
    // con un minuto de latencia y sin que nadie se entere de que ya no es "en
    // vivo". Al menos queda dicho en el log.
    escucha.on('error', (err) => log(`conexión de escucha caída: ${err?.message ?? err}`))
    await escucha.query(`LISTEN ${CANAL_DIRTY}`)
    barrido = setInterval(drenar, barridoMs)
    log(`escuchando ${CANAL_DIRTY} · barrido cada ${Math.round(barridoMs / 1000)}s`)
    // Al arrancar se drena lo que quedó pendiente mientras el worker no estaba.
    drenar()
  }

  async function stop() {
    parado = true
    clearTimeout(temporizador)
    clearInterval(barrido)
    await escucha.end().catch(() => {})
    await trabajo.end().catch(() => {})
  }

  return { start, stop, drenar }
}
