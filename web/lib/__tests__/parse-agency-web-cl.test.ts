// Tests del parser de fichas de la WEB PROPIA de una corredora.
//
//   node --import tsx --test lib/__tests__/parse-agency-web-cl.test.ts
//
// Es el puerto a TS (con regex, sin cheerio) de `parseDetailGeneric` de
// `scraper/lib/crm-adapters/index.mjs`. Las dos fichas de abajo son LAS MISMAS
// que usa `scraper/lib/crm-adapters/crm-adapters.test.mjs`, y los valores
// esperados también: si las dos implementaciones se separan, esto lo canta.
//
// Para qué existe: el buscador de /chile/propiedades sabía traerse en vivo lo
// que no estuviera en la base sólo si era de Portal Inmobiliario. La ficha en
// la web de la corredora se quedaba en "no hay resultados" aunque la URL
// estuviera pegada delante.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAgencyWebListing, parsePrice, parseSqm, parseInternalCode,
  cleanPhotos, parseOperation, parsePropertyType, normalizeDomain,
} from '../parse-agency-web-cl'

// ── Helpers ──────────────────────────────────────────────────────────────────

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

test('parseInternalCode: etiquetas y respaldo en la URL', () => {
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
  assert.deepEqual(
    cleanPhotos([
      'https://cdn.x.cl/a.jpg', 'https://cdn.x.cl/a.jpg', '/rel/b.jpg',
      'https://cdn.x.cl/c.png', 'https://cdn.x.cl/script.js',
    ]),
    ['https://cdn.x.cl/a.jpg', 'https://cdn.x.cl/c.png'],
  )
})

test('normalizeDomain deja el dominio desnudo', () => {
  assert.equal(normalizeDomain('https://www.magnoliaproperty.cl/propiedad/1024'), 'magnoliaproperty.cl')
  assert.equal(normalizeDomain('bpropiedades.cl'), 'bpropiedades.cl')
  assert.equal(normalizeDomain('HTTP://WWW.Magnolia.CL/a?b=1#c'), 'magnolia.cl')
  // El puerto no es parte de la identidad de la corredora: si se colara, la
  // misma ficha entraría con dos `external_id` distintos.
  assert.equal(normalizeDomain('http://magnolia.cl:8099/propiedad/1'), 'magnolia.cl')
})

// ── Fichas representativas ───────────────────────────────────────────────────

const FICHA_CONVECTA = `<!doctype html><html><head>
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

test('ficha ASP.NET tipo Convecta: se extrae entera', () => {
  const l = parseAgencyWebListing(FICHA_CONVECTA, 'https://www.magnoliaproperty.cl/propiedad/1024')
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
  assert.equal(l.description, 'Amplia casa con jardín')
  assert.ok(l.photos.includes('https://cdn.magnolia.cl/fotos/1.jpg'))
  assert.ok(l.photos.includes('https://cdn.magnolia.cl/fotos/2.jpg'))
})

const FICHA_OFINET = `<html><head>
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

test('ficha en tabla tipo Ofinet: se extrae entera', () => {
  const l = parseAgencyWebListing(FICHA_OFINET, 'https://www.bpropiedades.cl/ficha.asp?id=58124')
  assert.ok(l)
  assert.equal(l.portal, 'web:bpropiedades.cl')
  assert.equal(l.seller_reference, 'OR58124')
  assert.equal(l.external_id, 'bpropiedades.cl:OR58124')
  assert.equal(l.operation, 'rent')
  assert.equal(l.property_type, 'departamento')
  assert.equal(l.price, 750000)
  assert.equal(l.currency, 'CLP')
  assert.equal(l.bedrooms, 2)
  assert.equal(l.bathrooms, 2)
  assert.equal(l.square_meters, 65)
  assert.equal(l.comuna, 'Providencia')
  assert.deepEqual(l.photos, ['https://cdn.bpropiedades.cl/x/a.jpg'])
})

test('sin código interno, el id sale de la URL y es estable', () => {
  const html = `<html><body><h1>Casa en venta</h1><div class="precio">UF 9.000</div></body></html>`
  const a = parseAgencyWebListing(html, 'https://www.otracorredora.cl/ver')
  const b = parseAgencyWebListing(html, 'https://www.otracorredora.cl/ver')
  assert.ok(a && b)
  assert.equal(a.seller_reference, null)
  assert.equal(a.external_id, b.external_id, 'la misma URL da el mismo id: reintentar actualiza, no duplica')
  assert.match(a.external_id, /^otracorredora\.cl:/)
})

test('lo que no es una ficha no se guarda como si lo fuera', () => {
  // Ni código interno ni precio = no hay ficha. Es el caso de un listado, de un
  // error del sitio o de una página que se pinta por JavaScript; guardarla
  // crearía una propiedad fantasma sin nada dentro.
  assert.equal(parseAgencyWebListing('<html><body><h1>Nuestras propiedades</h1></body></html>', 'https://x.cl/props'), null)
  assert.equal(parseAgencyWebListing('', 'https://x.cl/props'), null)
})

test('el texto de <script> no contamina la ficha', () => {
  // Sin quitar los scripts, un `var precio = 999999999` del JS de la página se
  // colaba como precio de la propiedad.
  const html = `<html><head><script>var config={precio:"CLP 999999999"}</script></head>
    <body><h1>Casa en venta</h1><div class="precio">UF 7.200</div>
    <ul><li>Código: AB-33</li></ul></body></html>`
  const l = parseAgencyWebListing(html, 'https://x.cl/p/33')
  assert.ok(l)
  assert.equal(l.price_uf, 7200)
  assert.equal(l.currency, 'UF')
})
