// ─────────────────────────────────────────────────────────────────────────────
// SmartBC → -mio: lo que hace el equipo comercial en su panel.
//
// La otra mitad de la integración. Nosotros les mandamos el inmueble, el dueño
// y los contactos; ellos llaman. Lo que pasa en esa llamada —la etapa se mueve,
// el dueño confirma que quiere vender, alguien corrige un teléfono— vive en su
// panel, y sin esto aquí nadie se entera: seguíamos trabajando captaciones que
// ellos ya habían rechazado.
//
// EL DETALLE QUE HACE QUE ESTO FUNCIONE, y que casi nos explota:
//
// El `updated_at` de SmartBC avanza TAMBIÉN con nuestros propios envíos (nos lo
// confirmaron: la columna se escribe a mano en cada ruta y la tocan por igual
// el panel y la API). Sondear sobre él nos habría devuelto cada push nuestro
// como si fuera un cambio suyo, lo habríamos reflejado aquí, eso habría
// ensuciado la captación, la habríamos vuelto a enviar… Por eso se sondea con
// `changed_by=panel`, que filtra por `updated_by_user_at` — una marca que solo
// avanza con trabajo humano, ni con nuestros envíos ni con su reparto
// automático.
//
// Y por eso esto es un ESPEJO, no una fusión: nada de aquí se escribe en
// captaciones_cl. Ver la cabecera de la migración 0099.
// ─────────────────────────────────────────────────────────────────────────────

import { EXTERNAL_ID_PREFIX } from './mapper.mjs'

/** Tamaño de página. Su tope es 100 y la cuota (120/min) da de sobra. */
export const PAGINA = 100

/**
 * `mio-<uuid>` → el uuid de la captación.
 *
 * Devuelve null para cualquier `external_id` que no sea nuestro: en su CRM hay
 * captaciones de otros orígenes y del alta manual, y ninguna nos corresponde.
 */
export function captacionIdDe(externalId) {
  const s = String(externalId ?? '')
  if (!s.startsWith(EXTERNAL_ID_PREFIX)) return null
  const uuid = s.slice(EXTERNAL_ID_PREFIX.length)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid) ? uuid : null
}

/** `data` es siempre un array directo en los listados (nos lo fijaron en el contrato). */
function datosDe(res) {
  return Array.isArray(res?.data) ? res.data : []
}

export const UPSERT_PANEL_SQL = `
INSERT INTO smartbc_panel_cl (
  captacion_id, stage_key, stage_label, stage_type, owner_confirmed,
  owner_name, owner_phone, address_real, contactos, updated_by_user_at, fetched_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now())
ON CONFLICT (captacion_id) DO UPDATE SET
  stage_key = EXCLUDED.stage_key,
  stage_label = EXCLUDED.stage_label,
  stage_type = EXCLUDED.stage_type,
  owner_confirmed = EXCLUDED.owner_confirmed,
  owner_name = EXCLUDED.owner_name,
  owner_phone = EXCLUDED.owner_phone,
  address_real = EXCLUDED.address_real,
  -- Los contactos solo se pisan si esta vuelta los trajo: una página que no
  -- llegó a leerlos no puede vaciar los que ya teníamos.
  contactos = COALESCE(EXCLUDED.contactos, smartbc_panel_cl.contactos),
  updated_by_user_at = EXCLUDED.updated_by_user_at,
  fetched_at = now()
`

/**
 * Guarda una ficha del panel. `contactos` puede ser null = "esta vuelta no se
 * leyeron", que es distinto de "no hay".
 */
export async function guardarPanel(client, captacionId, ficha, contactos) {
  const stage = ficha?.stage ?? null
  await client.query(UPSERT_PANEL_SQL, [
    captacionId,
    stage?.key ?? null,
    stage?.label ?? null,
    stage?.stage_type ?? null,
    typeof ficha?.owner_confirmed === 'boolean' ? ficha.owner_confirmed : null,
    ficha?.owner_name ?? null,
    ficha?.owner_phone ?? null,
    ficha?.address_real ?? null,
    contactos ? JSON.stringify(contactos) : null,
    ficha?.updated_by_user_at ?? null,
  ])
}

/**
 * Una vuelta de sondeo.
 *
 * Recorre las páginas hasta agotarlas y solo entonces avanza la marca. Si algo
 * falla a mitad, la marca no se mueve y la próxima vuelta repite desde el mismo
 * punto: repetir es inofensivo (el upsert es idempotente), saltarse una ficha
 * no lo sería.
 */
export async function pollPanel({ client, smartbc }, opts = {}) {
  const {
    limit = PAGINA,
    maxPaginas = 20,
    // Traerse los contactos cuesta una petición por ficha CAMBIADA. Son pocas
    // —solo las que ha tocado una persona— pero se puede apagar.
    conContactos = true,
    log = () => {},
  } = opts

  const resumen = { fichas: 0, contactos: 0, paginas: 0, ajenas: 0, error: null }

  const { rows: [estado] } = await client.query(
    'SELECT last_updated_by_user_at FROM smartbc_poll_cl WHERE id',
  )
  const desde = estado?.last_updated_by_user_at ?? null

  let cursor = null
  let marca = desde

  try {
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      const res = await smartbc.listCaptaciones({
        changedBy: 'panel',
        updatedSince: desde ? new Date(desde).toISOString() : undefined,
        cursor: cursor ?? undefined,
        limit,
      })
      const fichas = datosDe(res)
      resumen.paginas++
      if (!fichas.length) break

      for (const ficha of fichas) {
        const captacionId = captacionIdDe(ficha?.external_id)
        // Captaciones de otros orígenes o dadas de alta a mano en su CRM: no
        // son nuestras y no tenemos dónde ponerlas.
        if (!captacionId) { resumen.ajenas++; continue }

        let contactosPanel = null
        if (conContactos) {
          try {
            const cs = datosDe(await smartbc.getContactos(ficha.external_id))
            // Solo lo que escribió una persona de su equipo. Lo que mandamos
            // nosotros (`source: 'api'`) ya lo tenemos, y guardarlo aquí sería
            // duplicar el dato en dos sitios que pueden divergir.
            contactosPanel = cs.filter((c) => c?.source === 'panel')
            resumen.contactos += contactosPanel.length
          } catch {
            // Sin contactos esta vuelta: el resto de la ficha se guarda igual y
            // el COALESCE del upsert conserva los que ya hubiera.
          }
        }

        await guardarPanel(client, captacionId, ficha, contactosPanel)
        resumen.fichas++

        const t = ficha?.updated_by_user_at ?? null
        if (t && (!marca || new Date(t) > new Date(marca))) marca = t
      }

      cursor = res?.meta?.next_cursor ?? res?.meta?.cursor ?? null
      if (!cursor) break
    }

    // La marca avanza al final y solo si todo fue bien.
    await client.query(
      `UPDATE smartbc_poll_cl
          SET last_updated_by_user_at = COALESCE($1, last_updated_by_user_at),
              last_run_at = now(), last_error = NULL, last_count = $2
        WHERE id`,
      [marca, resumen.fichas],
    )
    if (resumen.fichas) {
      log(`${resumen.fichas} ficha(s) del panel · ${resumen.contactos} contacto(s) de su equipo`)
    }
  } catch (err) {
    resumen.error = String(err?.message ?? err)
    await client.query(
      `UPDATE smartbc_poll_cl SET last_run_at = now(), last_error = $1 WHERE id`,
      [resumen.error.slice(0, 500)],
    )
    log(`error sondeando el panel: ${resumen.error}`)
  }

  return resumen
}
