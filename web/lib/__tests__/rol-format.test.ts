// Tests del formato canónico del Rol de Avalúo chileno.
//
//   node --import tsx --test lib/__tests__/rol-format.test.ts
//
// `normalizeClRol` tiene que decidir EXACTAMENTE lo mismo que la función SQL
// `normalizar_rol_cl` de la migración 0093: las dos deciden qué rol se guarda y
// qué rol se busca, y si discrepan vuelven los dos formatos conviviendo —que es
// lo que dejaba la dirección exacta vacía, hacía captar el mismo inmueble por
// duplicado y fallaba SIEMPRE la caché de certificados de TGR.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeClRol } from '../rol-format'

test('quita los ceros a la izquierda de los dos tramos', () => {
  // El rol del catastro gráfico (cadastre_parcels_cl) vs. el de sii_roles_cl.
  assert.equal(normalizeClRol('03810-00021'), '3810-21')
  assert.equal(normalizeClRol('02452-00014'), '2452-14')
  assert.equal(normalizeClRol('00700-00012'), '700-12')
})

test('un rol ya normalizado no cambia (la migración es idempotente)', () => {
  assert.equal(normalizeClRol('3810-21'), '3810-21')
  assert.equal(normalizeClRol('795-198'), '795-198')
})

test('los ceros que SÍ son el número se conservan', () => {
  assert.equal(normalizeClRol('00100-00000'), '100-0')
  assert.equal(normalizeClRol('0-0'), '0-0')
})

test('lo que no es "manzana-predio" numérico se devuelve intacto', () => {
  // rol_padre viene como "comuna-manzana-predio": tocarlo lo rompería.
  assert.equal(normalizeClRol('13114-0700-0012'), '13114-0700-0012')
  assert.equal(normalizeClRol('sin rol'), 'sin rol')
  assert.equal(normalizeClRol(''), '')
})

test('ignora los espacios de sobra', () => {
  assert.equal(normalizeClRol('  03810-00021  '), '3810-21')
})
