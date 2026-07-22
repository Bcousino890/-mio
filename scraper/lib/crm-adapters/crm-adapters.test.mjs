// Tests de los adaptadores CRM (crm-adapters/ · Fase 4 / H21).
//
// Correr:  node --test scraper/lib/crm-adapters/crm-adapters.test.mjs
//
// Verifican: helpers de extracción puros, parseDetail sobre fichas ASP.NET
// representativas (código interno = clave del enlace Nivel 1.5), listUrl por
// plataforma, y el registro getAdapter.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getAdapter, SUPPORTED_PLATFORMS,
  parsePrice, parseSqm, parseInternalCode, cleanPhotos, parseOperation, parsePropertyType,
  parseDetailGeneric,
} from './index.mjs'
import * as convecta from './convecta.mjs'
import * as ofinet from './ofinet.mjs'

// ── Registro ─────────────────────────────────────────────────────────────────

test('getAdapter devuelve el adaptador soportado o null', () => {
  assert.equal(getAdapter('convecta').platform, 'convecta')
  assert.equal(getAdapter('ofinet').platform, 'ofinet')
  assert.equal(getAdapter('other'), null)
  assert.equal(getAdapter('unknown'), null)
  assert.deepEqual(SUPPORTED_PLATFORMS.sort(), ['convecta', 'ofinet'])
})

// ── Helpers puros ────────────────────────────────────────────────────────────

test('parsePrice reconoce CLP y UF con separadores chilenos', () => {
  assert.deepEqual(parsePrice('$ 320.000.000'), { clp: 320000000, uf: null, currency: 'CLP' })
  assert.deepEqual(parsePrice('UF 12.500'), { clp: null, uf: 12500, currency: 'UF' })
  assert.deepEqual(parsePrice('12.500 UF'), { clp: null, uf: 12500, currency: 'UF' })
  assert.deepEqual(parsePrice('Consultar'), { clp: null, uf: null, currency: null })
})

test('parseSqm extrae metros cuadrados', () => {
  assert.equal(parseSqm('120 m²'), 120)
  assert.equal(parseSqm('Superficie útil 85,5 m2'), 86)
  assert.equal(parseSqm('sin dato'), null)
})

test('parseInternalCode: etiquetas y fallback a URL', () => {
  assert.equal(parseInternalCode('Código: OR58124'), 'OR58124')
  assert.equal(parseInternalCode('Cód. MG-882'), 'MG-882')
  assert.equal(parseInternalCode('Ref 1234'), '1234')
  assert.equal(parseInternalCode('sin código', 'https://x.cl/propiedad/998877/ficha'), '998877')
  assert.equal(parseInternalCode('nada', 'https://x.cl/'), null)
})

test('parseOperation / parsePropertyType', () => {
  assert.equal(parseOperation('Casa en Venta'), 'sale')
  assert.equal(parseOperation('Departamento en Arriendo'), 'rent')
  assert.equal(parsePropertyType('Linda Casa en Las Condes'), 'casa')
  assert.equal(parsePropertyType('Depto amoblado'), 'departamento')
})

test('cleanPhotos deduplica y filtra a imágenes absolutas', () => {
  const out = cleanPhotos([
    'https://cdn.x.cl/a.jpg', 'https://cdn.x.cl/a.jpg', '/rel/b.jpg',
    'https://cdn.x.cl/c.png', 'https://cdn.x.cl/script.js',
  ])
  assert.deepEqual(out, ['https://cdn.x.cl/a.jpg', 'https://cdn.x.cl/c.png'])
})

// ── Fichas representativas ASP.NET ───────────────────────────────────────────

const CONVECTA_FICHA = `<!doctype html><html><head>
  <meta name="author" content="Convecta Desarrollos Informaticos SpA" />
  <meta property="og:title" content="Casa en Venta en Las Condes" />
  <meta property="og:image" content="https://cdn.magnolia.cl/fotos/1.jpg" />
  <meta property="og:description" content="Amplia casa con jardín" />
  </head><body>
  <h1>Casa en Venta en Las Condes</h1>
  <div class="precio">UF 18.500</div>
  <ul class="caracteristicas">
    <li>Dormitorios: 4</li>
    <li>Baños: 3</li>
    <li>Superficie construida 220 m²</li>
    <li>Comuna: Las Condes</li>
    <li>Código: MG-1024</li>
  </ul>
  <div class="galeria">
    <img src="https://cdn.magnolia.cl/fotos/1.jpg" />
    <img data-src="https://cdn.magnolia.cl/fotos/2.jpg" />
  </div>
  <footer class="footer-convecta">Desarrollado por Convecta</footer>
  </body></html>`

test('Convecta.parseDetail extrae la ficha completa', () => {
  const l = convecta.parseDetail(CONVECTA_FICHA, { url: 'https://www.magnoliaproperty.cl/propiedad/1024', domain: 'magnoliaproperty.cl' })
  assert.ok(l)
  assert.equal(l.portal, 'web:magnoliaproperty.cl')
  assert.equal(l.source_type, 'agency_web')
  assert.equal(l.seller_reference, 'MG-1024')
  assert.equal(l.external_id, 'magnoliaproperty.cl:MG-1024')
  assert.equal(l.operation, 'sale')
  assert.equal(l.property_type, 'casa')
  assert.equal(l.price_uf, 18500)
  assert.equal(l.currency, 'UF')
  assert.equal(l.bedrooms, 4)
  assert.equal(l.bathrooms, 3)
  assert.equal(l.square_meters, 220)
  assert.equal(l.comuna, 'Las Condes')
  assert.ok(l.photos.includes('https://cdn.magnolia.cl/fotos/1.jpg'))
  assert.ok(l.photos.includes('https://cdn.magnolia.cl/fotos/2.jpg'))
  assert.equal(l.crm_platform, 'convecta')
})

const OFINET_FICHA = `<html><head>
  <meta property="og:title" content="Departamento en Arriendo Providencia" />
  </head><body>
  <h1>Departamento en Arriendo Providencia</h1>
  <div class="price">$ 750.000</div>
  <table class="detalle">
    <tr><td>Dormitorios</td><td>2</td></tr>
    <tr><td>Baños</td><td>2</td></tr>
    <tr><td>Superficie útil</td><td>65 m2</td></tr>
    <tr><td>Comuna</td><td>Providencia</td></tr>
    <tr><td>Cód.</td><td>OR58124</td></tr>
  </table>
  <img src="https://cdn.bpropiedades.cl/x/a.jpg" />
  <footer>Designed by Ofinet</footer>
  </body></html>`

test('Ofinet.parseDetail extrae la ficha completa', () => {
  const l = ofinet.parseDetail(OFINET_FICHA, { url: 'https://www.bpropiedades.cl/ficha.asp?id=58124', domain: 'bpropiedades.cl' })
  assert.ok(l)
  assert.equal(l.portal, 'web:bpropiedades.cl')
  assert.equal(l.seller_reference, 'OR58124')
  assert.equal(l.operation, 'rent')
  assert.equal(l.property_type, 'departamento')
  assert.equal(l.price, 750000)
  assert.equal(l.currency, 'CLP')
  assert.equal(l.bedrooms, 2)
  assert.equal(l.bathrooms, 2)
  assert.equal(l.square_meters, 65)
  assert.equal(l.comuna, 'Providencia')
  assert.equal(l.crm_platform, 'ofinet')
})

test('parseDetail devuelve null sin código ni precio', () => {
  const html = `<html><body><h1>Página institucional</h1><p>Quiénes somos</p></body></html>`
  assert.equal(parseDetailGeneric(html, { domain: 'x.cl' }), null)
})

test('parseDetail usa hash de URL como external_id si no hay código', () => {
  const html = `<html><body><div class="precio">$ 100.000.000</div></body></html>`
  const l = parseDetailGeneric(html, { url: 'https://x.cl/p/abc', domain: 'x.cl' })
  assert.ok(l)
  assert.equal(l.seller_reference, null)
  assert.match(l.external_id, /^x\.cl:[a-z0-9]+$/)
})

// ── listUrl por plataforma ───────────────────────────────────────────────────

test('Convecta.listUrl usa segmentos de carpeta', () => {
  assert.equal(
    convecta.listUrl('magnoliaproperty.cl', { operation: 'sale', propertyType: 'casa', comuna: 'Las Condes' }),
    'https://www.magnoliaproperty.cl/Casas/Venta/Las_Condes'
  )
  assert.equal(
    convecta.listUrl('magnoliaproperty.cl', {}),
    'https://www.magnoliaproperty.cl/Todos_los_tipos/Venta_y_Arriendo/Todas_las_comunas'
  )
})

test('Ofinet.listUrl usa querystring select-*', () => {
  const u = ofinet.listUrl('bpropiedades.cl', { operation: 'sale' })
  assert.match(u, /^https:\/\/www\.bpropiedades\.cl\/i_listing-4-column\.asp\?/)
  assert.match(u, /select-status=VE/)
  assert.match(u, /select-property-type=-1/)
})

test('parseList devuelve [] cuando el listado no trae enlaces (AJAX)', () => {
  const html = `<html><body><div id="app">cargando…</div></body></html>`
  assert.deepEqual(convecta.parseList(html, { domain: 'magnoliaproperty.cl' }), [])
})

test('parseList recoge enlaces a fichas cuando están en el HTML', () => {
  const html = `<html><body>
    <a href="/propiedad/1024/casa-las-condes">Casa</a>
    <a href="/propiedad/1025/depto">Depto</a>
    <a href="/nosotros">Nosotros</a>
  </body></html>`
  const links = ofinet.parseList(html, { domain: 'bpropiedades.cl' })
  assert.equal(links.length, 2)
  assert.ok(links.every(l => /\/propiedad\//.test(l.url)))
})
