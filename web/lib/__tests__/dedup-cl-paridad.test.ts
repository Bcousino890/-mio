// La consolidación de property_cl vive DUPLICADA a propósito, y este test es lo
// que impide que las dos copias se separen sin que nadie se entere.
//
//   node --import tsx --test lib/__tests__/dedup-cl-paridad.test.ts
//
// POR QUÉ ESTÁ DUPLICADA (y por qué no se puede unificar sin más): el worker
// 24/7 de Chile se construye con `context: ../scraper` y su Dockerfile hace
// `COPY lib ./lib` (infra/docker-compose.yml + scraper/Dockerfile). Dentro de
// ese contexto de build `web/` NO EXISTE, así que si scraper/lib/dedup-cl.mjs
// importara de ../../web/lib/... el worker se caería al arrancar en producción.
// (El caso de web/lib/smartbc/ es distinto: lo importa scraper/sync-smartbc-cl.mjs,
// un CLI que se ejecuta desde el checkout del VPS, no desde ese contenedor.)
//
// Con la duplicación aceptada, el riesgo real es que una copia se arregle y la
// otra no: el bug se "arregla" al re-scrapear desde la ficha y vuelve en el
// siguiente barrido del worker. Estos tests convierten esa divergencia
// silenciosa en un fallo ruidoso.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { consolidateFields as consolidateTs, type ConsolidationRow } from '../dedup-cl'
// @ts-expect-error — módulo .mjs sin tipos: es justo la copia que se compara.
import { consolidateFields as consolidateMjs } from '../../../scraper/lib/dedup-cl.mjs'

const RUTA_TS = fileURLToPath(new URL('../dedup-cl.ts', import.meta.url))
const RUTA_MJS = fileURLToPath(new URL('../../../scraper/lib/dedup-cl.mjs', import.meta.url))

/** El UPDATE de refreshPropertyClAggregates, sin espacios de sobra. */
function sqlDeRefresh(ruta: string): string {
  const fuente = readFileSync(ruta, 'utf8')
  const m = fuente.match(/UPDATE property_cl SET\s+operation = \$2[\s\S]*?WHERE id = \$1/)
  assert.ok(m, `no se encontró el UPDATE de refreshPropertyClAggregates en ${ruta}`)
  return m[0].replace(/\s+/g, ' ').trim()
}

const anuncio = (over: Partial<ConsolidationRow> = {}): ConsolidationRow => ({
  id: 'l1', external_id: 'MLC-1', property_cl_id: null, operation: 'sale', property_type: 'casa',
  price: 500_000_000, price_uf: 31_500, uf_rate: 39_000, uf_rate_date: '2026-07-01',
  square_meters: 366, bedrooms: 5, bathrooms: 4, comuna_id: 'c1', localidad: null,
  latitude: -33.36, longitude: -70.51, location_confidence: 'none', exact_address: null,
  portal: 'portalinmobiliario', source_type: 'portal', advertiser_type: 'professional',
  advertiser_id: 'adv1', is_active: true,
  first_seen_at: '2026-04-01T00:00:00.000Z', last_seen_at: '2026-07-01T00:00:00.000Z',
  portal_first_seen_at: '2026-04-01T00:00:00.000Z',
  ...over,
})

const CASOS: Array<[string, ConsolidationRow[]]> = [
  ['un solo anuncio', [anuncio()]],
  ['dos corredoras, gana el precio más bajo', [
    anuncio({ id: 'a', advertiser_id: 'adv1', price: 600_000_000 }),
    anuncio({ id: 'b', advertiser_id: 'adv2', price: 500_000_000 }),
  ]],
  ['el precio sale de los ACTIVOS aunque el de baja sea menor', [
    anuncio({ id: 'a', price: 400_000_000, is_active: false }),
    anuncio({ id: 'b', price: 600_000_000, is_active: true }),
  ]],
  ['manda la ubicación de mayor confianza', [
    anuncio({ id: 'a', location_confidence: 'none', comuna_id: 'c1', exact_address: null }),
    anuncio({ id: 'b', location_confidence: 'confirmed', comuna_id: 'c2', exact_address: 'AV APOQUINDO 1234' }),
  ]],
  ['moda de m²/dormitorios, con empate al más reciente', [
    anuncio({ id: 'a', square_meters: 300, last_seen_at: '2026-07-01T00:00:00.000Z' }),
    anuncio({ id: 'b', square_meters: 400, last_seen_at: '2026-07-05T00:00:00.000Z' }),
  ]],
  ['antigüedad = la del primero que salió al mercado', [
    anuncio({ id: 'a', portal_first_seen_at: '2026-05-01T00:00:00.000Z' }),
    anuncio({ id: 'b', portal_first_seen_at: '2026-02-01T00:00:00.000Z' }),
    anuncio({ id: 'c', portal_first_seen_at: null }),
  ]],
  ['campos ausentes en todos los anuncios', [
    anuncio({ price: null, price_uf: null, square_meters: null, comuna_id: null, operation: null }),
  ]],
]

for (const [nombre, filas] of CASOS) {
  test(`consolidación idéntica en web y scraper — ${nombre}`, () => {
    assert.deepEqual(
      consolidateTs(filas),
      consolidateMjs(filas),
      'web/lib/dedup-cl.ts y scraper/lib/dedup-cl.mjs consolidan distinto: si tocas uno, toca el otro',
    )
  })
}

test('el UPDATE de agregados es el mismo en las dos copias', () => {
  assert.equal(
    sqlDeRefresh(RUTA_TS),
    sqlDeRefresh(RUTA_MJS),
    'refreshPropertyClAggregates escribe distinto en web y en el worker: si tocas uno, toca el otro',
  )
})

test('el refresco no degrada un pin puesto a mano ni la dirección del SII', () => {
  // Lo que se perdía al captar: el barrido siguiente devolvía la ficha a "sin
  // confirmar" y borraba la dirección exacta y la comuna.
  const sql = sqlDeRefresh(RUTA_TS)
  assert.match(sql, /location_confidence = CASE WHEN manual_pin_set_at IS NOT NULL THEN 'confirmed'/)
  assert.match(sql, /exact_address = CASE WHEN rol_matriz IS NOT NULL THEN COALESCE\(exact_address/)
  assert.match(sql, /comuna_id = COALESCE\(\$11::uuid, comuna_id\)/)
})
