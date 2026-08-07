// Tests de la fuente del listado (discovery-fuente-cl.mjs).
//
// Correr:  node --test scraper/lib/discovery-fuente-cl.test.mjs
//
// Sin red y sin Postgres: la API se inyecta. Lo que se blinda:
//   - que el external_id de la API salga con el MISMO formato que el del HTML
//     (un formato distinto duplicaría el catálogo entero);
//   - que "Arriendo" no se confunda con "Arriendo temporal" al resolver filtros;
//   - que el tope de 1000 de la API se comporte como fin de resultados y no
//     como un fallo;
//   - que un problema de la API caiga al HTML en vez de parar el barrido;
//   - y que la API NO dé de baja anuncios mientras no se le autorice.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  elegirPorNombre,
  filtroPrecioMl,
  mapItemMl,
  crearResolutorMl,
  elegirSortReciente,
  fuenteApiMl,
  fuenteHtml,
  fuenteConRespaldo,
  elegirFuente,
  PAGINA_API,
} from './discovery-fuente-cl.mjs'
import { discoverTarget, buildListUrl } from './discovery-portalinmobiliario-cl.mjs'

// ── Puras ────────────────────────────────────────────────────────────────────

// "Arriendo" y "Arriendo temporal" son dos mercados distintos: uno es vivienda y
// el otro estadías turísticas. Casar por prefijo sin probar primero la igualdad
// exacta metería hoteles en el catálogo de arriendos.
test('elegirPorNombre: la coincidencia EXACTA gana a la de prefijo', () => {
  const valores = [
    { id: 'temporal', name: 'Arriendo temporal' },
    { id: 'arriendo', name: 'Arriendo' },
  ]
  assert.equal(elegirPorNombre(valores, ['arriendo']).id, 'arriendo')
})

test('elegirPorNombre: cae a prefijo si no hay exacta, e ignora tildes/mayúsculas', () => {
  assert.equal(elegirPorNombre([{ id: 'd', name: 'Departamentos usados' }], ['departamento']).id, 'd')
  assert.equal(elegirPorNombre([{ id: 'r', name: 'Región Metropolitana' }], ['region metropolitana']).id, 'r')
  assert.equal(elegirPorNombre([{ id: 'x', name: 'Oficina' }], ['casa']), null)
  assert.equal(elegirPorNombre(null, ['casa']), null)
})

// Mandar `sort=date_desc` a ciegas es un 400 si esa categoría no lo ofrece, y un
// 400 tumba la búsqueda entera por un parámetro cosmético. Se pregunta.
test('elegirSortReciente: coge el orden por fecha descendente que declare la API', () => {
  assert.equal(elegirSortReciente([{ id: 'price_asc' }, { id: 'date_desc' }]), 'date_desc')
  assert.equal(elegirSortReciente([{ id: 'begins_date' }]), 'begins_date')
  // Sin ninguno por fecha se va SIN orden: peor es que la API rechace la
  // petición completa.
  assert.equal(elegirSortReciente([{ id: 'relevance' }, { id: 'price_desc' }]), null)
  assert.equal(elegirSortReciente(undefined), null)
})

test('filtroPrecioMl: bandas cerradas y abiertas, con * en los extremos', () => {
  assert.equal(filtroPrecioMl(null), null)
  assert.equal(filtroPrecioMl({ min: 0, max: 15000, unit: 'CLF' }), '*-15000')
  assert.equal(filtroPrecioMl({ min: 15000, max: 24000, unit: 'CLF' }), '15000-24000')
  // `max: 0` es como el portal escribe "sin tope" — se traduce a la banda abierta.
  assert.equal(filtroPrecioMl({ min: 220000, max: 0, unit: 'CLF' }), '220000-*')
  // Banda sin ningún límite: no hay filtro que aplicar.
  assert.equal(filtroPrecioMl({ min: 0, max: 0, unit: 'CLP' }), null)
})

// ── Mapeo de un ítem de la API ───────────────────────────────────────────────

const ITEM = {
  id: 'MLC1234567890',
  title: 'Casa en Las Condes',
  permalink: 'https://casa.mercadolibre.cl/MLC-1234567890-casa-en-las-condes',
  price: 18500,
  currency_id: 'CLF',
  domain_id: 'MLC-HOUSES_FOR_SALE',
  seller: { id: 99, nickname: 'CORREDORA XYZ' },
  location: { city: { name: 'Las Condes' }, state: { name: 'Metropolitana de Santiago' } },
  attributes: [
    { id: 'BEDROOMS', value_name: '4', value_struct: { number: 4, unit: '' } },
    { id: 'FULL_BATHROOMS', value_name: '3', value_struct: { number: 3, unit: '' } },
    { id: 'COVERED_AREA', value_name: '210 m²', value_struct: { number: 210, unit: 'm²' } },
  ],
}

// El external_id es la clave con la que se deduplica TODO el catálogo. La API lo
// da sin guion ("MLC1234567890") y el HTML con él: si no se normalizan igual,
// cada anuncio entra dos veces.
test('mapItemMl: normaliza el external_id al formato MLC-<n> del resto del scraper', () => {
  assert.equal(mapItemMl(ITEM).external_id, 'MLC-1234567890')
  assert.equal(mapItemMl({ ...ITEM, id: 'MLC-1234567890' }).external_id, 'MLC-1234567890')
  assert.equal(mapItemMl({ id: null }), null)
  assert.equal(mapItemMl(undefined), null)
})

test('mapItemMl: campos duros, con CLF traducido a UF', () => {
  const m = mapItemMl(ITEM)
  assert.equal(m.source_url, ITEM.permalink)
  assert.equal(m.title, 'Casa en Las Condes')
  assert.equal(m.operation, 'sale')
  assert.equal(m.property_type, 'casa')
  assert.equal(m.is_development, false)
  assert.equal(m.price, 18500)
  assert.equal(m.currency, 'UF')
  assert.equal(m.bedrooms, 4)
  assert.equal(m.bathrooms, 3)
  assert.equal(m.square_meters, 210)
  assert.equal(m.location_text, 'Las Condes, Metropolitana de Santiago')
  assert.equal(m.advertiser_name, 'CORREDORA XYZ')
  assert.equal(m.advertiser_type, 'unknown')
})

test('mapItemMl: arriendo de departamento y proyecto en obra', () => {
  const arriendo = mapItemMl({ ...ITEM, domain_id: 'MLC-APARTMENTS_FOR_RENT', currency_id: 'CLP' })
  assert.equal(arriendo.operation, 'rent')
  assert.equal(arriendo.property_type, 'departamento')
  assert.equal(arriendo.currency, 'CLP')
  // Los proyectos se marcan para que el discovery los filtre (el plan cubre
  // primero propiedades usadas), igual que hace el parser del HTML.
  assert.equal(mapItemMl({ ...ITEM, domain_id: 'MLC-REAL_ESTATE_DEVELOPMENTS' }).is_development, true)
})

test('mapItemMl: sin permalink cae a la URL canónica de la ficha', () => {
  const m = mapItemMl({ ...ITEM, permalink: null })
  assert.equal(m.source_url, 'https://www.portalinmobiliario.com/MLC-1234567890')
})

test('mapItemMl: ítem sin atributos ni ubicación no lanza', () => {
  const m = mapItemMl({ id: 'MLC1', domain_id: '' })
  assert.deepEqual(
    { bedrooms: m.bedrooms, bathrooms: m.bathrooms, square_meters: m.square_meters, location_text: m.location_text, operation: m.operation },
    { bedrooms: null, bathrooms: null, square_meters: null, location_text: null, operation: null }
  )
})

// ── Resolución de filtros contra la API ──────────────────────────────────────

const TARGET = {
  id: 't-1', comuna_id: 'c-lc', comuna_name: 'Las Condes',
  region: 'Región Metropolitana de Santiago', operation: 'sale', property_type: 'casa',
}

/** API falsa: estados, ciudades y búsquedas con filtros disponibles. */
function apiFalsa({ resultados = [], total = 0, filtrosDisponibles = null } = {}) {
  const llamadas = { estados: 0, ciudades: 0, buscar: [] }
  const disponibles = filtrosDisponibles ?? [
    { id: 'OPERATION', values: [{ id: 'op-arriendo', name: 'Arriendo' }, { id: 'op-venta', name: 'Venta' }] },
    { id: 'PROPERTY_TYPE', values: [{ id: 'tipo-casa', name: 'Casa' }, { id: 'tipo-depto', name: 'Departamento' }] },
  ]
  return {
    llamadas,
    estados: async () => {
      llamadas.estados++
      return { ok: true, data: { states: [{ id: 'CL-RM', name: 'Metropolitana de Santiago' }, { id: 'CL-VS', name: 'Valparaíso' }] } }
    },
    ciudades: async (estadoId) => {
      llamadas.ciudades++
      return { ok: true, data: { cities: [{ id: `${estadoId}-LC`, name: 'Las Condes' }, { id: `${estadoId}-VIT`, name: 'Vitacura' }] } }
    },
    buscar: async (params) => {
      llamadas.buscar.push(params)
      return {
        ok: true,
        data: {
          paging: { total }, results: resultados, available_filters: disponibles,
          available_sorts: [{ id: 'price_asc', name: 'Menor precio' }, { id: 'date_desc', name: 'Más recientes' }],
        },
      }
    },
  }
}

test('crearResolutorMl: región → comuna → operación → tipo, y lo cachea', async () => {
  const api = apiFalsa()
  const filtrosDe = crearResolutorMl({ buscar: api.buscar, estados: api.estados, ciudades: api.ciudades })

  const r = await filtrosDe(TARGET)
  assert.deepEqual(r, {
    ok: true,
    filtros: { state: 'CL-RM', city: 'CL-RM-LC', OPERATION: 'op-venta', PROPERTY_TYPE: 'tipo-casa' },
    // El orden por fecha se aprende de las mismas búsquedas de resolución, sin
    // gastar una petición extra.
    sort: 'date_desc',
  })

  const antes = { ...api.llamadas, buscar: api.llamadas.buscar.length }
  await filtrosDe(TARGET)
  assert.deepEqual(
    { estados: api.llamadas.estados, ciudades: api.llamadas.ciudades, buscar: api.llamadas.buscar.length },
    antes,
    'la segunda resolución del mismo objetivo no debe volver a preguntar'
  )
})

// Un tipo que la comuna no tiene NO es un fallo del sistema: es que ahí no hay
// ese inventario. Abortar dejaría el objetivo "fallando" para siempre.
test('crearResolutorMl: si la comuna no ofrece ese tipo, barre sin el filtro de tipo', async () => {
  const api = apiFalsa({
    filtrosDisponibles: [
      { id: 'OPERATION', values: [{ id: 'op-venta', name: 'Venta' }] },
      { id: 'PROPERTY_TYPE', values: [{ id: 'tipo-depto', name: 'Departamento' }] },
    ],
  })
  const filtrosDe = crearResolutorMl({ buscar: api.buscar, estados: api.estados, ciudades: api.ciudades })
  const r = await filtrosDe(TARGET)
  assert.equal(r.ok, true)
  assert.equal(r.filtros.PROPERTY_TYPE, undefined)
  assert.match(r.sinTipo, /PROPERTY_TYPE/)
})

test('crearResolutorMl: comuna que Mercado Libre no conoce se explica, no revienta', async () => {
  const api = apiFalsa()
  const filtrosDe = crearResolutorMl({ buscar: api.buscar, estados: api.estados, ciudades: api.ciudades })
  const r = await filtrosDe({ ...TARGET, comuna_name: 'Comuna Inventada' })
  assert.equal(r.ok, false)
  assert.match(r.reason, /Comuna Inventada/)
})

// Un timeout NO puede condenar la región hasta reiniciar el worker: solo se
// cachea lo concluyente ("esta comuna no existe"), nunca un fallo de red.
test('crearResolutorMl: un fallo de red no se cachea, se reintenta', async () => {
  let intento = 0
  const estados = async () => {
    intento++
    return intento === 1
      ? { ok: false, status: 0, reason: 'timeout tras 20s' }
      : { ok: true, data: { states: [{ id: 'CL-RM', name: 'Metropolitana de Santiago' }] } }
  }
  const api = apiFalsa()
  const filtrosDe = crearResolutorMl({ buscar: api.buscar, estados, ciudades: api.ciudades })

  assert.equal((await filtrosDe(TARGET)).ok, false)
  assert.equal((await filtrosDe(TARGET)).ok, true, 'el segundo intento debe volver a preguntar')
})

// ── Fuente API ───────────────────────────────────────────────────────────────

test('fuenteApiMl: mapea resultados y declara el tope de 1000 de la API', async () => {
  const api = apiFalsa({ resultados: [ITEM, { ...ITEM, id: 'MLC999' }], total: 3487 })
  const fuente = fuenteApiMl({
    buscar: api.buscar,
    resolutor: crearResolutorMl({ buscar: api.buscar, estados: api.estados, ciudades: api.ciudades }),
    permiteBajas: false,
  })

  const pagina = await fuente.pedirPagina({ target: TARGET, offset: 0 })
  assert.equal(pagina.ok, true)
  assert.deepEqual(pagina.listings.map((l) => l.external_id), ['MLC-1234567890', 'MLC-999'])
  assert.equal(pagina.meta.total, 3487)
  // El tope se declara para que el discovery bisecte por precio hasta caber
  // debajo — la misma maquinaria que usa contra el tope de ~2000 del HTML.
  assert.equal(pagina.meta.resultsLimit, 1000)
  assert.equal(pagina.meta.pageCount, Math.ceil(1000 / PAGINA_API))
})

test('fuenteApiMl: la banda de precio y el orden por fecha llegan a la búsqueda', async () => {
  const api = apiFalsa({ total: 10 })
  const fuente = fuenteApiMl({
    buscar: api.buscar,
    resolutor: crearResolutorMl({ buscar: api.buscar, estados: api.estados, ciudades: api.ciudades }),
    permiteBajas: false,
  })
  await fuente.pedirPagina({ target: TARGET, offset: 50, priceRange: { min: 15000, max: 24000, unit: 'CLF' } })

  const ultima = api.llamadas.buscar.at(-1)
  assert.equal(ultima.filtros.price, '15000-24000')
  assert.equal(ultima.filtros.OPERATION, 'op-venta')
  assert.equal(ultima.offset, 50)
  assert.equal(ultima.sort, 'date_desc')
})

// Pedir más allá del tope es un 400 de la API. Devolverlo como fallo abriría el
// circuito y marcaría el objetivo "bloqueado"; devolverlo como página vacía es
// lo que el discovery ya entiende como "fin de resultados".
test('fuenteApiMl: pasado el tope devuelve página vacía, no un fallo', async () => {
  const api = apiFalsa({ total: 5000 })
  const fuente = fuenteApiMl({
    buscar: api.buscar,
    resolutor: crearResolutorMl({ buscar: api.buscar, estados: api.estados, ciudades: api.ciudades }),
    permiteBajas: false,
  })
  const antes = api.llamadas.buscar.length
  const pagina = await fuente.pedirPagina({ target: TARGET, offset: 1000 })
  assert.equal(pagina.ok, true)
  assert.deepEqual(pagina.listings, [])
  assert.equal(api.llamadas.buscar.length, antes, 'no debe gastar una petición que la API rechazaría')
})

test('fuenteApiMl: un fallo de la API se propaga con su motivo legible', async () => {
  const api = apiFalsa()
  const fuente = fuenteApiMl({
    buscar: async () => ({ ok: false, status: 401, reason: 'HTTP 401 (token de Mercado Libre rechazado o ausente)' }),
    resolutor: async () => ({ ok: true, filtros: { state: 'CL-RM' } }),
    permiteBajas: false,
  })
  const pagina = await fuente.pedirPagina({ target: TARGET, offset: 0 })
  assert.equal(pagina.ok, false)
  assert.equal(pagina.status, 401)
  assert.match(pagina.reason, /API Mercado Libre.*401/)
  assert.equal(api.llamadas.buscar.length, 0)
})

// ── Fuente HTML y respaldo ───────────────────────────────────────────────────

test('fuenteHtml: construye la URL del portal y usa los parsers de siempre', async () => {
  const vistas = []
  const fuente = fuenteHtml({
    fetch: async (url, opts) => { vistas.push({ url, opts }); return { ok: true, html: 'HTML' } },
    parseList: (html) => (html === 'HTML' ? [{ external_id: 'MLC-1' }] : []),
    parseMeta: () => ({ total: 42, pageCount: 1, resultsLimit: 2000 }),
    buildUrl: buildListUrl,
  })

  assert.equal(fuente.tamanoPagina, 48)
  assert.equal(fuente.permiteBajas, true, 'el HTML es la fuente que sí puede firmar bajas')

  const pagina = await fuente.pedirPagina({ target: TARGET, slug: 'las-condes', rslug: 'metropolitana', offset: 48 })
  assert.deepEqual(pagina.listings, [{ external_id: 'MLC-1' }])
  assert.equal(pagina.meta.total, 42)
  assert.equal(vistas[0].opts.profile, 'portalinmobiliario')
  assert.match(vistas[0].url, /_Desde_49_OrderId_BEGINS\*DESC_NoIndex_True$/)
})

// La red de seguridad del cambio entero: activar la API no puede empeorar nada.
// Si falla, el barrido vuelve por donde iba antes.
test('fuenteConRespaldo: si la API no sirve la página, la pide el HTML', async () => {
  const avisos = []
  const api = { nombre: 'api-ml', tamanoPagina: 50, permiteBajas: false, pedirPagina: async () => ({ ok: false, reason: 'HTTP 500' }) }
  const html = { nombre: 'html', tamanoPagina: 48, permiteBajas: true, pedirPagina: async () => ({ ok: true, listings: [{ external_id: 'MLC-1' }], meta: { total: 7 } }) }

  const fuente = fuenteConRespaldo(api, html, { avisar: (m) => avisos.push(m) })
  const pagina = await fuente.pedirPagina({ target: TARGET, offset: 0 })

  assert.equal(pagina.ok, true)
  assert.equal(pagina.via, 'html')
  assert.equal(pagina.meta.total, 7)
  assert.match(avisos[0], /api-ml.*HTTP 500.*html/)
  // El permiso de bajas es el del PRIMARIO: es su total el que manda el barrido.
  assert.equal(fuente.permiteBajas, false)
})

test('fuenteConRespaldo: si fallan las dos, se informa del fallo del PRIMARIO', async () => {
  const api = { nombre: 'api-ml', tamanoPagina: 50, permiteBajas: false, pedirPagina: async () => ({ ok: false, status: 401, reason: 'token rechazado' }) }
  const html = { nombre: 'html', tamanoPagina: 48, permiteBajas: true, pedirPagina: async () => ({ ok: false, status: 0, reason: 'bloqueo antibot' }) }
  const pagina = await fuenteConRespaldo(api, html, { avisar: () => {} }).pedirPagina({ target: TARGET, offset: 0 })
  assert.equal(pagina.ok, false)
  assert.match(pagina.reason, /token rechazado/)
})

test('elegirFuente: sin credenciales de Mercado Libre se queda con el HTML, sin envolver nada', () => {
  const html = { nombre: 'html', tamanoPagina: 48, permiteBajas: true, pedirPagina: async () => ({ ok: true }) }
  assert.equal(elegirFuente({ html, configurada: () => false }), html)

  const api = { nombre: 'api-ml', tamanoPagina: 50, permiteBajas: false, pedirPagina: async () => ({ ok: true }) }
  assert.equal(elegirFuente({ html, api, configurada: () => true }).nombre, 'api-ml+html')
})

// ── Integración con el barrido ───────────────────────────────────────────────

function clienteFalso({ conocidos = new Set(), activos = [] } = {}) {
  const consultas = []
  return {
    consultas,
    query: async (sql, params) => {
      consultas.push({ sql, params })
      if (/SELECT external_id FROM listings_cl/.test(sql)) {
        return { rows: (params[0] ?? []).filter((id) => conocidos.has(id)).map((external_id) => ({ external_id })) }
      }
      if (/SELECT id FROM listings_cl/.test(sql)) return { rows: activos.map((id) => ({ id })) }
      return { rows: [] }
    },
  }
}

/** Fuente de mentira con N anuncios, paginando de 50 en 50 como la API. */
function fuenteFalsa({ ids, total, permiteBajas, nombre = 'api-ml' }) {
  return {
    nombre,
    tamanoPagina: 50,
    permiteBajas,
    pedirPagina: async ({ offset = 0 }) => ({
      ok: true,
      listings: ids.slice(offset, offset + 50).map((id) => ({ external_id: id, source_url: `https://x/${id}`, is_development: false })),
      meta: { total, pageCount: 1, resultsLimit: 1000 },
    }),
  }
}

// El seguro más importante del cambio. Si el catálogo de la API resultara ser un
// subconjunto del que enseña el portal, un barrido "completo al 100%" apagaría
// en masa anuncios vivos — y eso no se deshace solo.
test('discoverTarget: con la fuente API NO se dan de baja anuncios, aunque el barrido sea exhaustivo', async () => {
  const client = clienteFalso({ activos: ['viejo-1', 'viejo-2'] })
  const res = await discoverTarget(client, TARGET, {
    fuente: fuenteFalsa({ ids: ['MLC-1', 'MLC-2'], total: 2, permiteBajas: false }),
    sleep: async () => {},
  })

  assert.equal(res.fuente, 'api-ml')
  assert.equal(res.seen, 2)
  assert.equal(res.exhaustive, true, 'vio el 100% de lo que la fuente declara')
  assert.equal(res.delisted, 0)
  assert.match(res.reason, /ML_API_BAJAS=1/)
  assert.equal(
    client.consultas.some((c) => /UPDATE listings_cl SET is_active = false/.test(c.sql)),
    false,
    'no puede haberse ejecutado ninguna baja'
  )
})

test('discoverTarget: la misma fuente autorizada SÍ da de baja lo que no reapareció', async () => {
  const client = clienteFalso({ activos: ['viejo-1'] })
  const res = await discoverTarget(client, TARGET, {
    fuente: fuenteFalsa({ ids: ['MLC-1', 'MLC-2'], total: 2, permiteBajas: true }),
    sleep: async () => {},
  })
  assert.equal(res.delisted, 1)
})

// El desplazamiento se calcula con el tamaño de página de la FUENTE. Con la
// constante de 48 del HTML, la paginación de la API (50) se saltaría 2 anuncios
// por página y la cobertura nunca llegaría al umbral.
test('discoverTarget: pagina con el tamaño de página de la fuente, no con el del HTML', async () => {
  const ids = Array.from({ length: 120 }, (_, i) => `MLC-${i}`)
  const client = clienteFalso()
  const res = await discoverTarget(client, TARGET, {
    fuente: fuenteFalsa({ ids, total: 120, permiteBajas: false }),
    sleep: async () => {},
  })
  assert.equal(res.seen, 120)
  assert.equal(res.enqueued, 120)
})
