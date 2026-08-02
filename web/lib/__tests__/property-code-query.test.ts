// Tests del buscador por código/URL de /chile/propiedades.
//
//   node --import tsx --test lib/__tests__/property-code-query.test.ts
//
// El caso que los motiva: el campo «Código de propiedad» solo entendía el
// MLC-id con su prefijo escrito. Pegar la URL del navegador funcionaba de
// casualidad (el MLC- aparece dentro), pero copiar el NÚMERO suelto del anuncio
// —"2107783039", que es lo que se pasa por WhatsApp— no encontraba nada y
// tampoco salía a buscarlo al portal, porque el número no se reconocía como id
// de anuncio.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePropertyCodeQuery, extractMlcId } from '../property-code-query'

const URL_LARGA = 'https://www.portalinmobiliario.com/MLC-2107783039-se-vende-gran-casa-familiar-en-condominio-sector-uddcumbres-_JM'

test('la URL pegada del navegador, con slug y sufijo _JM', () => {
  const q = parsePropertyCodeQuery(URL_LARGA)
  assert.equal(q.mlcId, 'MLC-2107783039')
  assert.equal(q.listingUrl, URL_LARGA)
  assert.equal(q.scrapeable, true)
  // Una URL no es un código interno: compararla contra property_code sobra.
  assert.deepEqual(q.codes, [])
})

test('la URL con tracking (?…, #…) apunta al mismo anuncio', () => {
  const conTracking = `${URL_LARGA}#position=3&search_layout=grid&type=item`
  assert.equal(parsePropertyCodeQuery(conTracking).mlcId, 'MLC-2107783039')
  assert.equal(parsePropertyCodeQuery(conTracking).listingUrl, URL_LARGA)

  const conQuery = `${URL_LARGA}?utm_source=whatsapp`
  assert.equal(parsePropertyCodeQuery(conQuery).listingUrl, URL_LARGA)
})

test('la URL pegada sin protocolo queda descargable', () => {
  const q = parsePropertyCodeQuery('www.portalinmobiliario.com/MLC-2107783039')
  assert.equal(q.mlcId, 'MLC-2107783039')
  assert.equal(q.listingUrl, 'https://www.portalinmobiliario.com/MLC-2107783039')
})

test('el número suelto del anuncio ES el anuncio', () => {
  const q = parsePropertyCodeQuery('2107783039')
  assert.equal(q.mlcId, 'MLC-2107783039')
  // Y además puede ser un código interno: se buscan las dos cosas, porque quien
  // escribe un número no tiene por qué saber en qué columna vive.
  assert.deepEqual(q.codes, ['2107783039'])
  assert.equal(q.scrapeable, true)
})

test('un código interno corto no se confunde con un anuncio', () => {
  const q = parsePropertyCodeQuery('5495')
  assert.equal(q.mlcId, null)
  assert.deepEqual(q.codes, ['5495'])
  // Y sobre todo: no manda a nadie a buscar al portal un anuncio inexistente.
  assert.equal(q.scrapeable, false)
})

test('mientras se teclea el número no se sale a buscar al portal', () => {
  // Estados intermedios de escribir "2107783039" dígito a dígito.
  assert.equal(parsePropertyCodeQuery('21077').scrapeable, false)
  assert.equal(parsePropertyCodeQuery('2107783').scrapeable, false)
  // Con 9 dígitos ya es un id completo plausible.
  assert.equal(parsePropertyCodeQuery('210778303').scrapeable, true)
})

test('el prefijo MLC se acepta con guión, sin guión y en minúsculas', () => {
  for (const texto of ['MLC-2107783039', 'MLC2107783039', 'mlc-2107783039']) {
    const q = parsePropertyCodeQuery(texto)
    assert.equal(q.mlcId, 'MLC-2107783039', texto)
    assert.equal(q.scrapeable, true, texto)
  }
  // Con el prefijo a medio escribir tampoco se sale a buscar al portal.
  assert.equal(parsePropertyCodeQuery('MLC-21').scrapeable, false)
})

test('el código interno del CRM se busca exacto y parcial', () => {
  const q = parsePropertyCodeQuery('PI-2607-21087')
  assert.equal(q.mlcId, null)
  assert.deepEqual(q.codes, ['PI-2607-21087'])
  assert.equal(q.likeText, 'PI-2607-21087')
  assert.equal(q.scrapeable, false)
})

test('la URL de la web propia de una corredora se busca por la URL guardada', () => {
  const q = parsePropertyCodeQuery('https://www.micorredora.cl/propiedad/123')
  assert.equal(q.mlcId, null)
  assert.equal(q.scrapeable, false)
  // Sin protocolo ni www.: la guardada puede escribir el mismo enlace de otra
  // forma y eso no debería esconder el anuncio.
  assert.equal(q.likeText, 'micorredora.cl/propiedad/123')
})

test('lo pegado desde otra app llega con basura alrededor y da igual', () => {
  assert.equal(parsePropertyCodeQuery('  MLC-2107783039  ').mlcId, 'MLC-2107783039')
  assert.equal(parsePropertyCodeQuery(`<${URL_LARGA}>`).mlcId, 'MLC-2107783039')
  assert.equal(parsePropertyCodeQuery('"PI-2607-21087"').codes[0], 'PI-2607-21087')
})

test('el texto vacío no busca nada (no devuelve la lista entera)', () => {
  const q = parsePropertyCodeQuery('   ')
  assert.equal(q.mlcId, null)
  assert.deepEqual(q.codes, [])
  assert.equal(q.likeText, null)
})

test('extractMlcId sigue resolviendo lo que ya resolvía, y más', () => {
  assert.equal(extractMlcId('MLC-2009525691'), 'MLC-2009525691')
  assert.equal(extractMlcId(URL_LARGA), 'MLC-2107783039')
  assert.equal(extractMlcId('2107783039'), 'MLC-2107783039')
  assert.equal(extractMlcId('PI-2607-21087'), null)
})
