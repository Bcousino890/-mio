// Tests de la normalización contra el catálogo de SmartBC.
//
// Correr:  node --test scraper/lib/smartbc-catalogo-cl.test.mjs
//
// La regla que blindan: una comuna que no está en el catálogo NO viaja como
// texto libre — se registra en `faltantes` para reportarla. Es lo que pide el
// contrato ("no mandes texto libre en región y comuna") y lo prudente, porque
// `commune` es campo del equipo: un valor equivocado se queda en su ficha.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PASSTHROUGH,
  buildNormalizer,
  fetchCatalogo,
  fold,
  regionVariants,
  reportarFaltantes,
} from './catalogo.mjs'

// Forma del catálogo tal como lo devuelve la API tras el arreglo del equipo:
// las comunas traen `region` y `region_code`.
const CATALOGO = {
  regiones: [
    { name: 'Metropolitana', code: 'RM' },
    { name: 'Valparaíso', code: 'V' },
    { name: 'La Araucanía', code: 'IX' },
  ],
  comunas: [
    { name: 'Las Condes', region: 'Metropolitana', region_code: 'RM' },
    { name: 'Ñuñoa', region: 'Metropolitana', region_code: 'RM' },
    { name: 'Til Til', region: 'Metropolitana', region_code: 'RM' },
    { name: 'Zapallar', region: 'Valparaíso', region_code: 'V' },
  ],
  zonasPorComuna: new Map([['las condes', [{ name: 'El Golf' }, { name: 'Nueva Costanera' }]]]),
}

test('fold quita tildes, mayúsculas y espacios de más', () => {
  assert.equal(fold('  Ñuñoa  '), 'nunoa')
  assert.equal(fold('Región  Metropolitana'), 'region metropolitana')
  assert.equal(fold(null), '')
})

test('regionVariants prueba con y sin el prefijo "Región de"', () => {
  const v = regionVariants('Región de Valparaíso')
  assert.ok(v.includes('valparaiso'))
  const rm = regionVariants('Región Metropolitana de Santiago')
  assert.ok(rm.includes('metropolitana'), 'el sufijo "de Santiago" no puede impedir el match')
  const ar = regionVariants('Región de la Araucanía')
  assert.ok(ar.includes('araucania'))
})

test('nuestra región casa con la suya aunque se escriban distinto', () => {
  const n = buildNormalizer(CATALOGO)
  assert.equal(n.region('Región Metropolitana de Santiago'), 'Metropolitana')
  assert.equal(n.region('Región de Valparaíso'), 'Valparaíso')
  assert.equal(n.region('Región de la Araucanía'), 'La Araucanía')
  assert.equal(n.faltantes.regiones.size, 0)
})

test('la región también casa por código', () => {
  assert.equal(buildNormalizer(CATALOGO).region('RM'), 'Metropolitana')
})

test('la comuna casa ignorando tildes y mayúsculas, y devuelve la grafía del catálogo', () => {
  const n = buildNormalizer(CATALOGO)
  assert.equal(n.comuna('Ñuñoa'), 'Ñuñoa')
  assert.equal(n.comuna('nunoa'), 'Ñuñoa')
  assert.equal(n.comuna('LAS CONDES'), 'Las Condes')
  assert.equal(n.comuna('Til  Til'), 'Til Til')
})

test('"Til Til" casa con "Tiltil": las dos taxonomías parten el topónimo distinto', () => {
  // Única discrepancia real entre nuestras 56 comunas y sus 346, comprobado
  // contra el catálogo en vivo.
  const n = buildNormalizer(CATALOGO)
  assert.equal(n.comuna('Til Til'), 'Til Til')
  const conGrafiaOficial = buildNormalizer({
    ...CATALOGO,
    comunas: [{ name: 'Tiltil', region: 'Metropolitana' }],
  })
  assert.equal(conGrafiaOficial.comuna('Til Til'), 'Tiltil', 'se envía la grafía del catálogo')
  assert.equal(conGrafiaOficial.regionDeComuna('Til Til'), 'Metropolitana')
  assert.equal(conGrafiaOficial.faltantes.comunas.size, 0)
})

test('una comuna que no está en el catálogo NO viaja: se registra como faltante', () => {
  const n = buildNormalizer(CATALOGO)
  assert.equal(n.comuna('Comuna Inventada'), null)
  assert.deepEqual([...n.faltantes.comunas], ['Comuna Inventada'])
})

test('la región oficial sale de la comuna, no de nuestra taxonomía', () => {
  const n = buildNormalizer(CATALOGO)
  assert.equal(n.regionDeComuna('Zapallar'), 'Valparaíso')
  assert.equal(n.regionDeComuna('Las Condes'), 'Metropolitana')
  assert.equal(n.regionDeComuna('No Existe'), null)
})

test('la zona casa contra las de su comuna', () => {
  const n = buildNormalizer(CATALOGO)
  assert.equal(n.zona('Las Condes', 'el golf'), 'El Golf')
  assert.equal(n.zona('Las Condes', 'Barrio Inventado'), null)
  assert.deepEqual([...n.faltantes.zonas], ['Las Condes / Barrio Inventado'])
})

test('sin zonas descargadas para una comuna, la nuestra pasa en vez de borrarse', () => {
  const n = buildNormalizer(CATALOGO)
  assert.equal(n.zona('Zapallar', 'Cachagua'), 'Cachagua', 'no se puede afirmar que falte')
  assert.equal(n.faltantes.zonas.size, 0)
})

test('con el catálogo vacío nada viaja — no se cae de vuelta a texto libre', () => {
  const n = buildNormalizer({ regiones: [], comunas: [], zonasPorComuna: new Map() })
  assert.equal(n.comuna('Las Condes'), null)
  assert.equal(n.region('Región Metropolitana de Santiago'), null)
})

test('el normalizador neutro deja pasar todo (para tests)', () => {
  assert.equal(PASSTHROUGH.comuna('Cualquiera'), 'Cualquiera')
  assert.equal(PASSTHROUGH.zona('X', 'Y'), 'Y')
})

test('las zonas solo se piden para las comunas del lote, no para las 346', async () => {
  const pedidos = []
  const smartbc = {
    async catalogo(tipo, query = {}) {
      pedidos.push({ tipo, ...query })
      if (tipo === 'regiones') return { data: CATALOGO.regiones }
      if (tipo === 'comunas') return { data: CATALOGO.comunas }
      return { data: [{ name: 'El Golf' }] }
    },
  }
  await fetchCatalogo(smartbc, { comunasDeInteres: ['Las Condes', 'Vitacura'] })
  assert.equal(pedidos.filter((p) => p.tipo === 'zonas').length, 2)
  assert.equal(pedidos.length, 4, '2 catálogos + 2 comunas, no 346')
})

test('reportarFaltantes resume lo que hay que llevarle al equipo de SmartBC', () => {
  const n = buildNormalizer(CATALOGO)
  n.comuna('Inventada')
  n.zona('Las Condes', 'Barrio X')
  const lineas = reportarFaltantes(n.faltantes)
  assert.equal(lineas.length, 2)
  assert.match(lineas[0], /comunas sin correspondencia: Inventada/)
})
