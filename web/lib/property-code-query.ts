// property-code-query.ts — cómo se interpreta lo que el equipo escribe en el
// buscador «Código de propiedad o URL» de /chile/propiedades.
//
// El buscador tiene que aceptar CUALQUIERA de las formas en que un inmueble se
// nombra en el día a día, porque cada una viene de un sitio distinto:
//
//   - La URL pegada tal cual del navegador, con slug y sufijos:
//       https://www.portalinmobiliario.com/MLC-2107783039-se-vende-gran-casa-…-_JM
//     (y sus variantes: con `?`/`#` de tracking, con `http://`, sin `www.`,
//      subdominios `casa.` / `articulo.mercadolibre.cl`, o pegada con espacios).
//   - El número suelto del anuncio, que es lo que se copia del final de la URL
//     o de un WhatsApp: `2107783039`.
//   - El mismo número con su prefijo: `MLC-2107783039` o `MLC2107783039`.
//   - Un código INTERNO: el del CRM (`ref_code`, "PI-2607-21087") o el que usa
//     la corredora en su propia web (`property_code` / `seller_reference`).
//
// Este módulo convierte ese texto libre en las piezas con las que la consulta
// SQL puede buscar (y, si no hay nada en la base, con las que se puede traer la
// ficha en vivo del portal). No consulta la base ni la red: es solo parsing, y
// por eso se puede probar con `node --test`.

/** Hosts cuyos anuncios sabemos identificar por su MLC-id. */
const PORTAL_HOSTS = /(?:portalinmobiliario\.com|mercadolibre\.cl)/i

/** El id de anuncio de Portal Inmobiliario / MercadoLibre Chile. */
const MLC_RE = /MLC-?(\d+)/i

// Un número suelto solo se interpreta como id de anuncio a partir de 8 dígitos:
// los códigos internos de las corredoras son cortos ("5495") y confundirlos con
// un MLC-id haría que el buscador se fuera al portal en vez de mirar la base.
const MIN_DIGITS_MLC = 8

// Para SALIR a buscar la ficha al portal (una petición de red que tarda) se
// pide algo inequívoco: una URL, el prefijo `MLC` escrito, o un número ya
// completo. Así, mientras alguien teclea "2107783039" dígito a dígito, los
// estados intermedios no disparan un scraping condenado a fallar.
const MIN_DIGITS_SCRAPE = 9

export type PropertyCodeQuery = {
  /** El texto de entrada, ya recortado. */
  raw: string
  /** MLC-id normalizado con guión ("MLC-2107783039"), o null si no hay. */
  mlcId: string | null
  /** URL del anuncio ya limpia (sin `?`/`#`), si lo escrito era una URL. */
  listingUrl: string | null
  /** Códigos con los que comparar EXACTO contra los códigos internos. */
  codes: string[]
  /** Texto para la búsqueda parcial (ILIKE); null si no aplica. */
  likeText: string | null
  /** ¿Es lo bastante específico como para ir a buscarlo al portal? */
  scrapeable: boolean
}

/** ¿El texto es una URL (con protocolo o pegada sin él, "www.portal…")? */
function looksLikeUrl(text: string): boolean {
  return /^https?:\/\//i.test(text) || /^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\//i.test(text)
}

// Quita el tracking (`?…`, `#…`) y la barra final, y le pone el protocolo si se
// pegó sin él ("www.portalinmobiliario.com/MLC-…"): la URL que sale de aquí se
// usa tal cual para descargar el anuncio, así que tiene que ser descargable.
function cleanUrl(text: string): string {
  const sinTracking = text.split('#')[0].split('?')[0].replace(/\/+$/, '')
  return /^https?:\/\//i.test(sinTracking) ? sinTracking : `https://${sinTracking}`
}

/**
 * Interpreta lo escrito en el buscador por código o URL.
 *
 * Nunca lanza: un texto que no encaje en nada devuelve simplemente un código
 * suelto con el que buscar por coincidencia parcial.
 */
export function parsePropertyCodeQuery(input: string): PropertyCodeQuery {
  // Lo pegado desde otra app puede traer comillas, `<>` de un cliente de correo
  // o saltos de línea; nada de eso es parte del código.
  const raw = input.trim().replace(/^[<"'\s]+|[>"'\s]+$/g, '')

  const empty: PropertyCodeQuery = {
    raw, mlcId: null, listingUrl: null, codes: [], likeText: null, scrapeable: false,
  }
  if (!raw) return empty

  const mlcMatch = raw.match(MLC_RE)
  const mlcId = mlcMatch ? `MLC-${mlcMatch[1]}` : null

  if (looksLikeUrl(raw)) {
    const listingUrl = cleanUrl(raw)
    return {
      raw,
      mlcId,
      listingUrl,
      // Una URL no es un código interno: compararla contra `property_code` solo
      // daría falsos negativos silenciosos.
      codes: [],
      // Sin MLC-id (una URL de la web propia de una corredora) lo único que
      // queda es buscar por la URL guardada del anuncio. Se compara SIN
      // protocolo ni `www.`: la guardada puede tener otra forma de escribir el
      // mismo enlace y eso no debería esconder el anuncio.
      likeText: mlcId ? null : listingUrl.replace(/^https?:\/\/(?:www\.)?/i, ''),
      scrapeable: mlcId !== null,
    }
  }

  // `MLC-2107783039` / `MLC2107783039` escrito a mano: es el anuncio, no un
  // código interno. Con el prefijo escrito la intención es explícita, así que
  // basta con que el número esté completo para ir a buscarlo al portal.
  if (mlcId && /^MLC-?\d+$/i.test(raw)) {
    const digitos = mlcId.slice('MLC-'.length)
    return {
      raw, mlcId, listingUrl: null, codes: [], likeText: null,
      scrapeable: digitos.length >= MIN_DIGITS_MLC,
    }
  }

  // Número suelto: puede ser el id del anuncio (`2107783039`) o el código
  // interno de una corredora (`5495`). Se buscan LAS DOS COSAS — quien escribe
  // un número no tiene por qué saber en qué columna vive.
  if (/^\d+$/.test(raw)) {
    const esLargo = raw.length >= MIN_DIGITS_MLC
    return {
      raw,
      mlcId: esLargo ? `MLC-${raw}` : null,
      listingUrl: null,
      codes: [raw],
      likeText: raw,
      scrapeable: raw.length >= MIN_DIGITS_SCRAPE,
    }
  }

  // Cualquier otra cosa (código interno del CRM "PI-2607-21087", referencia de
  // la corredora "CASA-VITACURA-12"…): coincidencia exacta y parcial.
  return { raw, mlcId, listingUrl: null, codes: [raw], likeText: raw, scrapeable: false }
}

/**
 * Extrae el MLC-id normalizado ("MLC-2107783039") de un código suelto o de una
 * URL completa. Devuelve null si el texto no identifica ningún anuncio.
 */
export function extractMlcId(input: string): string | null {
  return parsePropertyCodeQuery(input).mlcId
}

/** ¿El texto apunta a un anuncio de los portales que sabemos descargar? */
export function isPortalUrl(input: string): boolean {
  return PORTAL_HOSTS.test(input)
}
