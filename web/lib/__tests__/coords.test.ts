// Tests de la normalización de coordenadas.
//
//   node --import tsx --test lib/__tests__/coords.test.ts
//
// El caso que los motiva: `property_cl.manual_latitude/manual_longitude` son
// columnas `numeric` y el driver de Postgres las devuelve como STRING. La ficha
// hacía `manualPin.latitude.toFixed(5)` y eso no es un error cosmético — lanza
// en pleno render, y sin límite de error se lleva por delante la aplicación
// entera ("Application error: a client-side exception has occurred"). Pasaba al
// abrir CUALQUIER propiedad con pin guardado, o sea cualquiera ya captada.
import test from 'node:test'
import assert from 'node:assert/strict'
import { toLatLng, toNum } from '../coords'

test('un numeric que llega como string sigue siendo un número', () => {
  assert.equal(toNum('-33.36000000'), -33.36)
  assert.equal(toNum('0'), 0)
  assert.equal(toNum(-70.51), -70.51)
})

test('lo que no es una coordenada es null, no NaN', () => {
  assert.equal(toNum(null), null)
  assert.equal(toNum(undefined), null)
  assert.equal(toNum(''), null)
  assert.equal(toNum('sin dato'), null)
  assert.equal(toNum(Infinity), null)
})

test('el par se puede usar como números: .toFixed() no revienta', () => {
  const pin = toLatLng('-33.36000000', '-70.51000000')
  assert.ok(pin)
  assert.equal(pin.latitude.toFixed(5), '-33.36000')
  assert.equal(pin.longitude.toFixed(5), '-70.51000')
})

test('si falta una de las dos coordenadas no hay pin', () => {
  assert.equal(toLatLng('-33.36', null), null)
  assert.equal(toLatLng(null, '-70.51'), null)
  assert.equal(toLatLng(null, null), null)
})

test('el 0 es una coordenada válida, no un hueco', () => {
  assert.deepEqual(toLatLng(0, 0), { latitude: 0, longitude: 0 })
})
