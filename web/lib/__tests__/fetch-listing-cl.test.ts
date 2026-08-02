// ¿La respuesta del portal es DE VERDAD la ficha que pedimos?
//
//   node --import tsx --test lib/__tests__/fetch-listing-cl.test.ts
//
// Portal Inmobiliario no bloquea con un 403: REDIRIGE A LA PORTADA y devuelve un
// 200 impecable. Comprobado en vivo desde una IP bloqueada — pedir
// MLC-4116163178, MLC-1600113565 y MLC-1949785199 devolvía las tres veces
// `https://www.portalinmobiliario.com/` con HTTP 200.
//
// Y la portada trae su propio blob `__NORDIC_RENDERING_CTX__`, que era justo lo
// único que se comprobaba ("tiene blob = es buena"). Así que se daba por ficha.
//
// El daño no era quedarse sin datos, era guardarlos MAL: el parser recoge
// cualquier imagen de mlstatic de la página, así que a la portada le sacaba ~60
// fotos DE OTROS ANUNCIOS —las tres fichas daban exactamente las mismas— y un
// `photos_total_count` de 119 que no es de nadie. Mejor un error visible que una
// ficha contaminada con datos ajenos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { esLaFicha } from '../captar-pipeline'

const URL_PEDIDA = 'https://www.portalinmobiliario.com/MLC-4116163178'

test('la portada del portal no se acepta como ficha', () => {
  // Con blob y todo: es lo que devuelve de verdad una IP bloqueada.
  const portada = '<html><script id="__NORDIC_RENDERING_CTX__">{...}</script></html>'
  assert.equal(esLaFicha(portada, URL_PEDIDA, 'https://www.portalinmobiliario.com/'), false)
  assert.equal(esLaFicha(portada, URL_PEDIDA, 'https://www.portalinmobiliario.com'), false)
})

test('una página de otro anuncio tampoco', () => {
  const otra = '<html><link rel="canonical" href="https://www.portalinmobiliario.com/MLC-9999999999"/></html>'
  assert.equal(esLaFicha(otra, URL_PEDIDA, 'https://www.portalinmobiliario.com/MLC-9999999999'), false)
})

test('la ficha pedida sí se acepta', () => {
  const ficha = `<html><link rel="canonical" href="${URL_PEDIDA}"/></html>`
  assert.equal(esLaFicha(ficha, URL_PEDIDA, URL_PEDIDA), true)
})

test('el id vale con guion y sin él', () => {
  // El portal lo escribe de las dos formas según el sitio del HTML.
  assert.equal(esLaFicha('<p>MLC4116163178</p>', URL_PEDIDA, URL_PEDIDA), true)
  assert.equal(esLaFicha('<p>MLC-4116163178</p>', URL_PEDIDA, URL_PEDIDA), true)
})

test('sin URL final se decide por el contenido', () => {
  // No todos los caminos saben la URL final; el id del HTML basta para decidir.
  assert.equal(esLaFicha('<p>MLC-4116163178</p>', URL_PEDIDA, null), true)
  assert.equal(esLaFicha('<p>otra cosa</p>', URL_PEDIDA, null), false)
})

test('una URL sin MLC-id no se rechaza por no encontrarlo', () => {
  // Webs propias de corredoras y similares: no hay id que comprobar.
  assert.equal(esLaFicha('<html>lo que sea</html>', 'https://corredora.cl/casa/123', 'https://corredora.cl/casa/123'), true)
})
