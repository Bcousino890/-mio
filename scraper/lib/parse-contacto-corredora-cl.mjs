// ─────────────────────────────────────────────────────────────────────────────
// parse-contacto-corredora-cl.mjs — extrae la ficha de empresa de una corredora
// (teléfono, WhatsApp, email, dirección, redes y personas) desde el HTML de su
// web propia. Plan Anuncios CL · H4/H21.
//
// POR QUÉ DESDE LA WEB PROPIA Y NO DESDE EL PORTAL (comprobado, ver
// docs/CONTACTO-CORREDORAS-CL.md):
//   · `api.mercadolibre.com/users/{seller_id}` y `/items/{id}` → HTTP 403 sin
//     access_token, y aun con token el teléfono del vendedor no es público.
//   · La ficha de Portal Inmobiliario contacta por formulario: el número no
//     está en el HTML.
//   · La web propia SÍ lo publica. Verificado contra finhabit.cl (Convecta):
//     <a href="https://wa.me/56995377271">, <a href="mailto:info@finhabit.cl">
//     y la dirección dentro de un enlace a Google Maps.
//
// PRECISIÓN ANTES QUE COBERTURA. Un teléfono inventado en una ficha comercial
// es peor que un hueco: se llama a quien no es. Por eso:
//   1. Fuentes de alta confianza primero: href de `tel:`, `wa.me`,
//      `api.whatsapp.com`, `mailto:` y JSON-LD. Son declaraciones explícitas.
//   2. Del texto plano solo se aceptan números con `+56` explícito o precedidos
//      de una palabra clave ("Fono:", "Teléfono:", "Celular:", "WhatsApp:").
//   3. Se descarta lo que parece RUT (`78.987.370-4` son 9 dígitos y colaba
//      como +56789873704) y cualquier dígito pegado a letras/números — el hash
//      de una imagen (`...491f933370113c3eb.webp`) contiene un móvil válido si
//      no se exige frontera.
// El módulo es puro (recibe HTML, no toca la red) y por tanto testeable con
// fixtures del HTML real.
// ─────────────────────────────────────────────────────────────────────────────
import { load } from 'cheerio'

// ── Teléfonos ────────────────────────────────────────────────────────────────

/**
 * Normaliza un teléfono chileno a E.164 (+56XXXXXXXXX) o devuelve null.
 *
 * El número nacional chileno tiene 9 dígitos: móviles `9XXXXXXXX`, fijos de
 * Santiago `2XXXXXXXX`, regionales `3X…7X`. Se rechaza todo lo que no cuadre —
 * incluidos los de 8 dígitos (formato antiguo sin prefijo de área): completarlos
 * a ciegas es inventar un número.
 *
 * @param {string|number|null} raw
 * @returns {string|null}
 */
export function normalizeChilePhone(raw) {
  if (raw == null) return null
  const s = String(raw)
  // RUT chileno (12.345.678-9 / 12345678-K): mismo largo que un teléfono.
  if (/^\s*\d{1,2}\.?\d{3}\.?\d{3}\s*[-–]\s*[\dkK]\s*$/.test(s)) return null

  let d = s.replace(/\D/g, '')
  if (d.startsWith('0056')) d = d.slice(4)
  else if (d.startsWith('056')) d = d.slice(3)
  if (d.length === 11 && d.startsWith('56')) d = d.slice(2)
  // 56 + 9 dígitos con un 0 de tránsito intercalado (5609…) no es válido.
  if (d.length !== 9) return null
  if (!/^[2-9]/.test(d)) return null
  // Un número de 9 dígitos todo repetido (999999999) es relleno de maqueta.
  if (/^(\d)\1{8}$/.test(d)) return null
  return `+56${d}`
}

// Números en texto libre. Dos pasadas, ambas con frontera a izquierda y derecha
// para no capturar dígitos incrustados en hashes, fechas o rutas de imagen.
const PHONE_INTL_RE = /(?<![\w.\-/])(\+\s?56[\s.\-()]*\d[\d\s.\-()]{7,14})(?![\w.\-/])/g
const PHONE_KEYWORD_RE =
  /(?:fonos?|tel[eé]fonos?|tels?\.|celular(?:es)?|cel\.|m[oó]vil(?:es)?|whats\s?app)\s*(?:de\s+contacto)?\s*[:\-–]?\s*(?<![\w.\-/])((?:\+?\s?56)?[\s.\-()]*[2-9][\d\s.\-()]{7,14})/gi

/**
 * Teléfonos presentes en un texto plano ya sin markup.
 * @param {string} text
 * @returns {string[]} E.164 sin duplicados
 */
export function phonesFromText(text) {
  const out = []
  if (!text) return out
  for (const re of [PHONE_INTL_RE, PHONE_KEYWORD_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      const phone = normalizeChilePhone(m[1])
      if (phone && !out.includes(phone)) out.push(phone)
    }
  }
  return out
}

// ── Redes sociales ───────────────────────────────────────────────────────────

const SOCIAL_HOSTS = [
  ['facebook', /(?:^|\.)facebook\.com|fb\.me/i],
  ['instagram', /(?:^|\.)instagram\.com/i],
  ['linkedin', /(?:^|\.)linkedin\.com/i],
  ['youtube', /(?:^|\.)youtube\.com|youtu\.be/i],
  ['tiktok', /(?:^|\.)tiktok\.com/i],
  ['twitter', /(?:^|\.)(?:twitter|x)\.com/i],
]

// Perfiles genéricos de la plataforma (botones de "compartir" o el pie del CRM),
// no la cuenta de la corredora.
const SOCIAL_NOISE_RE = /(?:sharer|share\.php|intent\/tweet|\/share|login|signup)/i

// ── Emails ───────────────────────────────────────────────────────────────────

// Buzones de empresa: valen como contacto, pero NO son el nombre de una persona.
const GENERIC_MAILBOXES = new Set([
  'info', 'contacto', 'contact', 'ventas', 'venta', 'arriendos', 'arriendo',
  'admin', 'administracion', 'hola', 'propiedades', 'atencion', 'comercial',
  'soporte', 'webmaster', 'no-reply', 'noreply', 'mail', 'correo', 'clientes',
  'postventa', 'gerencia', 'oficina', 'consultas', 'corretaje',
])

// Dominios del proveedor del CRM / de la plataforma, no de la corredora.
const VENDOR_DOMAINS_RE = /(convecta|ofinet|wixpress|godaddy|sentry|example)\./i

// ── Personas ─────────────────────────────────────────────────────────────────

const ROLE_JEFATURA_RE =
  /\b(socios?\s+fundador(?:es|a)?|socios?|due[ñn][oa]s?|fundador(?:a|es)?|representante\s+legal|gerente(?:\s+(?:general|comercial|de\s+\w+))?|sub\s?gerente|director(?:a)?(?:\s+(?:general|comercial|ejecutiv[oa]|de\s+\w+))?|jefe(?:a)?(?:\s+de\s+\w+)?|presidente(?:a)?)\b/i
const ROLE_EJECUTIVO_RE =
  /\b(ejecutiv[oa](?:\s+(?:comercial|de\s+\w+|inmobiliari[oa]))?|asesor(?:a)?(?:\s+(?:comercial|inmobiliari[oa]))?|agente(?:\s+inmobiliari[oa])?|corredor(?:a)?(?:\s+de\s+propiedades)?|broker|encargad[oa](?:\s+de\s+\w+)?|consultor(?:a)?(?:\s+inmobiliari[oa])?)\b/i

// Nombre propio: 2 a 4 palabras capitalizadas con partículas INTERCALADAS —
// "Luz María de la Sotta" son cuatro apellidos con dos partículas en medio, y
// un patrón que solo admita una al principio lo corta en "Luz María".
const NAME_PARTICLE = '(?:\\s+(?:de|del|la|las|los|san|santa|y|di|van|von|mac|mc)\\b)*'
const PERSON_NAME_RE = new RegExp(
  `\\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}${NAME_PARTICLE}(?:\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}${NAME_PARTICLE}){1,3})\\b`
)
// Partícula suelta al final ("Trinidad Arrieta de") — sobra.
const TRAILING_PARTICLE_RE = /\s+(?:de|del|la|las|los|y|san|santa)$/i

// Palabras que aparecen capitalizadas y NO son nombres de persona.
const NOT_A_NAME_RE =
  /\b(propiedades?|corredora|corredores|inmobiliaria|santiago|chile|casa|departamento|cont[aá]ct\w*|contacto|equipo|nosotros|nuestro|nuestra|servicios?|arriendos?|ventas?|whatsapp|empresa|todos|derechos|reservados|region|regi[oó]n|metropolitana|bienvenid\w*|oficina|sucursal|men[uú]|inicio|proyecto|edificio|las\s+condes|providencia|vitacura|lo\s+barnechea|[ñn]u[ñn]oa)\b/i

// Frases de presentación de la empresa: hablan en primera persona del plural o
// venden el servicio. Un bloque así nunca es la tarjeta de una persona.
const PROSE_RE =
  /\b(somos|ofrecemos|contamos|brindamos|entregamos|le\s+ayudamos|te\s+ayudamos|nuestros?\s+(?:servicios|clientes)|a[ñn]os\s+de\s+experiencia|misi[oó]n|visi[oó]n|especialistas\s+en)\b/i

// Un nombre no lleva conectores ni verbos: si una de sus "palabras" es de esta
// lista, lo capturado es una frase ("Contáctese Con Nosotros"), no una persona.
const NAME_STOPWORDS = new Set([
  'con', 'sin', 'por', 'para', 'que', 'como', 'donde', 'desde', 'hasta', 'sobre',
  'una', 'uno', 'the', 'and', 'nos', 'les', 'sus', 'tus', 'mis', 'esta', 'este',
  'aqui', 'aquí', 'más', 'mas', 'muy', 'todo', 'toda', 'ver', 'ser',
])

const ROLE_KIND = { jefatura: 'jefatura', ejecutivo: 'ejecutivo', desconocido: 'desconocido' }

function classifyRole(text) {
  if (!text) return null
  const jefe = text.match(ROLE_JEFATURA_RE)
  if (jefe) return { role_raw: tidy(jefe[0]), role_kind: ROLE_KIND.jefatura }
  const ejec = text.match(ROLE_EJECUTIVO_RE)
  if (ejec) return { role_raw: tidy(ejec[0]), role_kind: ROLE_KIND.ejecutivo }
  return null
}

function tidy(s) {
  return (s == null ? '' : String(s)).replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Recorta del nombre el cargo que la maqueta escribe pegado ("Verónica Boetsch
 * Vicuña Socia"): el cargo va en `role_raw`, no dentro del nombre.
 */
function trimRoleFromName(name) {
  let out = tidy(name)
  for (let i = 0; i < 3; i++) {
    const trimmed = out
      .replace(/\s+(socios?|socias?|due[ñn][oa]s?|fundador(?:a|es)?|gerente|director(?:a)?|jefe(?:a)?|ejecutiv[oa]|asesor(?:a)?|agente|corredor(?:a)?|broker|consultor(?:a)?)$/i, '')
      .replace(TRAILING_PARTICLE_RE, '')
    if (trimmed === out) break
    out = trimmed
  }
  return out
}

/**
 * Texto visible de un nodo SEPARANDO elementos. `.text()` de cheerio los
 * concatena sin espacio y pega datos de celdas distintas: dos <li> seguidos
 * daban "hola@magnolia.cl" + "tel" = "hola@magnolia.cltel", un email que no
 * existe. Aqu\u00ed cada elemento aporta su texto con un separador.
 */
function visibleText($, $node) {
  const parts = []
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child.type === 'text') parts.push(child.data ?? '')
      else if (child.children) { walk(child); parts.push(' ') }
    }
  }
  $node.each((_, el) => walk(el))
  return tidy(parts.join(' '))
}

/** "MARÍA josé PÉREZ" → "María José Pérez" (la web mezcla mayúsculas). */
function titleCase(name) {
  return tidy(name)
    .toLowerCase()
    .replace(/(^|\s|')([a-záéíóúñ])/g, (_, sep, c) => sep + c.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|Y)\b/g, (w) => w.toLowerCase())
    .replace(/^(\w)/, (c) => c.toUpperCase())
}

/**
 * Nombre de persona deducido del buzón `nombre.apellido@dominio`. Solo con
 * punto separador y ambas partes alfabéticas: `ventas2@` o `jp@` no dicen nada.
 */
function nameFromEmail(email) {
  const local = String(email).split('@')[0] ?? ''
  if (GENERIC_MAILBOXES.has(local.toLowerCase())) return null
  const parts = local.split(/[._-]/).filter(Boolean)
  if (parts.length < 2) return null
  if (!parts.every((p) => /^[a-záéíóúñ]{3,}$/i.test(p))) return null
  return titleCase(parts.join(' '))
}

/**
 * Extrae la ficha de contacto desde el HTML de UNA página de la web propia.
 *
 * @param {string} html
 * @param {{ url?: string, domain?: string, corredoraName?: string }} [opts]
 * @returns {{
 *   phones: string[], whatsapp: string[], emails: string[],
 *   address: string|null, socials: Record<string,string>,
 *   people: Array<{ full_name: string, role_raw: string|null, role_kind: string,
 *                   email: string|null, phone: string|null, source_url: string|null }>
 * }}
 */
export function extractContacto(html, opts = {}) {
  const { url = '', corredoraName = '' } = opts
  const empty = { phones: [], whatsapp: [], emails: [], address: null, socials: {}, people: [] }
  if (!html || typeof html !== 'string') return empty

  let $
  try {
    $ = load(html)
  } catch {
    return empty
  }
  // JSON-LD (schema.org/Organization|RealEstateAgent): cuando existe es la
  // fuente más limpia de todas. Se lee ANTES de limpiar el markup, porque el
  // siguiente paso borra los <script>.
  const ldJson = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).html())
    .get()

  // El markup de maqueta (scripts, estilos) está lleno de números y hashes que
  // solo generan falsos positivos.
  $('script, style, noscript, svg').remove()

  const phones = []
  const whatsapp = []
  const emails = []
  const socials = {}
  const addPhone = (raw, { isWhatsapp = false } = {}) => {
    const p = normalizeChilePhone(raw)
    if (!p) return null
    if (!phones.includes(p)) phones.push(p)
    if (isWhatsapp && !whatsapp.includes(p)) whatsapp.push(p)
    return p
  }
  const addEmail = (raw) => {
    const e = tidy(raw).toLowerCase().replace(/^mailto:/, '').split('?')[0]
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return null
    if (VENDOR_DOMAINS_RE.test(e)) return null
    if (!emails.includes(e)) emails.push(e)
    return e
  }

  // ── 1. Alta confianza: enlaces declarados por la propia web ────────────────
  let address = null
  $('a[href]').each((_, el) => {
    const href = tidy($(el).attr('href'))
    if (!href) return
    const text = visibleText($, $(el))

    if (/^tel:/i.test(href)) { addPhone(href.replace(/^tel:/i, '')); return }
    if (/^mailto:/i.test(href)) { addEmail(href); return }
    if (/wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com/i.test(href)) {
      const num = href.match(/(?:wa\.me\/|[?&]phone=)\+?(\d{8,15})/i)?.[1]
      addPhone(num ?? text, { isWhatsapp: true })
      return
    }
    // La dirección de la oficina suele ir enlazada a Google Maps: el texto del
    // enlace ES la dirección, sin heurística de por medio.
    if (/google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(href)) {
      if (!address && text.length > 8 && /\d/.test(text)) address = text
      return
    }
    for (const [network, re] of SOCIAL_HOSTS) {
      if (re.test(href) && !SOCIAL_NOISE_RE.test(href) && !socials[network]) {
        socials[network] = href.startsWith('//') ? `https:${href}` : href
      }
    }
  })

  for (const raw of ldJson) {
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!node || typeof node !== 'object') continue
        if (node.telephone) addPhone(node.telephone)
        if (node.email) addEmail(node.email)
        const a = node.address
        if (!address && a) {
          address = typeof a === 'string'
            ? tidy(a)
            : tidy([a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).join(', ')) || null
        }
      }
    } catch { /* JSON-LD malformado: se ignora, no rompe el resto */ }
  }

  // ── 2. Texto visible, con las reglas estrictas de la cabecera ─────────────
  const bodyText = visibleText($, $('body').length ? $('body') : $.root())
  for (const p of phonesFromText(bodyText)) addPhone(p)
  for (const m of bodyText.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) addEmail(m[0])

  if (!address) address = addressFromText(bodyText)

  // ── 3. Personas ───────────────────────────────────────────────────────────
  const people = extractPeople($, { url, corredoraName, addPhone: normalizeChilePhone })

  return { phones, whatsapp, emails, address, socials, people }
}

// Dirección en texto: "Av./Calle/Camino <nombre> <número>". Se exige la palabra
// de vía Y un número — sin las dos, cualquier frase pasaría por dirección.
const ADDRESS_RE =
  /\b((?:av(?:da?|enida)?\.?|calle|camino|pasaje|psje\.?|carretera|ruta|los\s+\w+|el\s+\w+)\s+[A-ZÁÉÍÓÚÑa-záéíóúñ0-9.'\- ]{3,60}?\s+\d{1,5}(?:\s*,?\s*(?:of(?:icina)?\.?|depto\.?|piso)\s*[\w-]{1,6})?)(?=\s*[,.]|\s+[A-ZÁÉÍÓÚÑ]|$)/i

export function addressFromText(text) {
  if (!text) return null
  const m = tidy(text).match(ADDRESS_RE)
  return m ? tidy(m[1]) : null
}

/**
 * Personas nombradas en la página. Recorre bloques cortos (una tarjeta de
 * equipo, un `li` del pie) que contengan un cargo y busca dentro el nombre y sus
 * datos de contacto. Los bloques largos se descartan: un `div` con media página
 * dentro empareja el cargo de una persona con el nombre de otra.
 */
function extractPeople($, { url = '', corredoraName = '' } = {}) {
  const out = []
  const seen = new Set()
  const corredoraTokens = new Set(
    tidy(corredoraName).toLowerCase().split(/\s+/).filter((t) => t.length > 3)
  )

  const push = (person) => {
    const key = person.full_name.toLowerCase()
    if (seen.has(key)) return
    const tokens = key.split(/\s+/)
    // Un "nombre" cuyas palabras son todas de la razón social es la corredora.
    if (tokens.length && tokens.every((t) => corredoraTokens.has(t))) return
    if (tokens.some((t) => NAME_STOPWORDS.has(t))) return
    seen.add(key)
    out.push(person)
  }

  // De bloque más pequeño a más grande: la tarjeta concreta de una persona se
  // procesa antes que la sección que la contiene, así el cargo se empareja con
  // SU nombre y no con el del vecino.
  const blocks = $('li, article, figcaption, td, p, h3, h4, h5, div')
    .toArray()
    .map((el) => ({ el, text: visibleText($, $(el)) }))
    .filter((b) => b.text.length >= 6 && b.text.length <= 240)
    .sort((a, b) => a.text.length - b.text.length)

  for (const { el, text } of blocks) {
    const $el = $(el)

    const email = tidy($el.find('a[href^="mailto:" i]').first().attr('href') || '')
      .replace(/^mailto:/i, '').split('?')[0].toLowerCase() || null

    // Se acepta el bloque si declara un cargo O si trae un email nominativo: en
    // las páginas de equipo la mitad de las fichas repiten "Agente" y la otra
    // mitad solo ponen nombre + correo, y descartarlas dejaba fuera a personas
    // que la propia web publica como contacto.
    // Prosa institucional: "Somos una corredora con oficina en Av. X 1947"
    // contiene un cargo ("corredora") y un grupo de palabras capitalizadas
    // ("Padre Hurtado Norte") — y no es nadie. Se descarta antes de mirar nada más.
    if (PROSE_RE.test(text)) continue

    const role = classifyRole(text)
    if (!role && !(email && !GENERIC_MAILBOXES.has(email.split('@')[0]))) continue

    const nameMatch = text.match(PERSON_NAME_RE)
    if (!nameMatch) continue
    const candidate = trimRoleFromName(nameMatch[1])
    if (candidate.split(/\s+/).length < 2) continue
    if (NOT_A_NAME_RE.test(candidate)) continue
    if (ROLE_JEFATURA_RE.test(candidate) || ROLE_EJECUTIVO_RE.test(candidate)) continue

    const telHref = tidy($el.find('a[href^="tel:" i], a[href*="wa.me" i]').first().attr('href') || '')
    const phone = normalizeChilePhone(telHref.replace(/^tel:/i, '').replace(/.*wa\.me\//i, '')) ??
      (phonesFromText(text)[0] ?? null)

    push({
      full_name: titleCase(candidate),
      role_raw: role?.role_raw ?? null,
      role_kind: role?.role_kind ?? ROLE_KIND.desconocido,
      email: email && !VENDOR_DOMAINS_RE.test(email) ? email : null,
      phone,
      source_url: url || null,
    })
  }

  // Personas deducidas de buzones nominales (nombre.apellido@corredora.cl).
  $('a[href^="mailto:" i]').each((_, el) => {
    const email = tidy($(el).attr('href')).replace(/^mailto:/i, '').split('?')[0].toLowerCase()
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return
    if (VENDOR_DOMAINS_RE.test(email)) return
    const name = nameFromEmail(email)
    if (!name || NOT_A_NAME_RE.test(name)) return
    push({
      full_name: name,
      role_raw: null,
      role_kind: ROLE_KIND.desconocido,
      email,
      phone: null,
      source_url: url || null,
    })
  })

  return out
}

// ── Descubrimiento de páginas internas ───────────────────────────────────────

// Páginas donde vive la ficha de empresa. `nosotros`/`equipo` son las que traen
// jefaturas y ejecutivas; el resto de la web es inventario y no aporta.
const CONTACT_PAGE_RE =
  /(contacto|contactenos|cont[aá]ctenos|contact|nosotros|quienes[-_\s]?somos|qui[eé]nes|empresa|equipo|team|about|staff|ejecutiv|agentes)/i

/**
 * URLs internas candidatas a tener la ficha de empresa, ordenadas por lo
 * prometedoras que son y limitadas a `max` (el crawl es cortés: H22).
 *
 * @param {string} html HTML de la home
 * @param {{ domain: string, max?: number }} opts
 * @returns {string[]} URLs absolutas del MISMO dominio
 */
export function pickContactPages(html, { domain, max = 4 } = {}) {
  if (!html || !domain) return []
  let $
  try { $ = load(html) } catch { return [] }

  const base = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  const scored = new Map()

  $('a[href]').each((_, el) => {
    const href = tidy($(el).attr('href'))
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) return

    let abs
    if (/^https?:\/\//i.test(href)) {
      // Enlaces a otros dominios (portales, redes) no son la web de la corredora.
      if (!new RegExp(`(^|\\.)${base.replace(/\./g, '\\.')}(/|$|:)`, 'i').test(href.replace(/^https?:\/\//i, ''))) return
      abs = href
    } else if (href.startsWith('/')) {
      abs = `https://www.${base}${href}`
    } else {
      abs = `https://www.${base}/${href.replace(/^\.?\//, '')}`
    }
    abs = abs.split('#')[0]

    const label = `${href} ${tidy($(el).text())}`
    if (!CONTACT_PAGE_RE.test(label)) return
    // "contacto" antes que "nosotros": es donde está el teléfono seguro.
    const score = /contact/i.test(label) ? 0 : /equipo|team|staff|ejecutiv|agentes/i.test(label) ? 1 : 2
    if (!scored.has(abs) || scored.get(abs) > score) scored.set(abs, score)
  })

  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length)
    .slice(0, max)
    .map(([u]) => u)
}

/**
 * Une las fichas parciales de varias páginas en una sola. El orden de entrada
 * manda: lo primero visto gana para los campos de valor único (dirección), y
 * las listas se concatenan sin duplicados.
 *
 * @param {Array<ReturnType<typeof extractContacto> & { source_url?: string }>} parts
 */
export function mergeContacto(parts) {
  const merged = {
    phones: [], whatsapp: [], emails: [], address: null, socials: {},
    people: [], source_urls: [],
  }
  for (const part of parts) {
    if (!part) continue
    for (const k of ['phones', 'whatsapp', 'emails']) {
      for (const v of part[k] ?? []) if (!merged[k].includes(v)) merged[k].push(v)
    }
    if (!merged.address && part.address) merged.address = part.address
    for (const [net, u] of Object.entries(part.socials ?? {})) if (!merged.socials[net]) merged.socials[net] = u
    for (const p of part.people ?? []) {
      const existing = merged.people.find((x) => x.full_name.toLowerCase() === p.full_name.toLowerCase())
      if (!existing) { merged.people.push(p); continue }
      // Misma persona vista en dos páginas: se completa lo que falte.
      existing.role_raw = existing.role_raw ?? p.role_raw
      if (existing.role_kind === 'desconocido' && p.role_kind !== 'desconocido') existing.role_kind = p.role_kind
      existing.email = existing.email ?? p.email
      existing.phone = existing.phone ?? p.phone
    }
    if (part.source_url && !merged.source_urls.includes(part.source_url)) merged.source_urls.push(part.source_url)
  }
  return merged
}
