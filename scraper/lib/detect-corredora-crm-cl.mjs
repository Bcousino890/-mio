// ─────────────────────────────────────────────────────────────────────────────
// detect-corredora-crm-cl.mjs — detector de plataforma CRM de una web propia de
// corredora (plan Anuncios CL · Fase 4 / H21).
//
// Clasifica el HTML de una web de corredora en 'convecta' | 'ofinet' | 'other'.
// Cuando reconoce la plataforma, el crawler reusa el adaptador ya escrito para
// ella (crm-adapters/) — solo cambia el dominio — en vez de un parser nuevo por
// corredora. 'other' = web que responde pero cuya plataforma no reconocemos:
// queda registrada pero sin adaptador automático.
//
// Señales VERIFICADAS con HTML real (curl directo, ver plan H21):
//   · Convecta (magnoliaproperty.cl): señal primaria y robusta =
//     <meta name="author" content="Convecta Desarrollos Informaticos SpA">
//     en el <head> (no depende de que el footer se renderice). Secundaria:
//     footer "Desarrollado por Convecta" + link a convecta.cl.
//   · Ofinet (bpropiedades.cl, cympropiedades.cl): señal primaria = footer
//     "Designed by Ofinet". Secundaria: listados en .asp con querystring
//     select-status= / select-property-type=.
//
// Sin dependencias de red: recibe el HTML ya descargado (el caller usa fetch.mjs
// con el rate-limit suave de H22). Puro y testeable con fixtures.
// ─────────────────────────────────────────────────────────────────────────────
import { load } from 'cheerio'

/** @typedef {'convecta'|'ofinet'|'other'} CrmPlatform */

const AUTHOR_CONVECTA = /convecta\s+desarrollos\s+inform[aá]ticos/i
const FOOTER_CONVECTA = /desarrollado\s+por\s+convecta/i
const LINK_CONVECTA = /convecta\.cl/i

const FOOTER_OFINET = /designed\s+by\s+ofinet/i
const OFINET_ASP = /\.asp\b[^"'<>]*select-(?:status|property-type)=/i
const LINK_OFINET = /ofinet\.cl/i

/**
 * Detecta la plataforma CRM a partir del HTML de cualquier página de la web
 * (home o ficha sirven; el <head>/footer son estables en todo el sitio).
 *
 * @param {string} html
 * @returns {{ platform: CrmPlatform, confidence: 'high'|'low'|'none', signals: string[] }}
 */
export function detectCorredoraCrm(html) {
  if (!html || typeof html !== 'string') {
    return { platform: 'other', confidence: 'none', signals: [] }
  }

  const signals = []
  let metaAuthor = ''
  // Texto plano (sin tags): el footer suele llevar un <a> entre "por" y
  // "Convecta", así que la frase solo aparece contigua al quitar el markup.
  let text = html
  try {
    const $ = load(html)
    metaAuthor = ($('meta[name="author"]').attr('content') || '').trim()
    text = ($('body').text() || $.root().text() || html).replace(/\s+/g, ' ')
  } catch {
    // HTML malformado: caemos al string crudo (aún detecta lo contiguo).
  }

  // ── Convecta ────────────────────────────────────────────────────────────
  // La señal más robusta es el meta author del <head> (no depende del footer).
  if (AUTHOR_CONVECTA.test(metaAuthor)) {
    signals.push('meta-author:convecta')
    return { platform: 'convecta', confidence: 'high', signals }
  }
  if (FOOTER_CONVECTA.test(text)) {
    signals.push('footer:desarrollado-por-convecta')
    if (LINK_CONVECTA.test(html)) signals.push('link:convecta.cl')
    return { platform: 'convecta', confidence: 'high', signals }
  }

  // ── Ofinet ──────────────────────────────────────────────────────────────
  if (FOOTER_OFINET.test(text)) {
    signals.push('footer:designed-by-ofinet')
    if (OFINET_ASP.test(html)) signals.push('url:asp-select-params')
    return { platform: 'ofinet', confidence: 'high', signals }
  }
  // Sin footer explícito, el patrón de URL de listado es una señal secundaria.
  if (OFINET_ASP.test(html)) {
    signals.push('url:asp-select-params')
    if (LINK_OFINET.test(html)) signals.push('link:ofinet.cl')
    return { platform: 'ofinet', confidence: 'low', signals }
  }

  // Señal débil de Convecta como fallback (link sin footer/meta).
  if (LINK_CONVECTA.test(html)) {
    signals.push('link:convecta.cl')
    return { platform: 'convecta', confidence: 'low', signals }
  }

  return { platform: 'other', confidence: 'none', signals }
}

/**
 * Normaliza un dominio a su forma canónica de clave: sin protocolo, sin "www.",
 * sin barra final, en minúsculas. "https://www.Magnolia.cl/venta" → "magnolia.cl".
 * (Mismo criterio que el UNIQUE index de 0069.)
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return ''
  let d = input.trim().toLowerCase()
  d = d.replace(/^[a-z]+:\/\//, '') // protocolo
  d = d.replace(/^www\./, '')       // www.
  d = d.split('/')[0]               // ruta
  d = d.split('?')[0].split('#')[0] // query/hash por si acaso
  d = d.replace(/:\d+$/, '')        // puerto
  return d.trim()
}
