// Tests de la ingesta incremental por lotes de predios mapasui (0090).
//
// Correr:  node --test scraper/lib/sii-mapasui-ingest.test.mjs
//
// Contexto: la ingesta hacía un UPSERT por línea y releía el archivo entero en
// cada corrida. Con Las Condes en 340k predios eso tardaba >5 min en silencio y
// el túnel SSH del workflow se caía a la mitad ("Broken pipe", exit 255), así
// que el cron de respaldo llevaba días fallando. Lo que se verifica acá:
//   · solo se leen las líneas NUEVAS desde el checkpoint;
//   · una línea a medio escribir (sin \n) no se consume ni mueve el offset;
//   · el lote deduplica roles repetidos (Postgres aborta si un mismo INSERT
//     toca dos veces la misma fila con ON CONFLICT DO UPDATE);
//   · una línea corrupta no bloquea el avance del archivo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ingestMapasuiPrediosFile,
  buildPrediosUpsert,
  leerLineasCompletas,
  mapPredioRecord,
} from './sii-mapasui-cl.mjs'

const dir = mkdtempSync(join(tmpdir(), 'mapasui-'))

const predio = (rol, extra = {}) => JSON.stringify({
  comuna_id: 15108,
  rol_predio: rol,
  avaluo_total: 1000,
  latitud: -33.4,
  longitud: -70.5,
  direccion: `CALLE ${rol}`,
  ...extra,
})

/**
 * Fake mínimo de pg.Client: enruta por fragmentos estables del SQL sobre un
 * store en memoria y registra los INSERT de predios que se aplicaron.
 */
function fakeClient() {
  const estado = new Map()
  const upserts = []
  const transacciones = []
  return {
    estado, upserts, transacciones,
    async query(text, values = []) {
      const sql = typeof text === 'string' ? text : text.text
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) {
        transacciones.push(sql.trim())
        return { rows: [] }
      }
      if (sql.includes('to_regclass')) return { rows: [{ reg: 'sii_mapasui_ingest_state_cl' }] }
      if (sql.includes('FROM chile_comunas')) return { rows: [{ id: `comuna-${values[0]}` }] }
      if (sql.includes('FROM sii_mapasui_ingest_state_cl')) {
        const row = estado.get(values[0])
        return { rows: row ? [row] : [] }
      }
      if (sql.includes('INSERT INTO sii_mapasui_ingest_state_cl')) {
        estado.set(values[0], {
          byte_offset: values[1], file_size: values[2],
          lineas: values[3], predios: values[4], lineas_invalidas: values[5],
        })
        return { rows: [] }
      }
      if (sql.includes('INSERT INTO sii_mapasui_predios_cl')) {
        upserts.push(values)
        return { rows: [] }
      }
      throw new Error(`SQL inesperado: ${sql.slice(0, 80)}`)
    },
  }
}

test('leerLineasCompletas ignora la línea a medio escribir', async () => {
  const file = join(dir, 'parcial.jsonl')
  writeFileSync(file, 'uno\ndos\ntres-sin-salto')
  const leidas = []
  for await (const l of leerLineasCompletas(file, 0)) leidas.push(l)
  assert.deepEqual(leidas.map((l) => l.texto), ['uno', 'dos'])
  assert.equal(leidas.at(-1).offset, 8) // "uno\ndos\n"
})

test('leerLineasCompletas respeta el offset de arranque y los acentos', async () => {
  const file = join(dir, 'acentos.jsonl')
  writeFileSync(file, 'AVENIDA ÑUÑOA\nSEGUNDA\n')
  const primera = []
  for await (const l of leerLineasCompletas(file, 0)) primera.push(l)
  const desde = primera[0].offset
  const resto = []
  for await (const l of leerLineasCompletas(file, desde)) resto.push(l)
  assert.deepEqual(resto.map((l) => l.texto), ['SEGUNDA'])
})

test('buildPrediosUpsert deduplica el mismo rol dentro del lote', () => {
  const filas = [
    mapPredioRecord(JSON.parse(predio('1-1')), 'c1'),
    mapPredioRecord(JSON.parse(predio('1-2')), 'c1'),
    mapPredioRecord(JSON.parse(predio('1-1', { avaluo_total: 999 })), 'c1'),
  ]
  const upsert = buildPrediosUpsert(filas)
  assert.equal(upsert.filas, 2, 'dos roles distintos')
  assert.equal(upsert.values.length, 26, '2 filas × 13 columnas')
  // Gana la última aparición del rol repetido.
  assert.ok(upsert.values.includes(999))
  assert.ok(!upsert.values.includes(1000) || upsert.values.filter((v) => v === 1000).length === 1)
})

test('ingesta incremental: la segunda corrida solo lee lo nuevo', async () => {
  const file = join(dir, 'las_condes.jsonl')
  writeFileSync(file, `${predio('1-1')}\n${predio('1-2')}\n`)
  const client = fakeClient()

  const r1 = await ingestMapasuiPrediosFile({ filePath: file, client })
  assert.equal(r1.ok, true)
  assert.equal(r1.count, 2)
  assert.equal(client.upserts.length, 1, 'un solo INSERT por lote, no uno por línea')

  // Sin cambios en disco: no se relee nada, pero sí se toca el latido.
  const r2 = await ingestMapasuiPrediosFile({ filePath: file, client })
  assert.equal(r2.count, 0)
  assert.equal(r2.sinCambios, true)
  assert.equal(client.upserts.length, 1)

  // Llega una línea nueva + una a medio escribir.
  appendFileSync(file, `${predio('1-3')}\n${predio('1-4').slice(0, 20)}`)
  const r3 = await ingestMapasuiPrediosFile({ filePath: file, client })
  assert.equal(r3.count, 1, 'solo el predio nuevo completo')
  assert.equal(client.upserts.length, 2)

  // Al cerrarse la línea parcial, la corrida siguiente la recoge entera.
  appendFileSync(file, `${predio('1-4').slice(20)}\n`)
  const r4 = await ingestMapasuiPrediosFile({ filePath: file, client })
  assert.equal(r4.count, 1)
  assert.equal(client.estado.get('las_condes.jsonl').predios, 4)
})

test('una línea corrupta no bloquea el avance del archivo', async () => {
  const file = join(dir, 'corrupto.jsonl')
  writeFileSync(file, `${predio('2-1')}\n{roto\n${predio('2-2')}\n`)
  const client = fakeClient()
  const r = await ingestMapasuiPrediosFile({ filePath: file, client })
  assert.equal(r.ok, true)
  assert.equal(r.count, 2)
  assert.equal(r.invalidas, 1)
  assert.equal(client.estado.get('corrupto.jsonl').byte_offset, r.hastaOffset)
})

test('un archivo recortado (reset) se relee desde cero', async () => {
  const file = join(dir, 'reset.jsonl')
  writeFileSync(file, `${predio('3-1')}\n${predio('3-2')}\n${predio('3-3')}\n`)
  const client = fakeClient()
  await ingestMapasuiPrediosFile({ filePath: file, client })

  writeFileSync(file, `${predio('3-9')}\n`) // re-generado, más corto que el offset
  const r = await ingestMapasuiPrediosFile({ filePath: file, client })
  assert.equal(r.desdeOffset, 0, 'checkpoint inválido → relectura completa')
  assert.equal(r.count, 1)
  assert.equal(client.estado.get('reset.jsonl').predios, 1, 'los contadores se reinician')
})

test('--full ignora el checkpoint', async () => {
  const file = join(dir, 'full.jsonl')
  writeFileSync(file, `${predio('4-1')}\n`)
  const client = fakeClient()
  await ingestMapasuiPrediosFile({ filePath: file, client })
  const r = await ingestMapasuiPrediosFile({ filePath: file, client, full: true })
  assert.equal(r.count, 1)
  assert.equal(r.desdeOffset, 0)
})
