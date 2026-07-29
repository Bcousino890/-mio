// ─────────────────────────────────────────────────────────────────────────────
// enrich-corredora-contacto-cl.mjs — llena la ficha de empresa de una corredora
// (teléfono, WhatsApp, email, dirección, redes, equipo) desde su web propia.
// Plan Anuncios CL · H4/H21. Migración 0083.
//
// Es al contacto lo que crawl-corredora-web-cl.mjs es al inventario: mismo
// dominio, misma cortesía (H22), distinto objetivo. Aquí NO se recorren fichas
// de propiedad — se visitan la home y como mucho 4 páginas institucionales
// (contacto / nosotros / equipo), que es donde la corredora publica sus datos.
//
// SIN ADAPTADOR POR CRM, a propósito: el inventario necesita un parser por
// plataforma (cada CRM maqueta la ficha distinto), pero los datos de contacto
// se publican de forma casi universal — `tel:`, `mailto:`, `wa.me`, enlace a
// Google Maps, JSON-LD. Por eso el extractor es genérico y funciona igual en
// Convecta, Ofinet o una web a medida. Verificado sobre finhabit.cl (Convecta),
// magnoliaproperty.cl (Convecta), cympropiedades.cl y bpropiedades.cl (Ofinet).
//
// LO QUE NO SE PUEDE (y por qué no se intenta aquí): el teléfono NO se puede
// sacar del portal. `api.mercadolibre.com` responde 403 sin access_token y el
// contacto de un anuncio de Portal Inmobiliario es un formulario, no un número.
// Sin `web_propia_url` no hay ficha de contacto: se marca `no_web` y se sigue.
// Ver docs/CONTACTO-CORREDORAS-CL.md.
// ─────────────────────────────────────────────────────────────────────────────
import { fetchHtmlResilient } from './fetch.mjs'
import { extractContacto, pickContactPages, mergeContacto } from './parse-contacto-corredora-cl.mjs'
import { normalizeDomain } from './detect-corredora-crm-cl.mjs'

const DEFAULT_DELAY_MS = 4000   // mismo respiro que el crawl de inventario (H22)
const DEFAULT_MAX_PAGES = 4     // home + hasta 4 institucionales

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Corredoras a enriquecer: las que tienen web propia registrada y ficha de
 * contacto ausente o vencida. Se priorizan por stock activo — la ficha de la
 * corredora con 200 anuncios vale más que la de una con 1.
 *
 * @param {import('pg').ClientBase} client
 * @param {{ limit?: number, maxAgeDays?: number, corredoraId?: string }} [opts]
 */
export async function selectCorredorasPendientes(client, opts = {}) {
  const { limit = 25, maxAgeDays = 30, corredoraId = null } = opts
  if (corredoraId) {
    const { rows } = await client.query(
      `SELECT id, name_normalized, name_raw, web_propia_url
         FROM corredoras_cl WHERE id = $1`,
      [corredoraId]
    )
    return rows
  }
  const { rows } = await client.query(
    `SELECT id, name_normalized, name_raw, web_propia_url
       FROM corredoras_cl
      WHERE web_propia_url IS NOT NULL
        AND (contact_updated_at IS NULL
             OR contact_updated_at < now() - make_interval(days => $2))
      ORDER BY active_listings_count DESC NULLS LAST
      LIMIT $1`,
    [limit, maxAgeDays]
  )
  return rows
}

/** URL absoluta de la home a partir del dominio guardado en la corredora. */
export function homeUrl(webPropiaUrl) {
  const domain = normalizeDomain(webPropiaUrl ?? '')
  return domain ? `https://www.${domain}/` : null
}

/**
 * Enriquece UNA corredora. Devuelve `{ ok, status, phones, emails, people, pages }`.
 * `deps` inyectable para test: { fetch, sleep, delayMs, maxPages }.
 *
 * @param {import('pg').ClientBase} client
 * @param {{ id: string, name_normalized?: string, name_raw?: string, web_propia_url?: string }} corredora
 */
export async function enrichCorredoraContacto(client, corredora, deps = {}) {
  const {
    fetch: fetchImpl = fetchHtmlResilient,
    sleep: sleepImpl = sleep,
    delayMs = DEFAULT_DELAY_MS,
    maxPages = DEFAULT_MAX_PAGES,
  } = deps

  const home = homeUrl(corredora.web_propia_url)
  if (!home) {
    await persistContacto(client, corredora.id, null, { status: 'no_web' })
    return { ok: false, status: 'no_web', phones: 0, emails: 0, people: 0, pages: 0 }
  }

  const domain = normalizeDomain(corredora.web_propia_url)
  const corredoraName = corredora.name_normalized || corredora.name_raw || ''

  try {
    // Directo, sin proxy: son sitios pequeños y el fetch directo es el que
    // funciona contra estos dominios (mismo criterio que crawl-corredora-web).
    const first = await fetchImpl(home, { useProxy: false })
    if (!first?.ok || !first.html) {
      const reason = first?.reason ?? 'sin respuesta'
      await persistContacto(client, corredora.id, null, { status: 'error', error: reason })
      return { ok: false, status: 'error', error: reason, phones: 0, emails: 0, people: 0, pages: 0 }
    }

    const parts = [{
      ...extractContacto(first.html, { url: home, domain, corredoraName }),
      source_url: home,
    }]

    for (const pageUrl of pickContactPages(first.html, { domain, max: maxPages })) {
      await sleepImpl(delayMs)
      const res = await fetchImpl(pageUrl, { useProxy: false })
      if (!res?.ok || !res.html) continue
      parts.push({
        ...extractContacto(res.html, { url: pageUrl, domain, corredoraName }),
        source_url: pageUrl,
      })
    }

    const merged = mergeContacto(parts)
    // Una web que responde pero no publica ni teléfono ni email no es un error
    // del crawl: es un dato en sí (`empty`), y distinguirlo evita reintentarla
    // como si se hubiera caído.
    const status = merged.phones.length || merged.emails.length ? 'ok' : 'empty'

    await persistContacto(client, corredora.id, merged, { status })
    const personas = await upsertPersonas(client, corredora.id, merged.people)

    return {
      ok: true,
      status,
      phones: merged.phones.length,
      emails: merged.emails.length,
      people: personas,
      pages: parts.length,
      address: merged.address,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await persistContacto(client, corredora.id, null, { status: 'error', error: reason })
    return { ok: false, status: 'error', error: reason, phones: 0, emails: 0, people: 0, pages: 0 }
  }
}

/**
 * Guarda la ficha de contacto. Con `merged` null solo se marca el estado — así
 * un error no borra lo que se había conseguido en una corrida anterior.
 */
export async function persistContacto(client, corredoraId, merged, { status, error = null } = {}) {
  if (!merged) {
    await client.query(
      `UPDATE corredoras_cl
          SET contact_status = $2, contact_error = $3,
              contact_updated_at = now(), updated_at = now()
        WHERE id = $1`,
      [corredoraId, status, error]
    )
    return
  }
  await client.query(
    `UPDATE corredoras_cl
        SET contact_phones      = $2,
            contact_whatsapp    = $3,
            contact_emails      = $4,
            contact_address     = COALESCE($5, contact_address),
            contact_socials     = $6::jsonb,
            contact_source_urls = $7,
            contact_status      = $8,
            contact_error       = NULL,
            contact_updated_at  = now(),
            updated_at          = now()
      WHERE id = $1`,
    [
      corredoraId,
      merged.phones, merged.whatsapp, merged.emails,
      merged.address, JSON.stringify(merged.socials ?? {}),
      merged.source_urls ?? [], status,
    ]
  )
}

/**
 * Alta/actualización de las personas vistas. NO borra a las que ya no aparecen:
 * su `last_seen_at` deja de avanzar y esa es justamente la señal de que alguien
 * dejó la corredora. Devuelve cuántas se procesaron.
 */
export async function upsertPersonas(client, corredoraId, people = []) {
  let n = 0
  for (const p of people) {
    if (!p?.full_name) continue
    await client.query(
      `INSERT INTO corredora_personas_cl
         (corredora_id, full_name, role_raw, role_kind, email, phone, source, source_url)
       VALUES ($1, $2, $3, $4, $5, $6, 'web_propia', $7)
       ON CONFLICT (corredora_id, lower(full_name)) DO UPDATE SET
         -- Se completa lo que falte y se respeta lo que ya había: un cargo
         -- conocido no se degrada a NULL porque otra página no lo repita.
         role_raw   = COALESCE(EXCLUDED.role_raw, corredora_personas_cl.role_raw),
         role_kind  = CASE WHEN EXCLUDED.role_kind <> 'desconocido'
                           THEN EXCLUDED.role_kind ELSE corredora_personas_cl.role_kind END,
         email      = COALESCE(EXCLUDED.email, corredora_personas_cl.email),
         phone      = COALESCE(EXCLUDED.phone, corredora_personas_cl.phone),
         source_url = COALESCE(EXCLUDED.source_url, corredora_personas_cl.source_url),
         last_seen_at = now(),
         updated_at   = now()`,
      [corredoraId, p.full_name, p.role_raw ?? null, p.role_kind ?? 'desconocido',
       p.email ?? null, p.phone ?? null, p.source_url ?? null]
    )
    n++
  }
  return n
}
