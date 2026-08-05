// ─────────────────────────────────────────────────────────────────────────────
// ¿Qué nos acaba de devolver Portal Inmobiliario?
//
// Portal Inmobiliario (Mercado Libre Chile) responde HTTP 200 en al menos
// CUATRO situaciones distintas, y solo una de ellas es una página que se pueda
// scrapear. Distinguirlas con `html.includes('__NORDIC_RENDERING_CTX__')` —lo
// que hacía el scraper y también la sonda del panel— es INSUFICIENTE, y esa
// insuficiencia es la que dejó el barrido parado 5 horas sin que nadie pudiera
// ver por qué:
//
//   1. PÁGINA ÚTIL — trae el blob Nordic Y `initialState` dentro. Es la única
//      de la que el parser saca anuncios.
//
//   2. BLOQUEO ANTIBOT — Mercado Libre sirve su pantalla de "tráfico
//      sospechoso" (`suspicious-traffic-frontend` → `/gz/account-verification`).
//      Y AQUÍ ESTÁ LA TRAMPA: esa pantalla está construida con el MISMO
//      framework Nordic, así que TAMBIÉN lleva `__NORDIC_RENDERING_CTX__` — con
//      `appProps.pageProps` y todo — pero SIN `initialState`. Verificado contra
//      el portal en real (2026-08-05): 200 OK, ~7-22 KB, marcador Nordic
//      presente, `initialState` ausente, 0 anuncios.
//      Consecuencia: el fetch la daba por buena (`ok: true`), NO reintentaba y
//      NO abría el circuito; el barrido bajaba una sola vez, no entendía nada y
//      anotaba "p1 sin anuncios ni total (respuesta no reconocida)". Con el
//      proxy residencial rotando IP, un simple reintento suele salir por otra IP
//      y traer la página buena — pero ese reintento nunca llegaba a ocurrir.
//      No depende de los headers ni de las cookies: probado con Sec-Fetch-*,
//      sec-ch-ua y tarro de cookies, el bloqueo es por REPUTACIÓN DE LA IP.
//
//   3. VARIANTE LIGERA — 200 sin blob Nordic (polycards renderizadas en
//      servidor). El parser saca 0. Ya se detectaba.
//
//   4. VARIANTE DESCONOCIDA — blob Nordic sin `initialState` y sin marcas de
//      bloqueo: maquetación cambiada. Distinta del bloqueo a propósito: una
//      pide rotar IP, la otra pide arreglar el parser.
//
// Este módulo es la ÚNICA definición de esa clasificación. Vive en web/lib
// (misma convención que rol-format.mjs y smartbc/*.mjs) porque lo necesitan los
// dos runtimes: el worker del scraper (scraper/lib/fetch.mjs) y las rutas de la
// web (/api/chile/anuncios-health y su sonda). El contenedor del worker copia
// este archivo explícitamente — ver scraper/Dockerfile.
// ─────────────────────────────────────────────────────────────────────────────

export const PI_UTIL = 'util'
export const PI_ANTIBOT = 'antibot'
export const PI_LIGERA = 'ligera'
export const PI_DESCONOCIDA = 'desconocida'
export const PI_VACIA = 'vacia'

const MARCA_NORDIC = '__NORDIC_RENDERING_CTX__'
// `initialState` es la raíz de la que cuelga TODO lo que el parser lee (results,
// pagination, melidata_track). Sin él no hay página que valga, tenga o no el
// marcador de Nordic.
const MARCA_ESTADO = /"initialState"\s*:/

// Marcas de la pantalla de verificación de Mercado Libre. Se comprueban las tres
// porque el portal sirve más de una maqueta del mismo bloqueo (una de ~22 KB con
// el flujo completo y otra de ~7 KB), y las tres aparecen en ambas.
const MARCAS_ANTIBOT = /suspicious-traffic|gz[/-]account-verification|gz\/webdevice\/config/i

// Por debajo de esto no hay página que analizar (respuesta cortada, error del
// proxy servido como cuerpo, etc.).
const MINIMO_BYTES = 500

/**
 * Clasifica el HTML que devolvió Portal Inmobiliario.
 *
 * El orden de las comprobaciones importa: `util` se decide PRIMERO, así que una
 * página que trae `initialState` jamás puede caer en `antibot` por mencionar por
 * casualidad alguna de esas cadenas. Las marcas de bloqueo solo se miran cuando
 * ya sabemos que la página no sirve.
 *
 * @param {string|null|undefined} html
 * @returns {{ usable: boolean, tipo: string, motivo: string|null }}
 */
export function clasificarHtmlPi(html) {
  const texto = typeof html === 'string' ? html : ''
  if (texto.length < MINIMO_BYTES) {
    return { usable: false, tipo: PI_VACIA, motivo: 'respuesta vacía o demasiado corta' }
  }
  if (texto.includes(MARCA_NORDIC) && MARCA_ESTADO.test(texto)) {
    return { usable: true, tipo: PI_UTIL, motivo: null }
  }
  if (MARCAS_ANTIBOT.test(texto)) {
    return {
      usable: false,
      tipo: PI_ANTIBOT,
      motivo: 'bloqueo antibot de Mercado Libre (pantalla de "tráfico sospechoso"): la IP que pide las páginas está señalada',
    }
  }
  if (texto.includes(MARCA_NORDIC)) {
    return {
      usable: false,
      tipo: PI_DESCONOCIDA,
      motivo: 'respuesta con blob Nordic pero sin initialState (maquetación desconocida)',
    }
  }
  return {
    usable: false,
    tipo: PI_LIGERA,
    motivo: 'variante ligera: 200 sin el blob Nordic (el parser sacaría 0 anuncios)',
  }
}

/** ¿Se puede scrapear esta página? Atajo para quien solo necesita el sí/no. */
export function htmlPiUtilizable(html) {
  return clasificarHtmlPi(html).usable
}

/**
 * Frase corta para el panel de salud, ya orientada a la ACCIÓN que toca. Recibe
 * la etiqueta de la vía ("Evomi", "la VPS") porque el mismo tipo de respuesta se
 * arregla distinto según quién la recibió.
 */
export function veredictoPi(tipo, etiquetaVia) {
  switch (tipo) {
    case PI_UTIL:
      return `OK — ${etiquetaVia} recibe la página completa (se puede scrapear)`
    case PI_ANTIBOT:
      return `BLOQUEO ANTIBOT — Mercado Libre le sirve a ${etiquetaVia} la pantalla de verificación de tráfico sospechoso (HTTP 200, pero sin anuncios): esa IP está señalada`
    case PI_LIGERA:
      return `VARIANTE LIGERA — 200 sin blob por ${etiquetaVia}: el parser sacaría 0`
    case PI_DESCONOCIDA:
      return `MAQUETACIÓN DESCONOCIDA — ${etiquetaVia} recibe una página sin initialState: revisar el parser`
    default:
      return `RESPUESTA VACÍA — ${etiquetaVia} no recibió una página analizable`
  }
}
