// Tests del mapeo captaciones_cl → contrato de SmartBC (smartbc-mapper.mjs).
//
// Correr:  node --test scraper/lib/smartbc-mapper.test.mjs
//
// Cubren las reglas que no se pueden romper sin corromper el CRM del equipo:
//   · `owner.confirmed` NUNCA se envía ("confirmada" significa cosas distintas
//     a cada lado del contrato).
//   · el precio viaja en la moneda EN QUE SE PUBLICÓ (UF o CLP), nunca la
//     conversión con la etiqueta de la otra.
//   · ningún campo fuera del contrato (`additionalProperties: false`) y ningún
//     valor de enum inventado.
//   · el diff manda solo lo que cambió — el criterio de aceptación nº 4.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCaptacionPayload,
  buildContacts,
  buildFeatures,
  buildListings,
  buildNotes,
  buildPhotos,
  buildPriceDiscrepancyNote,
  buildProvenanceNote,
  buildSurfaceDiscrepancyNote,
  diffPayload,
  externalIdFor,
  FORCEABLE_TEAM_FIELDS,
  isEmptyPatch,
  mapContactType,
  mapOperation,
  mapPropertyType,
  payloadHash,
  pickPrice,
  publicationNumber,
  sortPhones,
  splitRelaciones,
} from './mapper.mjs'

// Campos admitidos por el schema `Captacion` del OpenAPI de SmartBC. El schema
// es additionalProperties:false, así que cualquier clave fuera de esta lista es
// un 400 validation_error, no un aviso.
const CAMPOS_CONTRATO = new Set([
  'external_id', 'title', 'description', 'operation', 'price', 'currency', 'bedrooms',
  'bathrooms', 'square_meters', 'useful_square_meters', 'property_type', 'features',
  'source_url', 'source_site', 'cover_photo_url', 'broker_name', 'external_reference',
  'portal_publication_number', 'published_ago', 'region', 'commune', 'zone', 'subzone',
  'address_scraped', 'address_real', 'address_verified', 'latitude', 'longitude',
  'rol_propiedad', 'owner', 'notes', 'revision_notes', 'next_action_at',
  'next_action_note', 'contacts', 'photos', 'listings', 'attempts', 'pipeline',
  'stage', 'assigned_to_email', 'options', 'metadata',
])
const CAMPOS_AVISO = new Set([
  'external_id', 'source_url', 'source_site', 'broker_name', 'external_reference',
  'title', 'description', 'price', 'currency', 'bedrooms', 'bathrooms', 'square_meters',
  'useful_square_meters', 'region', 'commune', 'zone', 'address_scraped', 'latitude',
  'longitude', 'cover_photo_url', 'photo_urls', 'features', 'operation',
  'portal_publication_number', 'published_ago', 'broker_website_url', 'broker_price',
  'broker_currency', 'broker_scraped_at', 'broker_scrape_error', 'scrape_status',
  'scrape_error',
])
const CAMPOS_CONTACTO = new Set([
  'external_id', 'contact_type', 'contact_name', 'phone', 'email', 'has_whatsapp',
  'relationship', 'rut', 'extra_phones',
])

const CAP_ID = '11111111-1111-1111-1111-111111111111'

const CAPTACION = {
  id: CAP_ID,
  source_url: 'https://www.portalinmobiliario.com/MLC-999',
  listing_cl_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  property_cl_id: 'pppppppp-0000-0000-0000-000000000001',
  title: 'Casa mediterránea en Las Condes',
  operation: 'sale',
  property_type: 'casa',
  price_raw: 450000000,
  currency: 'CLP',
  sqm: 320,
  bedrooms: 4,
  bathrooms: 3,
  address: 'Av. Apoquindo 1234',
  comuna_label: 'Las Condes',
  sii_comuna_code: '15108',
  latitude: -33.4089,
  longitude: -70.5673,
  photos: ['https://cdn.portal.cl/1.jpg', 'https://cdn.portal.cl/2.jpg'],
  selected_photo_urls: ['https://cdn.portal.cl/2.jpg'],
  raw_extracted: { sqm_construida: 265, has_pool: true, parking: 2, storage: 1, description: 'Casa con jardín' },
  sii_rol: '795-198',
  sii_direccion: 'AV APOQUINDO 1234',
  match_score: 0.97,
  match_confidence: 'confirmed',
  match_verified: true,
  tgr_status: 'ok',
  dealernet_status: 'ok',
  owner_name: 'María Pérez',
  owner_rut: '12345678-9',
  phones: [
    { numero: '+56912345678', tipo: 'movil', categoria: 'probable', whatsapp: true, calidad: 9, ranking: 1 },
    { numero: '+56987654321', tipo: 'fijo', categoria: 'alternativo', whatsapp: false, calidad: 4, ranking: 2 },
    { numero: '+56911112222', tipo: 'movil', categoria: 'probable', whatsapp: true, calidad: 8, relacion: 'Cónyuge' },
  ],
  emails: [{ email: 'maria@ejemplo.cl', categoria: 'probable' }],
  relacionados: [
    { rut: '9876543', dv: '2', nombre: 'Juan Soto', relacion: 'Cónyuge' },
    { rut: '5555555', dv: '5', nombre: 'Ana Soto', relacion: 'Hija' },   // sin teléfono
  ],
  stage: 'contact_found',
  needs_review: false,
}

const LISTING_PORTAL = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  portal: 'portalinmobiliario',
  source_type: 'portal',
  external_id: 'MLC-3914632576',
  source_url: 'https://www.portalinmobiliario.com/MLC-999',
  operation: 'sale',
  advertiser_name: 'Corredora X',
  advertiser_id: 'seller-1',
  corredora_id: 'cccccccc-0000-0000-0000-000000000001',
  corredora_name: 'Corredora X',
  price: 460000000,
  price_uf: null,
  currency: 'CLP',
  bedrooms: 4,
  bathrooms: 3,
  square_meters: 320,
  localidad: 'El Golf',
  address: 'Av. Apoquindo 1234',
  latitude: -33.4089,
  longitude: -70.5673,
  description: 'Casa de 4 dormitorios',
  features: ['Jardín'],
  photos: ['https://cdn.portal.cl/1.jpg'],
  stored_photos: [{ original_url: 'https://cdn.portal.cl/1.jpg', bucket_url: 'https://bucket.mio.cl/a1.jpg' }],
  seller_reference: 'CX-4412',
  status: 'active',
  property_cl_id: 'pppppppp-0000-0000-0000-000000000001',
  comuna_name: 'Las Condes',
  comuna_region: 'Región Metropolitana de Santiago',
}

const BUNDLE = {
  captacion: CAPTACION,
  comuna: { name: 'Las Condes', region: 'Región Metropolitana de Santiago' },
  property: { localidad: 'El Golf' },
  listings: [LISTING_PORTAL],
}

// ─── Enumeraciones ───────────────────────────────────────────────────────────

test('operación: sale/rent → venta/arriendo', () => {
  assert.equal(mapOperation('sale'), 'venta')
  assert.equal(mapOperation('rent'), 'arriendo')
  assert.equal(mapOperation(null), null)
})

test('tipo de propiedad: lo conocido mapea, lo demás cae a other (no se inventa)', () => {
  assert.equal(mapPropertyType('casa'), 'house')
  assert.equal(mapPropertyType('Departamento'), 'apartment')
  assert.equal(mapPropertyType('parcela'), 'land')
  assert.equal(mapPropertyType('oficina'), 'office')
  assert.equal(mapPropertyType('local comercial'), 'commercial')
  assert.equal(mapPropertyType('agrícola'), 'land', 'con acento también')
  assert.equal(mapPropertyType('estacionamiento'), 'other')
  assert.equal(mapPropertyType(null), null)
})

test('parentesco → contact_type', () => {
  assert.equal(mapContactType('Cónyuge'), 'spouse')
  assert.equal(mapContactType('conyuge'), 'spouse')
  assert.equal(mapContactType('Conviviente Civil'), 'spouse')
  assert.equal(mapContactType('Hija'), 'family')
  assert.equal(mapContactType('Suegra'), 'family')
  assert.equal(mapContactType('Empleador'), 'other')
  assert.equal(mapContactType(null), 'other')
})

test('"Titular" es el dueño, no "otro" contacto', () => {
  // DealerNet no siempre deja el campo vacío para el número del propio
  // dueño: a veces lo etiqueta "Titular" (o "Titular, Sociedad"). Antes esto
  // caía a `other` y en la ficha de SmartBC se veía "OTRO" junto al dueño.
  assert.equal(mapContactType('Titular'), 'owner')
  assert.equal(mapContactType('Titular, Sociedad'), 'owner')
})

// ─── Precio ──────────────────────────────────────────────────────────────────

test('precio en UF viaja como UF, no como su conversión a CLP', () => {
  assert.deepEqual(
    pickPrice({ price: 450000000, price_uf: 12000, currency: 'UF' }),
    { price: 12000, currency: 'uf' },
  )
})

test('precio en CLP viaja como CLP', () => {
  assert.deepEqual(
    pickPrice({ price: 450000000, price_uf: null, currency: 'CLP' }),
    { price: 450000000, currency: 'clp' },
  )
})

test('sin precio no se inventa un cero', () => {
  assert.deepEqual(pickPrice({ price: null, price_uf: null, currency: null }), { price: null, currency: null })
})

test('un precio guardado como 0 se trata como si no hubiera precio', () => {
  // Caso real: el precio llegó a la ficha de SmartBC como "$0.0M". Ninguna
  // propiedad se publica gratis -- un 0 es un dato que no se pudo extraer, no
  // un precio real, así que no debe viajar tal cual.
  assert.deepEqual(pickPrice({ price: 0, price_uf: null, currency: 'CLP' }), { price: null, currency: null })
  assert.deepEqual(pickPrice({ price: 0, price_uf: 0, currency: 'UF' }), { price: null, currency: null })
  // Con un valor real en la otra moneda, ese sí viaja.
  assert.deepEqual(pickPrice({ price: 0, price_uf: 12000, currency: 'UF' }), { price: 12000, currency: 'uf' })
})

test('UF sin valor UF cae al CLP disponible en vez de mandar null', () => {
  assert.deepEqual(pickPrice({ price: 9000, price_uf: null, currency: 'UF' }), { price: 9000, currency: 'clp' })
})

// ─── Contactos ───────────────────────────────────────────────────────────────

test('teléfonos: probable antes que alternativo, y a igualdad manda la calidad', () => {
  const orden = sortPhones([
    { numero: 'c', categoria: 'laboral', calidad: 9 },
    { numero: 'b', categoria: 'probable', calidad: 5 },
    { numero: 'a', categoria: 'probable', calidad: 8 },
  ]).map((p) => p.numero)
  assert.deepEqual(orden, ['a', 'b', 'c'])
})

test('el titular lleva su mejor teléfono y el resto como extra_phones', () => {
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: '12345678-9',
    phones: CAPTACION.phones,
    emails: CAPTACION.emails,
    relacionados: [],
  })
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].contact_type, 'owner')
  assert.equal(contacts[0].phone, '+56912345678')
  assert.equal(contacts[0].has_whatsapp, true)
  assert.equal(contacts[0].rut, '12345678-9')
  assert.equal(contacts[0].email, 'maria@ejemplo.cl')
  assert.deepEqual(contacts[0].extra_phones.map((p) => p.phone), ['+56987654321'])
})

test('un relacionado CON teléfono se envía; uno SIN teléfono no', () => {
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: '12345678-9',
    phones: CAPTACION.phones,
    emails: [],
    relacionados: CAPTACION.relacionados,
  })
  assert.equal(contacts.length, 2, 'titular + cónyuge; la hija sin teléfono no viaja')
  const conyuge = contacts[1]
  assert.equal(conyuge.contact_type, 'spouse')
  assert.equal(conyuge.contact_name, 'Juan Soto')
  assert.equal(conyuge.phone, '+56911112222')
  assert.equal(conyuge.relationship, 'Cónyuge', 'el parentesco original se conserva')
  assert.equal(conyuge.rut, '9876543-2')
})

test('el titular no se duplica cuando DealerNet lo lista también como "relacionado"', () => {
  // Caso real: la tabla de relacionados trae una fila "Titular" (mismo RUT
  // que ownerRut) y un teléfono etiquetado "Titular, Sociedad" en vez de venir
  // sin parentesco. Antes esto generaba UN contacto de más -- el mismo dueño,
  // dos veces, la segunda como `other`.
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: '12345678-9',
    phones: [
      { numero: '+56999990000', categoria: 'probable', calidad: 9, relacion: 'Titular, Sociedad' },
    ],
    emails: [],
    relacionados: [
      { rut: '12345678', dv: '9', nombre: 'María Pérez', relacion: 'Titular' },
      { rut: '76000000', dv: '1', nombre: 'Inversiones X Spa', relacion: 'Sociedad' },
    ],
  })
  const deLaTitular = contacts.filter((c) => c.rut === '12345678-9')
  assert.equal(deLaTitular.length, 1, 'María Pérez aparece una sola vez')
  assert.equal(deLaTitular[0].contact_type, 'owner')
})

test('el teléfono de un relacionado no se le atribuye al titular', () => {
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: null,
    phones: CAPTACION.phones,
    emails: [],
    relacionados: CAPTACION.relacionados,
  })
  const extras = contacts[0].extra_phones.map((p) => p.phone)
  assert.ok(!extras.includes('+56911112222'), 'el móvil del cónyuge no es del titular')
})

test('con decenas de relacionados no se supera el tope de 20 contactos', () => {
  const phones = []
  const relacionados = []
  for (let i = 0; i < 40; i++) {
    relacionados.push({ rut: `${1000000 + i}`, dv: '1', nombre: `Pariente ${i}`, relacion: `Primo${i}` })
    phones.push({ numero: `+5691000${i}`, categoria: 'probable', calidad: 5, relacion: `Primo${i}` })
  }
  const contacts = buildContacts({
    captacionId: CAP_ID, ownerName: 'X', ownerRut: null, phones, emails: [], relacionados,
  })
  assert.equal(contacts.length, 20)
})

// ─── Parentescos múltiples ───────────────────────────────────────────────────

test('un teléfono compartido lista todas sus relaciones, en orden', () => {
  // Caso real de una ficha de Las Condes: un número que usan tres personas.
  assert.deepEqual(splitRelaciones('Conyuge, Hija, Suegra'), ['Conyuge', 'Hija', 'Suegra'])
  assert.deepEqual(splitRelaciones('Cuñada (Por Conyuge)'), ['Cuñada (Por Conyuge)'])
  assert.deepEqual(splitRelaciones('Relación directa con Padre, Madre'), ['Padre', 'Madre'])
  assert.deepEqual(splitRelaciones(null), [])
})

test('un relacionado reclama el teléfono aunque lo comparta con otros', () => {
  // Antes se comparaba la cadena entera: "Conyuge, Hija, Suegra" nunca casaba
  // con "Conyuge" y el cónyuge se quedaba sin contacto pese a tener número.
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: '12345678-9',
    phones: [
      { numero: '+56912345678', categoria: 'probable', calidad: 9 },
      { numero: '+56995423111', categoria: 'probable', calidad: 8, relacion: 'Conyuge, Hija, Suegra' },
    ],
    emails: [],
    relacionados: [
      { rut: '9876543', dv: '2', nombre: 'Juan Soto', relacion: 'Conyuge' },
      { rut: '5555555', dv: '5', nombre: 'Ana Soto', relacion: 'Hija' },
    ],
  })
  const nombres = contacts.map((c) => c.contact_name)
  assert.ok(nombres.includes('Juan Soto'), 'el cónyuge entra con su nombre')
  assert.ok(nombres.includes('Ana Soto'), 'y la hija también, del mismo número')
})

// ─── Selección manual de contactos ───────────────────────────────────────────

test('con selección manual viajan SOLO los teléfonos elegidos', () => {
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: '12345678-9',
    phones: CAPTACION.phones,
    emails: [],
    relacionados: CAPTACION.relacionados,
    seleccion: [{ phone: '+56912345678', name: 'María Pérez', is_owner: true }],
  })
  assert.equal(contacts.length, 1, 'los otros 2 teléfonos no viajan')
  assert.equal(contacts[0].phone, '+56912345678')
  assert.equal(contacts[0].contact_type, 'owner')
  assert.equal(contacts[0].rut, '12345678-9')
})

test('una selección elegida ANTES de este fix igual reconoce al titular', () => {
  // `is_owner` se calculaba antes como "el teléfono no trae parentesco" — no
  // cubría el caso real de un número que DealerNet etiqueta "Titular"
  // explícitamente. Las selecciones YA GUARDADAS con ese cálculo viejo no
  // tienen `is_owner: true` para ese número: el mapper debe reconocer al
  // titular igual, por su RUT o por la relación elegida en el picker, sin
  // depender de haber vuelto a guardar la selección.
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: '12345678-9',
    phones: CAPTACION.phones,
    emails: [],
    relacionados: [],
    seleccion: [
      // Ni is_owner ni contact_type: así quedó guardado antes del fix.
      { phone: '+56912345678', name: 'María Pérez', relationship: 'Titular', rut: '12345678-9' },
    ],
  })
  assert.equal(contacts[0].contact_type, 'owner')
  assert.equal(contacts[0].relationship, null, 'el titular no lleva "relationship": es el dueño, no un pariente')
})

test('el nombre elegido a mano gana al que devuelve TGR', () => {
  // TGR da el nombre legal; el equipo pone el que la persona usa de verdad.
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'MARIA DEL CARMEN PEREZ SOTO',
    ownerRut: '12345678-9',
    phones: CAPTACION.phones,
    emails: [],
    relacionados: [],
    seleccion: [{ phone: '+56912345678', name: 'María Pérez', is_owner: true }],
  })
  assert.equal(contacts[0].contact_name, 'María Pérez')
})

test('varios teléfonos de la misma persona se agrupan, no se repite el contacto', () => {
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: '12345678-9',
    phones: CAPTACION.phones,
    emails: [],
    relacionados: [],
    seleccion: [
      { phone: '+56912345678', name: 'María Pérez', is_owner: true, has_whatsapp: true },
      { phone: '+56987654321', name: 'María Pérez', is_owner: true, label: 'Oficina' },
    ],
  })
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].phone, '+56912345678')
  assert.deepEqual(contacts[0].extra_phones.map((p) => p.phone), ['+56987654321'])
})

test('un relacionado elegido viaja con su nombre y su parentesco', () => {
  const contacts = buildContacts({
    captacionId: CAP_ID,
    ownerName: 'María Pérez',
    ownerRut: '12345678-9',
    phones: CAPTACION.phones,
    emails: [],
    relacionados: CAPTACION.relacionados,
    seleccion: [
      { phone: '+56912345678', name: 'María Pérez', is_owner: true },
      { phone: '+56911112222', name: 'Juan Soto', relationship: 'Cónyuge', rut: '9876543-2' },
    ],
  })
  assert.equal(contacts.length, 2)
  assert.equal(contacts[1].contact_name, 'Juan Soto')
  assert.equal(contacts[1].contact_type, 'spouse', 'deducido del parentesco')
  assert.equal(contacts[1].relationship, 'Cónyuge')
  assert.equal(contacts[1].rut, '9876543-2')
})

test('sin selección se mantiene el comportamiento automático de siempre', () => {
  const auto = buildContacts({
    captacionId: CAP_ID, ownerName: 'María Pérez', ownerRut: '12345678-9',
    phones: CAPTACION.phones, emails: [], relacionados: CAPTACION.relacionados,
  })
  const conNull = buildContacts({
    captacionId: CAP_ID, ownerName: 'María Pérez', ownerRut: '12345678-9',
    phones: CAPTACION.phones, emails: [], relacionados: CAPTACION.relacionados,
    seleccion: null,
  })
  assert.deepEqual(conNull, auto)
  assert.equal(auto.length, 2, 'titular + cónyuge, como antes')
})

test('la selección guardada en la captación llega al payload', () => {
  const payload = buildCaptacionPayload({
    ...BUNDLE,
    captacion: {
      ...CAPTACION,
      smartbc_contactos: [{ phone: '+56987654321', name: 'Solo este', is_owner: true }],
    },
  })
  assert.equal(payload.contacts.length, 1)
  assert.equal(payload.contacts[0].phone, '+56987654321')
  assert.equal(payload.owner.phone, '+56987654321', 'owner.phone sale del contacto elegido')
})

// ─── Fotos ───────────────────────────────────────────────────────────────────

test('se prefiere la foto re-alojada en el bucket sobre la URL del portal', () => {
  const items = buildPhotos({
    photos: ['https://cdn.portal.cl/1.jpg', 'https://cdn.portal.cl/2.jpg'],
    storedPhotos: [{ original_url: 'https://cdn.portal.cl/1.jpg', bucket_url: 'https://bucket.mio.cl/a1.jpg' }],
    selectedPhotoUrls: [],
  })
  assert.deepEqual(items.map((i) => i.url), ['https://bucket.mio.cl/a1.jpg', 'https://cdn.portal.cl/2.jpg'])
  assert.deepEqual(items.map((i) => i.position), [0, 1])
})

test('la foto elegida a mano manda como portada pero no recorta la galería', () => {
  const items = buildPhotos({
    photos: ['https://cdn.portal.cl/1.jpg', 'https://cdn.portal.cl/2.jpg', 'https://cdn.portal.cl/3.jpg'],
    storedPhotos: [],
    selectedPhotoUrls: ['https://cdn.portal.cl/3.jpg'],
  })
  assert.equal(items[0].url, 'https://cdn.portal.cl/3.jpg')
  assert.equal(items.length, 3, 'las otras siguen en la galería')
})

test('la galería respeta el tope de 60 fotos por envío', () => {
  const photos = Array.from({ length: 90 }, (_, i) => `https://cdn.portal.cl/${i}.jpg`)
  assert.equal(buildPhotos({ photos, storedPhotos: [], selectedPhotoUrls: [] }).length, 60)
})

test('lo que no es una URL http no se envía como foto', () => {
  const items = buildPhotos({ photos: ['/relativa.jpg', null, 'https://cdn.portal.cl/ok.jpg'], storedPhotos: [], selectedPhotoUrls: [] })
  assert.deepEqual(items.map((i) => i.url), ['https://cdn.portal.cl/ok.jpg'])
})

// ─── Características ─────────────────────────────────────────────────────────

test('las características del anuncio se completan con lo que el parser dejó estructurado', () => {
  const features = buildFeatures(['Jardín'], { has_pool: true, parking: 2, storage: 1, is_condo: true })
  assert.deepEqual(features, ['Jardín', 'Piscina', 'Condominio', '2 estacionamientos', '1 bodega'])
})

test('las características no se duplican', () => {
  assert.deepEqual(buildFeatures(['Piscina'], { has_pool: true }), ['Piscina'])
})

// ─── Avisos de corredoras ────────────────────────────────────────────────────

test('el aviso de la web propia se pliega en el del portal de la MISMA corredora', () => {
  const web = {
    id: 'bbbbbbbb-0000-0000-0000-000000000002',
    portal: 'web:corredorax.cl',
    source_type: 'agency_web',
    source_url: 'https://corredorax.cl/propiedad/4412',
    corredora_id: 'cccccccc-0000-0000-0000-000000000001',
    corredora_name: 'Corredora X',
    price: 455000000,
    currency: 'CLP',
    status: 'active',
    detail_parsed_at: '2026-07-31T12:00:00.000Z',
  }
  const avisos = buildListings([LISTING_PORTAL, web])
  assert.equal(avisos.length, 1, 'una corredora = un aviso, no dos')
  assert.equal(avisos[0].source_url, LISTING_PORTAL.source_url)
  assert.equal(avisos[0].price, 460000000, 'precio del portal')
  assert.equal(avisos[0].broker_price, 455000000, 'precio en su propia web')
  assert.equal(avisos[0].broker_website_url, 'https://corredorax.cl/propiedad/4412')
  assert.equal(avisos[0].broker_scraped_at, '2026-07-31T12:00:00.000Z')
})

test('una web propia sin aviso de portal de esa corredora viaja como aviso propio', () => {
  const web = {
    id: 'bbbbbbbb-0000-0000-0000-000000000003',
    portal: 'web:otra.cl',
    source_type: 'agency_web',
    source_url: 'https://otra.cl/p/1',
    corredora_id: 'dddddddd-0000-0000-0000-000000000009',
    corredora_name: 'Otra Corredora',
    price: 470000000,
    currency: 'CLP',
    status: 'active',
  }
  const avisos = buildListings([LISTING_PORTAL, web])
  assert.equal(avisos.length, 2)
  assert.equal(avisos[1].source_url, 'https://otra.cl/p/1')
})

test('los avisos se deduplican por source_url y respetan el tope de 20', () => {
  const muchos = Array.from({ length: 25 }, (_, i) => ({
    ...LISTING_PORTAL, id: `id-${i}`, source_url: `https://portal.cl/${i}`, corredora_id: `cor-${i}`,
  }))
  const repetido = { ...LISTING_PORTAL, id: 'dup', source_url: 'https://portal.cl/0', corredora_id: 'cor-x' }
  const avisos = buildListings([...muchos, repetido])
  assert.equal(avisos.length, 20)
  assert.equal(new Set(avisos.map((a) => a.source_url)).size, 20)
})

test('nº de publicación: "MLC-3914632576" → "3914632576"', () => {
  assert.equal(publicationNumber('MLC-3914632576'), '3914632576')
  assert.equal(publicationNumber(null), null)
})

// ─── Payload completo ────────────────────────────────────────────────────────

test('el payload solo usa campos del contrato (additionalProperties: false)', () => {
  const payload = buildCaptacionPayload(BUNDLE)
  for (const key of Object.keys(payload)) {
    assert.ok(CAMPOS_CONTRATO.has(key), `campo fuera del contrato: ${key}`)
  }
  for (const aviso of payload.listings) {
    for (const key of Object.keys(aviso)) {
      assert.ok(CAMPOS_AVISO.has(key), `campo fuera del contrato en listings[]: ${key}`)
    }
  }
  for (const contacto of payload.contacts) {
    for (const key of Object.keys(contacto)) {
      assert.ok(CAMPOS_CONTACTO.has(key), `campo fuera del contrato en contacts[]: ${key}`)
    }
  }
})

test('owner.confirmed NUNCA se envía: "confirmada" no significa lo mismo a cada lado', () => {
  const payload = buildCaptacionPayload(BUNDLE)
  assert.equal(payload.owner.confirmed, undefined)
  assert.ok(!('confirmed' in payload.owner))
  // Y la etapa "Confirmada" tampoco se fija por API: la decide el equipo.
  assert.notEqual(payload.stage, 'confirmed')
})

test('el payload rellena las secciones de la ficha con datos del origen', () => {
  const payload = buildCaptacionPayload(BUNDLE)
  assert.equal(payload.external_id, externalIdFor(CAP_ID))
  assert.equal(payload.title, 'Casa mediterránea en Las Condes')
  assert.equal(payload.operation, 'venta')
  assert.equal(payload.price, 450000000)
  assert.equal(payload.currency, 'clp')
  assert.equal(payload.property_type, 'house')
  assert.equal(payload.square_meters, 320)
  assert.equal(payload.useful_square_meters, 265)
  assert.equal(payload.region, 'Región Metropolitana de Santiago')
  assert.equal(payload.commune, 'Las Condes')
  assert.equal(payload.zone, 'El Golf')
  assert.equal(payload.address_scraped, 'Av. Apoquindo 1234')
  assert.equal(payload.address_real, 'AV APOQUINDO 1234')
  assert.equal(payload.address_verified, true)
  // Formato OFICIAL del SII, no el canónico interno: la base guarda '795-198'
  // para poder comparar, pero al CRM va el rol como lo imprime el SII y como
  // sale en el certificado de la Tesorería.
  assert.equal(payload.rol_propiedad, '00795-00198')
  assert.equal(payload.owner.name, 'María Pérez')
  assert.equal(payload.owner.phone, '+56912345678')
  assert.equal(payload.contacts.length, 2)
  assert.equal(payload.photos.mode, 'sync')
  assert.equal(payload.listings.length, 1)
})

test('address_verified solo se afirma cuando el match está verificado con TGR', () => {
  const payload = buildCaptacionPayload({ ...BUNDLE, captacion: { ...CAPTACION, match_verified: false } })
  assert.equal(payload.address_verified, undefined, 'un match sin verificar no afirma nada')
})

test('el pin corregido a mano manda sobre la coordenada del anuncio', () => {
  const conPinCorregido = buildCaptacionPayload({
    ...BUNDLE,
    property: { ...BUNDLE.property, manual_latitude: -33.35018, manual_longitude: -70.53194 },
  })
  assert.equal(conPinCorregido.latitude, -33.35018)
  assert.equal(conPinCorregido.longitude, -70.53194)
})

test('sin pin corregido se usa la coordenada del anuncio, como antes', () => {
  const payload = buildCaptacionPayload(BUNDLE)
  assert.equal(payload.latitude, CAPTACION.latitude)
  assert.equal(payload.longitude, CAPTACION.longitude)
})

test('owner.contact nunca se envía: es redundante con contacts[]', () => {
  // Antes era "RUT 12345678-9 · 3 teléfonos · 1 email" -- lo mismo que ya
  // muestran las tarjetas de `contacts[]`, con pinta de resumen automático.
  const payload = buildCaptacionPayload(BUNDLE)
  assert.equal(payload.owner.contact, undefined)
  assert.ok(!('contact' in payload.owner))
  // name y phone SIGUEN viajando: son los datos reales, no un derivado.
  assert.equal(payload.owner.name, 'María Pérez')
  assert.ok(payload.owner.phone)
})

test('attempts nunca se envía: el origen no registra llamadas al propietario', () => {
  const payload = buildCaptacionPayload(BUNDLE)
  assert.equal(payload.attempts, undefined)
})

test('options nunca se envía: no se pisan los campos del equipo', () => {
  const payload = buildCaptacionPayload(BUNDLE)
  assert.equal(payload.options, undefined)
  assert.equal(payload.assigned_to_email, undefined)
})

test('forceFields solo viaja si se pide explícitamente, y solo con campos de la whitelist', () => {
  assert.deepEqual(FORCEABLE_TEAM_FIELDS, ['notes', 'owner.contact'])

  const sinForzar = buildCaptacionPayload(BUNDLE, { forceFields: [] })
  assert.equal(sinForzar.options, undefined)

  const conForzar = buildCaptacionPayload(BUNDLE, { forceFields: ['notes', 'owner.contact'] })
  assert.deepEqual(conForzar.options, { force_fields: ['notes', 'owner.contact'] })

  // Un campo fuera de la whitelist (p. ej. owner.phone, que sí puede llevar una
  // corrección real de la captadora) nunca se cuela, aunque alguien lo pida.
  const conCampoInvalido = buildCaptacionPayload(BUNDLE, { forceFields: ['owner.phone', 'notes'] })
  assert.deepEqual(conCampoInvalido.options, { force_fields: ['notes'] })

  const soloInvalidos = buildCaptacionPayload(BUNDLE, { forceFields: ['owner.phone'] })
  assert.equal(soloInvalidos.options, undefined)
})

test('un tipo desconocido cae a other y deja el original en metadata', () => {
  const payload = buildCaptacionPayload({
    ...BUNDLE, captacion: { ...CAPTACION, property_type: 'estacionamiento' },
  })
  assert.equal(payload.property_type, 'other')
  assert.equal(payload.metadata.property_type_origen, 'estacionamiento')
})

test('metadata lleva la auditoría del match que SmartBC no tiene dónde guardar', () => {
  const { metadata } = buildCaptacionPayload(BUNDLE)
  assert.equal(metadata.origen, 'casafari-mio')
  assert.equal(metadata.captacion_id, CAP_ID)
  // metadata es la pista de auditoría: lleva el rol interno, el que permite
  // volver a nuestra base. El que se lee en la ficha es `rol_propiedad`.
  assert.equal(metadata.sii_rol, '795-198')
  assert.equal(metadata.match_score, 0.97)
  assert.equal(metadata.match_verified, true)
  assert.equal(metadata.relacionados_total, 2)
  assert.equal(metadata.relacionados_enviados, 1)
})

test('los jsonb que llegan como string JSON se parsean igual', () => {
  const payload = buildCaptacionPayload({
    ...BUNDLE,
    captacion: {
      ...CAPTACION,
      phones: JSON.stringify(CAPTACION.phones),
      relacionados: JSON.stringify(CAPTACION.relacionados),
      photos: JSON.stringify(CAPTACION.photos),
      raw_extracted: JSON.stringify(CAPTACION.raw_extracted),
    },
  })
  assert.equal(payload.contacts.length, 2)
  assert.equal(payload.useful_square_meters, 265)
})

test('sin listings el payload sigue siendo válido (captación de URL suelta)', () => {
  const payload = buildCaptacionPayload({ ...BUNDLE, listings: [] })
  assert.equal(payload.external_id, externalIdFor(CAP_ID))
  assert.equal(payload.listings, undefined, 'una lista vacía no se envía')
  assert.equal(payload.price, 450000000)
})

test('la línea de procedencia se puede desactivar', () => {
  assert.ok(buildCaptacionPayload(BUNDLE).notes.includes('795-198'))
  assert.equal(buildCaptacionPayload(BUNDLE, { includeNotes: false }).notes, undefined)
})

// ─── Discrepancias en notes ──────────────────────────────────────────────────

test('superficie: más de 5% de diferencia con el catastro SII avisa, con las dos cifras', () => {
  // El anuncio dice 320 m², el catastro 260 m² -- 23% de diferencia.
  const nota = buildSurfaceDiscrepancyNote(320, 260)
  assert.match(nota, /260 m²/, 'lleva la cifra del catastro')
  assert.match(nota, /320 m²/, 'y la que declaró el anuncio')
  assert.match(nota, /catastro SII/i)
})

test('superficie: dentro del margen no avisa nada', () => {
  assert.equal(buildSurfaceDiscrepancyNote(320, 310), null, '3% de diferencia, por debajo del 5%')
  assert.equal(buildSurfaceDiscrepancyNote(320, 320), null, 'idénticas')
})

test('superficie: sin dato de catastro (o de anuncio) no hay nada que comparar', () => {
  assert.equal(buildSurfaceDiscrepancyNote(320, null), null)
  assert.equal(buildSurfaceDiscrepancyNote(null, 260), null)
  assert.equal(buildSurfaceDiscrepancyNote(null, null), null)
})

test('precio: corredoras con más de 5% de diferencia avisan, con ambas cifras y nombres', () => {
  const nota = buildPriceDiscrepancyNote([
    { status: 'active', price: 450_000_000, corredora_name: 'Corredora A' },
    { status: 'active', price: 520_000_000, corredora_name: 'Corredora B' },
  ])
  assert.match(nota, /Corredora A/)
  assert.match(nota, /Corredora B/)
  assert.match(nota, /\$450\.000\.000/)
  assert.match(nota, /\$520\.000\.000/)
})

test('precio: dentro del margen, o con un solo aviso, no hay nada que comparar', () => {
  assert.equal(
    buildPriceDiscrepancyNote([
      { status: 'active', price: 450_000_000, corredora_name: 'A' },
      { status: 'active', price: 460_000_000, corredora_name: 'B' },
    ]),
    null,
    '2% de diferencia',
  )
  assert.equal(buildPriceDiscrepancyNote([{ status: 'active', price: 450_000_000, corredora_name: 'A' }]), null)
  assert.equal(buildPriceDiscrepancyNote([]), null)
})

test('precio: un aviso dado de baja (gone) no cuenta para la comparación', () => {
  // Es un precio viejo del último rastreo antes de que el aviso se cayera —
  // compararlo con uno activo avisaría de una diferencia que ya no existe.
  const nota = buildPriceDiscrepancyNote([
    { status: 'active', price: 450_000_000, corredora_name: 'A' },
    { status: 'gone', price: 300_000_000, corredora_name: 'B (de baja)' },
  ])
  assert.equal(nota, null)
})

test('buildNotes junta procedencia + discrepancias en una sola línea', () => {
  const notes = buildNotes(CAPTACION, {
    catastroSuperficie: 260,
    listings: [
      { status: 'active', price: 450_000_000, corredora_name: 'A' },
      { status: 'active', price: 520_000_000, corredora_name: 'B' },
    ],
  })
  assert.match(notes, /Rol SII 795-198/, 'la procedencia sigue yendo primero')
  assert.match(notes, /catastro SII/i)
  assert.match(notes, /Precio distinto/)
})

test('buildNotes sin discrepancias es exactamente igual a la línea de procedencia de siempre', () => {
  assert.equal(buildNotes(CAPTACION), buildProvenanceNote(CAPTACION))
})

test('la discrepancia de superficie y de precio llegan hasta notes en el payload completo', () => {
  const payload = buildCaptacionPayload({
    ...BUNDLE,
    catastro: { superficie_terreno_m2: 260 },
    listings: [
      LISTING_PORTAL,
      { ...LISTING_PORTAL, id: 'aaaaaaaa-0000-0000-0000-000000000002', price: 520_000_000, corredora_name: 'Corredora B', source_url: 'https://otraweb.cl/aviso-2' },
    ],
  })
  assert.match(payload.notes, /catastro SII/i)
  assert.match(payload.notes, /Precio distinto/)
})

test('la etapa inicial es configurable y puede omitirse', () => {
  assert.equal(buildCaptacionPayload(BUNDLE).stage, 'assigned')
  assert.equal(buildCaptacionPayload(BUNDLE, { stage: null }).stage, undefined)
})

// ─── Diff e idempotencia ─────────────────────────────────────────────────────

test('el mismo bundle produce el mismo hash (detecta "no ha cambiado nada")', () => {
  assert.equal(payloadHash(buildCaptacionPayload(BUNDLE)), payloadHash(buildCaptacionPayload(BUNDLE)))
})

test('cambiar el precio produce un PATCH con SOLO el precio (más el escudo)', () => {
  const antes = buildCaptacionPayload(BUNDLE)
  const despues = buildCaptacionPayload({
    ...BUNDLE, captacion: { ...CAPTACION, price_raw: 470000000 },
  })
  const patch = diffPayload(antes, despues)
  assert.deepEqual(Object.keys(patch).sort(), ['external_id', 'price', 'source_site'])
  assert.equal(patch.price, 470000000)
})

test('source_site viaja en todo PATCH: si no, SmartBC lo pisa con su slug', () => {
  // Comprobado en vivo: un PATCH sin source_site convierte "portalinmobiliario"
  // en "crm-chile" y se pierde de qué portal salió el aviso.
  const antes = buildCaptacionPayload(BUNDLE)
  const despues = buildCaptacionPayload({
    ...BUNDLE, captacion: { ...CAPTACION, price_raw: 470000000 },
  })
  assert.equal(diffPayload(antes, despues).source_site, 'portalinmobiliario')
})

test('el escudo de source_site no hace que una ficha sin cambios parezca cambiada', () => {
  const p = buildCaptacionPayload(BUNDLE)
  const patch = diffPayload(p, buildCaptacionPayload(BUNDLE))
  assert.equal(patch.source_site, 'portalinmobiliario', 'el escudo está')
  assert.ok(isEmptyPatch(patch), 'pero no cuenta como cambio')
})

test('sin cambios el diff queda vacío y no se envía nada', () => {
  const p = buildCaptacionPayload(BUNDLE)
  assert.ok(isEmptyPatch(diffPayload(p, buildCaptacionPayload(BUNDLE))))
})

test('el diff no reenvía la etapa: después de crear, es campo del equipo', () => {
  const antes = buildCaptacionPayload(BUNDLE, { stage: 'assigned' })
  const despues = buildCaptacionPayload(BUNDLE, { stage: 'contacting' })
  assert.ok(isEmptyPatch(diffPayload(antes, despues)))
})

test('sin envío previo el diff es el payload completo (alta)', () => {
  const p = buildCaptacionPayload(BUNDLE)
  assert.deepEqual(diffPayload(null, p), p)
})

test('el hash no depende del orden de las claves', () => {
  const a = { external_id: 'x', price: 1, currency: 'clp' }
  const b = { currency: 'clp', price: 1, external_id: 'x' }
  assert.equal(payloadHash(a), payloadHash(b))
})
