// Tests de la guarda de destino del scraping puntual.
//
//   node --import tsx --test lib/__tests__/scrape-url-guard.test.ts
//
// Buscar en /chile/propiedades pegando una URL hace que el SERVIDOR descargue
// esa dirección. Con una URL de una corredora es justo lo que se quiere; con
// `http://localhost:5432` o una IP de la red privada sería usar el buscador
// como ventana a la infraestructura interna. Aquí se fija dónde está la línea.
import test from 'node:test'
import assert from 'node:assert/strict'
import { esUrlPublica } from '../scrape-listing-cl'

test('las webs de corredoras sí se descargan', () => {
  assert.equal(esUrlPublica('https://www.magnoliaproperty.cl/propiedad/1024'), true)
  assert.equal(esUrlPublica('http://bpropiedades.cl/ficha.asp?id=58124'), true)
  assert.equal(esUrlPublica('https://www.portalinmobiliario.com/MLC-2107783039'), true)
})

test('la red local y el propio servidor, no', () => {
  for (const url of [
    'http://localhost:5432',
    'http://127.0.0.1/admin',
    'http://[::1]:3000',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.9/',
    'http://169.254.169.254/latest/meta-data/',  // metadatos de la nube
    'http://db.internal/',
    'http://impresora.local/',
    'http://intranet/',                          // sin punto: no es Internet
  ]) {
    assert.equal(esUrlPublica(url), false, url)
  }
})

test('lo que ni siquiera es una URL de web, tampoco', () => {
  assert.equal(esUrlPublica('file:///etc/passwd'), false)
  assert.equal(esUrlPublica('ftp://x.cl/a'), false)
  assert.equal(esUrlPublica('PI-2607-21087'), false)
  assert.equal(esUrlPublica(''), false)
})
