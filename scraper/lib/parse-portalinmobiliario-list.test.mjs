// Tests de regresión de parseListPage() / mapPolycard() (plan Anuncios CL · Fase 0 + H19).
//
// Correr:  node --test scraper/lib/parse-portalinmobiliario-list.test.mjs
//
// Fixtures: 2 polycards REALES capturados del HTML en vivo del listado de Las
// Condes (venta/casa), recortados a los campos que lee mapPolycard:
//   - una casa USADA (MLC-INDIVIDUAL_HOUSES_FOR_SALE)
//   - un PROYECTO nuevo (MLC-DEVELOPMENT_HOUSES_FOR_SALE, precio "Desde", rango de m²)
//
// Blindan el bug histórico que la Fase 0 destapó: el parser viejo troceaba por
// <li class="ui-search-layout__item"> del HTML (intervenciones, no resultados) y
// tomaba un id de FOTO ("891463-MLC110284448549_042026") como external_id, con
// precio/atributos siempre null. El listado real vive en el blob Nordic.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPolycard, parseListPage } from './parse-portalinmobiliario.mjs'

const USADA = {
  metadata: {
    id: 'MLC4205367480',
    url: 'portalinmobiliario.com/MLC-4205367480-casa-en-venta-de-4-dorm-en-las-condes-_JM',
    domain_id: 'MLC-INDIVIDUAL_HOUSES_FOR_SALE',
  },
  components: [
    { type: 'title', id: 'title', title: { text: 'Casa En Venta De 4 Dorm. En Las Condes' } },
    { type: 'seller', id: 'seller', seller: { text: 'Ascui Propiedades {icon_cockade}' } },
    { type: 'price', id: 'price', price: { current_price: { value: 10550, currency: 'CLF' } } },
    { type: 'attributes_list', id: 'attributes_list', attributes_list: { texts: ['4 dormitorios', '3 baños', '138 m² útiles'] } },
    { type: 'location', id: 'location', location: { text: 'Alejandro Fleming/ Parinacota, Parque Padre Alberto Hurtado, Las Condes' } },
  ],
}

const PROYECTO = {
  metadata: {
    id: 'MLC2950261510',
    url: 'portalinmobiliario.com/MLC-2950261510-reserva-san-francisco-_JM',
    domain_id: 'MLC-DEVELOPMENT_HOUSES_FOR_SALE',
  },
  components: [
    { type: 'title', id: 'title', title: { text: 'Reserva San Francisco' } },
    { type: 'seller', id: 'seller', seller: { text: 'Enaco {icon_cockade}' } },
    { type: 'price', id: 'price', price: { current_price: { value: 22220, currency: 'CLF' }, prefix: { text: 'Desde' } } },
    { type: 'attributes_list', id: 'attributes_list', attributes_list: { texts: ['5 dormitorios', '5 baños', '207 - 237 m² útiles'] } },
    { type: 'location', id: 'location', location: { text: 'La Portería 11811, Las Condes, Chile, San Carlos De Apoquindo, Las Condes' } },
  ],
}

// ── mapPolycard (puro) ───────────────────────────────────────────────────────

test('mapPolycard: casa usada extrae todos los campos correctos', () => {
  const r = mapPolycard(USADA)
  // El fix clave: external_id del anuncio, NO el id de la foto.
  assert.equal(r.external_id, 'MLC-4205367480')
  assert.equal(r.source_url, 'https://www.portalinmobiliario.com/MLC-4205367480-casa-en-venta-de-4-dorm-en-las-condes-_JM')
  assert.equal(r.title, 'Casa En Venta De 4 Dorm. En Las Condes')
  assert.equal(r.operation, 'sale')
  assert.equal(r.property_type, 'casa')
  assert.equal(r.is_development, false)
  assert.equal(r.price, 10550)
  assert.equal(r.currency, 'UF') // CLF → UF
  assert.equal(r.price_from, false)
  assert.equal(r.bedrooms, 4)
  assert.equal(r.bathrooms, 3)
  assert.equal(r.square_meters, 138)
  assert.equal(r.advertiser_name, 'Ascui Propiedades') // sin "{icon_cockade}"
  assert.equal(r.advertiser_type, 'unknown')
})

test('mapPolycard: proyecto se marca is_development y precio "Desde"', () => {
  const r = mapPolycard(PROYECTO)
  assert.equal(r.external_id, 'MLC-2950261510')
  assert.equal(r.is_development, true)
  assert.equal(r.price_from, true) // prefix "Desde"
  assert.equal(r.square_meters, 207) // rango "207 - 237" → primer número
  assert.equal(r.advertiser_name, 'Enaco')
})

test('mapPolycard: id ya con guion no se rompe', () => {
  const r = mapPolycard({ metadata: { id: 'MLC-123', domain_id: 'MLC-INDIVIDUAL_HOUSES_FOR_SALE' }, components: [] })
  assert.equal(r.external_id, 'MLC-123')
})

test('mapPolycard: sin id devuelve null (no direccionable)', () => {
  assert.equal(mapPolycard({ metadata: {}, components: [] }), null)
  assert.equal(mapPolycard({}), null)
  assert.equal(mapPolycard(null), null)
})

test('mapPolycard: sin url arma source_url desde external_id', () => {
  const r = mapPolycard({ metadata: { id: 'MLC999' }, components: [] })
  assert.equal(r.source_url, 'https://www.portalinmobiliario.com/MLC-999')
})

// ── parseListPage (blob Nordic completo) ─────────────────────────────────────

/** Envuelve un initialState en el HTML con el script del blob Nordic real. */
function wrapNordic(initialState) {
  const blob = { appProps: { pageProps: { initialState } } }
  return `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(blob)};self.__LOADABLE__=1</script></head><body></body></html>`
}

test('parseListPage: extrae solo POLYCARDs del blob, ignora intervenciones', () => {
  const html = wrapNordic({
    results: [
      { id: 'FACETED_SEARCH_INTERVENTION', type: 'FACETED_SEARCH_INTERVENTION', content: { state: 'VISIBLE' } },
      { id: 'POLYCARD', state: 'VISIBLE', polycard: USADA },
      { id: 'POLYCARD', state: 'VISIBLE', polycard: PROYECTO },
    ],
  })
  const res = parseListPage(html)
  assert.equal(res.length, 2) // la intervención NO cuenta
  assert.deepEqual(res.map((r) => r.external_id), ['MLC-4205367480', 'MLC-2950261510'])
})

test('parseListPage: sin blob devuelve [] (no lanza)', () => {
  assert.deepEqual(parseListPage('<html><body>no nordic here</body></html>'), [])
  assert.deepEqual(parseListPage(''), [])
  assert.deepEqual(parseListPage(null), [])
})

test('parseListPage: blob sin results devuelve []', () => {
  assert.deepEqual(parseListPage(wrapNordic({})), [])
})
