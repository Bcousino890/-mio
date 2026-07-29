// Tests del enriquecimiento de la ficha de empresa de corredoras
// (enrich-corredora-contacto-cl.mjs · H4/H21).
//
// Correr:  node --test scraper/lib/enrich-corredora-contacto-cl.test.mjs
//
// Sin red ni base: el fetch se inyecta y el cliente de Postgres es un doble que
// registra las queries. Lo que se verifica es el CONTRATO del job — a dónde va,
// qué estado deja y qué NO pisa cuando algo falla.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  enrichCorredoraContacto,
  homeUrl,
  upsertPersonas,
} from './enrich-corredora-contacto-cl.mjs'

function fakeClient() {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      return { rows: [], rowCount: 1 }
    },
    /** Última query que contiene un fragmento. */
    find(fragment) {
      return calls.filter((c) => c.sql.includes(fragment)).pop() ?? null
    },
  }
}

const HTML_HOME = `<html><head></head><body>
  <a href="/contacto.aspx">Contacto</a>
  <a href="https://wa.me/56995377271">+569 9537 7271</a>
  <a href="mailto:info@finhabit.cl">info@finhabit.cl</a>
  <p>Somos una corredora con oficina en Av. Padre Hurtado Norte 1947, Vitacura.</p>
</body></html>`

const HTML_CONTACTO = `<html><body>
  <div class="card"><h4>Ana Urzúa Domínguez</h4><p>Gerente Comercial</p>
    <a href="mailto:aurzua@finhabit.cl">correo</a><a href="tel:+56995560112">fono</a></div>
</body></html>`

test('sin web propia registrada: marca no_web y no toca la red', async () => {
  const client = fakeClient()
  let fetched = 0
  const r = await enrichCorredoraContacto(
    client,
    { id: 'c1', name_raw: 'Sin Web Ltda.', web_propia_url: null },
    { fetch: async () => { fetched++; return { ok: true, html: HTML_HOME } } }
  )
  assert.equal(r.status, 'no_web')
  assert.equal(fetched, 0, 'no debe pedir nada a la red sin dominio')
  assert.equal(client.find('contact_status').params[1], 'no_web')
})

test('web con datos: guarda contacto, personas y las URLs de origen', async () => {
  const client = fakeClient()
  const visitadas = []
  const r = await enrichCorredoraContacto(
    client,
    { id: 'c1', name_normalized: 'finhabit propiedades', web_propia_url: 'https://www.finhabit.cl' },
    {
      fetch: async (url) => {
        visitadas.push(url)
        return { ok: true, html: url.includes('contacto') ? HTML_CONTACTO : HTML_HOME }
      },
      sleep: async () => {},
    }
  )

  assert.equal(r.ok, true)
  assert.equal(r.status, 'ok')
  assert.deepEqual(visitadas, ['https://www.finhabit.cl/', 'https://www.finhabit.cl/contacto.aspx'])

  // El teléfono de la ejecutiva también es un teléfono de la corredora: la
  // ficha suma los dos, no se queda solo con el de centralita.
  const update = client.find('contact_phones')
  assert.deepEqual(update.params[1], ['+56995377271', '+56995560112']) // contact_phones
  assert.deepEqual(update.params[2], ['+56995377271'])                 // contact_whatsapp (solo el declarado como wa.me)
  assert.deepEqual(update.params[3], ['info@finhabit.cl', 'aurzua@finhabit.cl'])
  assert.equal(update.params[6].length, 2)                             // contact_source_urls
  assert.equal(update.params[7], 'ok')                                 // contact_status

  const persona = client.find('INSERT INTO corredora_personas_cl')
  assert.equal(persona.params[1], 'Ana Urzúa Domínguez')
  assert.equal(persona.params[3], 'jefatura')
  assert.equal(persona.params[4], 'aurzua@finhabit.cl')
  assert.equal(persona.params[5], '+56995560112')
  assert.equal(r.people, 1)
})

test('web que responde sin datos de contacto: `empty`, no error', async () => {
  const client = fakeClient()
  const r = await enrichCorredoraContacto(
    client,
    { id: 'c1', web_propia_url: 'https://www.x.cl' },
    { fetch: async () => ({ ok: true, html: '<html><body><p>Bienvenidos</p></body></html>' }), sleep: async () => {} }
  )
  assert.equal(r.status, 'empty')
  assert.equal(client.find('contact_phones').params[7], 'empty')
})

test('web caída: marca error SIN borrar el contacto ya guardado', async () => {
  const client = fakeClient()
  const r = await enrichCorredoraContacto(
    client,
    { id: 'c1', web_propia_url: 'https://www.caida.cl' },
    { fetch: async () => ({ ok: false, reason: 'HTTP 503' }), sleep: async () => {} }
  )
  assert.equal(r.status, 'error')
  assert.equal(r.error, 'HTTP 503')
  // El UPDATE de error solo toca estado: si tocara contact_phones, un 503
  // pasajero vaciaría la ficha.
  const update = client.find('contact_status')
  assert.ok(!update.sql.includes('contact_phones'))
  assert.equal(update.params[2], 'HTTP 503')
})

test('una excepción del fetch tampoco propaga: queda registrada', async () => {
  const client = fakeClient()
  const r = await enrichCorredoraContacto(
    client,
    { id: 'c1', web_propia_url: 'https://www.x.cl' },
    { fetch: async () => { throw new Error('ECONNRESET') }, sleep: async () => {} }
  )
  assert.equal(r.status, 'error')
  assert.match(r.error, /ECONNRESET/)
})

test('respeta el delay entre páginas (crawl cortés, H22)', async () => {
  const client = fakeClient()
  let esperas = 0
  await enrichCorredoraContacto(
    client,
    { id: 'c1', web_propia_url: 'finhabit.cl' },
    {
      fetch: async () => ({ ok: true, html: HTML_HOME }),
      sleep: async () => { esperas++ },
    }
  )
  assert.equal(esperas, 1, 'una espera por cada página interna visitada')
})

test('homeUrl normaliza cualquier forma de guardar el dominio', () => {
  for (const raw of ['finhabit.cl', 'www.finhabit.cl', 'https://finhabit.cl/contacto', 'HTTPS://WWW.Finhabit.cl/']) {
    assert.equal(homeUrl(raw), 'https://www.finhabit.cl/')
  }
  assert.equal(homeUrl(null), null)
  assert.equal(homeUrl(''), null)
})

test('personas sin nombre no se insertan', async () => {
  const client = fakeClient()
  const n = await upsertPersonas(client, 'c1', [
    { full_name: '', role_kind: 'ejecutivo' },
    { full_name: 'Camila Valdés', role_kind: 'ejecutivo' },
    null,
  ])
  assert.equal(n, 1)
})
