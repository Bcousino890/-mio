// Tests del detector de plataforma CRM de webs de corredoras
// (detect-corredora-crm-cl.mjs · Fase 4 / H21).
//
// Correr:  node --test scraper/lib/detect-corredora-crm-cl.test.mjs
//
// Fixtures basados en los footprints VERIFICADOS con HTML real (plan H21):
// meta author de Convecta, footer "Designed by Ofinet", URLs .asp select-*.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectCorredoraCrm, normalizeDomain } from './detect-corredora-crm-cl.mjs'

// ── Convecta ─────────────────────────────────────────────────────────────────

test('Convecta: meta author en el <head> → convecta high', () => {
  const html = `<!doctype html><html><head>
    <meta name="author" content="Convecta Desarrollos Informaticos SpA" />
    <title>Magnolia Property</title></head><body>...</body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'convecta')
  assert.equal(r.confidence, 'high')
  assert.ok(r.signals.includes('meta-author:convecta'))
})

test('Convecta: footer "Desarrollado por Convecta" sin meta → convecta high', () => {
  const html = `<html><head></head><body>
    <footer><div class="footer-col footer-convecta">Desarrollado por
    <a href="https://convecta.cl">Convecta</a></div></footer></body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'convecta')
  assert.equal(r.confidence, 'high')
  assert.ok(r.signals.includes('footer:desarrollado-por-convecta'))
  assert.ok(r.signals.includes('link:convecta.cl'))
})

// ── Ofinet ───────────────────────────────────────────────────────────────────

test('Ofinet: footer "Designed by Ofinet" → ofinet high', () => {
  const html = `<html><head></head><body>
    <footer>Designed by Ofinet</footer></body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'ofinet')
  assert.equal(r.confidence, 'high')
  assert.ok(r.signals.includes('footer:designed-by-ofinet'))
})

test('Ofinet: footer + URL .asp select-* → suma señal de URL', () => {
  const html = `<html><body>
    <a href="i_listing-4-column.asp?select-status=VE&select-property-type=-1">Ver</a>
    <footer>Designed by Ofinet</footer></body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'ofinet')
  assert.ok(r.signals.includes('url:asp-ofinet'))
})

test('Ofinet: solo URL .asp select-* sin footer → ofinet low', () => {
  const html = `<html><body>
    <a href="/i_listing-4-column.asp?select-status=AR&select-property-type=2">Arriendos</a>
    </body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'ofinet')
  assert.equal(r.confidence, 'low')
})

test('Ofinet: la ficha property.asp?idPro= también identifica la plataforma', () => {
  // Es la señal de URL más específica de Ofinet y la que aparece en cualquier
  // listado, aunque la plantilla haya comentado los enlaces select-*.
  const html = `<html><body><a href="property.asp?idPro=2747">Ver ficha</a></body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'ofinet')
  assert.equal(r.confidence, 'low')
})

test('Convecta: el meta author con GUION también se reconoce', () => {
  // magnoliaproperty.cl escribe "Convecta Desarrollos Informaticos SpA" y
  // elbarrio.cl "Convecta - Desarrollos Informaticos". Exigir espacios entre
  // las dos palabras dejaba fuera la segunda variante, que quedaba dependiendo
  // de que el footer se renderizara.
  const html = `<!doctype html><html><head>
    <meta name="author" content="Convecta - Desarrollos Informaticos" />
    </head><body>El Barrio Propiedades</body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'convecta')
  assert.equal(r.confidence, 'high')
  assert.ok(r.signals.includes('meta-author:convecta'))
})

test('Convecta: el CDN prop360 delata la plataforma sin meta ni footer', () => {
  // Un cliente puede reescribir la plantilla entera, pero las fotos las sigue
  // sirviendo el CDN del producto sobre el que corre Convecta.
  const html = `<html><body>
    <img src="https://demoazimg.prop360.cl//elbarrio/img/propiedades/12828_a.jpg">
    </body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'convecta')
  assert.equal(r.confidence, 'low')
  assert.ok(r.signals.includes('cdn:prop360.cl'))
})

// ── Konnect (Property Partners) ──────────────────────────────────────────────

test('Konnect: el almacenamiento propio identifica la plataforma', () => {
  const html = `<html><head>
    <meta property="og:image" content="https://konnect-cdn.ppartnersgroup.com/public/site/imgs/og.png"/>
    </head><body><script src="/_next/static/chunks/main.js"></script></body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'konnect')
  assert.equal(r.confidence, 'high')
  assert.ok(r.signals.includes('cdn:konnect'))
})

// ── other / robustez ─────────────────────────────────────────────────────────

test('web genérica sin señales → other none', () => {
  const html = `<html><head><meta name="author" content="Juan Pérez"></head>
    <body><footer>© 2026 Corredora X</footer></body></html>`
  const r = detectCorredoraCrm(html)
  assert.equal(r.platform, 'other')
  assert.equal(r.confidence, 'none')
  assert.deepEqual(r.signals, [])
})

test('entradas inválidas no rompen', () => {
  assert.equal(detectCorredoraCrm(null).platform, 'other')
  assert.equal(detectCorredoraCrm('').platform, 'other')
  assert.equal(detectCorredoraCrm(12345).platform, 'other')
})

test('HTML malformado sigue detectando por string crudo', () => {
  const html = `<html><body><footer>Designed by Ofinet`  // sin cerrar tags
  assert.equal(detectCorredoraCrm(html).platform, 'ofinet')
})

// ── normalizeDomain ──────────────────────────────────────────────────────────

test('normalizeDomain quita protocolo, www, ruta, puerto', () => {
  assert.equal(normalizeDomain('https://www.Magnolia.cl/venta/casas'), 'magnolia.cl')
  assert.equal(normalizeDomain('http://bpropiedades.cl'), 'bpropiedades.cl')
  assert.equal(normalizeDomain('www.cympropiedades.cl:8080/x?y=1'), 'cympropiedades.cl')
  assert.equal(normalizeDomain('MagnoliaProperty.CL'), 'magnoliaproperty.cl')
  assert.equal(normalizeDomain(''), '')
  assert.equal(normalizeDomain(null), '')
})
