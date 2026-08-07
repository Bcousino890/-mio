// ─────────────────────────────────────────────────────────────────────────────
// De dónde salen los anuncios del LISTADO: la API oficial de Mercado Libre o el
// HTML de Portal Inmobiliario.
//
// EL PROBLEMA QUE CIERRA ESTE MÓDULO. El barrido leía el listado bajando el HTML
// de las páginas de búsqueda, y Mercado Libre lleva meses contestando a esas
// páginas con su pantalla de "tráfico sospechoso": HTTP 200, cero anuncios,
// decidido por la reputación de la IP de salida. Está medido y no admite mucha
// discusión (ver web/lib/pi-respuesta.mjs): no lo arreglan las cabeceras, no lo
// arregla el parser, y el proxy residencial solo lo esquiva un rato. El panel de
// salud lo lleva enseñando igual desde hace días — 7 de 8 objetivos sin leer una
// sola página — y cada arreglo anterior movió el problema en vez de cerrarlo.
//
// Las FICHAS, en cambio, se sirven con normalidad por el mismo proxy y en la
// misma hora (46 fichas bien contra 11 bloqueos del listado). O sea: lo que está
// cerrado no es el portal, es su BUSCADOR.
//
// Y para el buscador hay una puerta abierta y documentada: la API de Mercado
// Libre. Misma información, servida por una vía pensada para clientes
// automáticos y autenticada con una aplicación propia en vez de filtrada por
// reputación de IP. Este módulo la pone delante del HTML, dejando el HTML de
// respaldo para cuando la API no esté configurada o falle.
//
// LAS DOS FUENTES HABLAN EL MISMO IDIOMA: `pedirPagina(peticion)` devuelve
// `{ ok, listings, meta }` con los anuncios ya mapeados a la forma del scraper.
// Todo lo que el discovery sabe hacer (paginar, bisecar por precio, contrastar
// cobertura, detectar bajas) es agnóstico de quién sirvió la página.
//
// DE PROPÓSITO, LA API NO DA DE BAJA ANUNCIOS (`permiteBajas: false`). Dar de
// baja es irreversible en la práctica y se decide comparando lo visto contra el
// total que declara la fuente; si el catálogo de la API resultara ser un
// subconjunto del que muestra el portal, un barrido "completo" al 100% daría de
// baja anuncios vivos en masa. Hasta que los totales de las dos fuentes se hayan
// comparado en el panel, la API descubre altas (que es lo urgente: el catálogo
// lleva 16 h sin crecer) y las bajas las sigue decidiendo el HTML. Se activa con
// `ML_API_BAJAS=1` cuando los números cuadren.
// ─────────────────────────────────────────────────────────────────────────────
import { fold } from './chile-comunas.mjs'
import { envVivo } from './env-vivo.mjs'
import { credencialesMl } from './ml-oauth-cl.mjs'
import {
  searchListings,
  getEstadosCl,
  getCiudadesEstado,
  TOPE_OFFSET_ML,
  TOPE_LIMIT_ML,
} from './ml-api-client.mjs'

/**
 * @typedef {object} PeticionPagina
 * @property {{ operation: 'sale'|'rent', property_type: string, comuna_name: string, region: string }} target
 * @property {string} slug   comuna en formato URL ("las-condes")
 * @property {string} rslug  región en formato URL ("metropolitana")
 * @property {number} offset desplazamiento en resultados (0, 48, 96… / 0, 50, 100…)
 * @property {{min:number,max:number,unit:string}|null} [priceRange]
 * @property {boolean} [sortRecent]
 *
 * @typedef {object} PaginaListado
 * @property {boolean} ok
 * @property {number} [status]
 * @property {string} [reason]
 * @property {Array<object>} [listings]
 * @property {{ total: number|null, pageCount: number|null, resultsLimit: number|null }} [meta]
 *
 * @typedef {object} Fuente
 * @property {string} nombre
 * @property {number} tamanoPagina
 * @property {boolean} permiteBajas
 * @property {(p: PeticionPagina) => Promise<PaginaListado>} pedirPagina
 */

// 48 resultados por página en el HTML (confirmado en Fase 0: `_Desde_49`,
// `_Desde_97`…). La API pagina de 50 en 50 como mucho.
export const PAGINA_HTML = 48
export const PAGINA_API = TOPE_LIMIT_ML

const META_VACIA = { total: null, pageCount: null, resultsLimit: null }

// ─── Fuente HTML (la de siempre) ─────────────────────────────────────────────

/**
 * Envuelve el camino actual —`buildListUrl` + fetch por proxy + parsers del blob
 * Nordic— en la interfaz común. NO cambia ni un detalle de su comportamiento:
 * misma URL, mismo perfil de fetch, mismos parsers. Es literalmente el código
 * que ya corría, movido detrás de una función con nombre.
 *
 * `buildUrl` se inyecta (en vez de importarlo) para no crear un ciclo de
 * importación con discovery-portalinmobiliario-cl.mjs, que es quien conoce el
 * formato de URL del portal y quien construye esta fuente.
 */
export function fuenteHtml({ fetch, parseList, parseMeta, buildUrl }) {
  return {
    nombre: 'html',
    tamanoPagina: PAGINA_HTML,
    permiteBajas: true,
    async pedirPagina({ target, slug, rslug, offset = 0, priceRange = null, sortRecent = true }) {
      const url = buildUrl({
        comunaSlug: slug, regionSlug: rslug,
        operation: target.operation, propertyType: target.property_type,
        offset, priceRange, sortRecent,
      })
      const res = await fetch(url, { profile: 'portalinmobiliario' })
      if (!res.ok) return { ok: false, status: res.status, reason: res.reason, url }
      return { ok: true, url, listings: parseList(res.html), meta: parseMeta(res.html) }
    },
  }
}

// ─── Fuente API oficial de Mercado Libre ─────────────────────────────────────

/** ¿Está la API configurada en esta instalación? */
export function apiMlConfigurada() {
  return credencialesMl() != null
}

/** ¿Se le permite a la API decidir bajas? Apagado salvo `ML_API_BAJAS=1`. */
export function apiMlPuedeDarDeBaja() {
  return envVivo('ML_API_BAJAS') === '1'
}

// Nombres con los que Mercado Libre etiqueta cada operación y cada tipo de
// propiedad en sus filtros. Se comparan "folded" (sin tildes, en minúsculas) y
// por igualdad EXACTA antes que por prefijo, porque conviven valores que empiezan
// igual y significan cosas distintas: "Arriendo" y "Arriendo temporal" son dos
// mercados diferentes y mezclarlos metería estadías turísticas en el catálogo.
const NOMBRES_OPERACION = { rent: ['arriendo', 'alquiler'], sale: ['venta'] }
const NOMBRES_TIPO = {
  casa: ['casa', 'casas'],
  departamento: ['departamento', 'departamentos', 'depto'],
  oficina: ['oficina', 'oficinas'],
  terreno: ['terreno', 'terrenos', 'sitio', 'sitios'],
  parcela: ['parcela', 'parcelas'],
  local: ['local', 'locales', 'local comercial'],
  bodega: ['bodega', 'bodegas'],
}

/**
 * Busca en una lista `[{id, name}]` el elemento cuyo nombre case con alguno de
 * los candidatos. Exacto primero, prefijo después. Puro y exportado para test:
 * es la pieza de la que depende que no barramos el mercado equivocado.
 */
export function elegirPorNombre(valores, candidatos) {
  const lista = Array.isArray(valores) ? valores : []
  const objetivo = candidatos.map((c) => fold(c))
  for (const v of lista) {
    if (objetivo.includes(fold(String(v?.name ?? '')))) return v
  }
  for (const v of lista) {
    const n = fold(String(v?.name ?? ''))
    if (objetivo.some((o) => n.startsWith(o))) return v
  }
  return null
}

/**
 * El filtro `price` de la API se escribe `min-max`, con `*` para los extremos
 * abiertos. Puro.
 *
 * La unidad no se manda aparte porque la API filtra sobre el precio TAL COMO lo
 * publicó el vendedor: los arriendos chilenos van en pesos y las ventas en UF
 * (`currency_id: "CLF"`), que es exactamente el par de unidades que el discovery
 * ya usa para bisecar (CLP para arriendo, CLF para venta). Mientras el objetivo
 * sea homogéneo en moneda —el mismo supuesto que hace el camino HTML— los
 * límites numéricos calzan sin conversión.
 */
export function filtroPrecioMl(priceRange) {
  if (!priceRange) return null
  const { min = 0, max = 0 } = priceRange
  const desde = min > 0 ? String(Math.round(min)) : '*'
  const hasta = max > 0 ? String(Math.round(max)) : '*'
  if (desde === '*' && hasta === '*') return null
  return `${desde}-${hasta}`
}

/**
 * Elige el criterio de orden "más recientes primero" de entre los que la API
 * declara en `available_sorts`. Puro.
 *
 * Se pregunta en vez de mandar `sort=date_desc` a ciegas: si ese id no existe
 * para esta categoría, la API responde 400 y se cae TODA la búsqueda — un
 * parámetro cosmético tumbaría el barrido entero. Sin orden por fecha la
 * búsqueda sigue siendo válida (solo deja de garantizar que las altas estén en
 * la primera página), así que ante la duda se manda sin orden.
 */
export function elegirSortReciente(disponibles) {
  const lista = Array.isArray(disponibles) ? disponibles : []
  const hit = lista.find((s) => /date/i.test(String(s?.id ?? '')) && /desc/i.test(String(s?.id ?? '')))
    ?? lista.find((s) => /date/i.test(String(s?.id ?? '')))
  return hit?.id ? String(hit.id) : null
}

/**
 * Mapea un ítem de `/sites/MLC/search` a la forma de anuncio del scraper — la
 * misma que produce `mapPolycard` desde el HTML. Puro y exportado para test.
 *
 * De todos estos campos, el discovery solo usa `external_id`, `source_url` e
 * `is_development`: el resto de la ficha lo baja después el worker de detalle,
 * que lee la página del anuncio (que NO está bloqueada). Se mapean igualmente
 * porque salen gratis y hacen comparables las dos fuentes cuando haya que
 * cuadrar números.
 */
export function mapItemMl(item) {
  if (!item?.id) return null

  // La API devuelve el id sin guion ("MLC1234567890"); el resto del scraper y la
  // URL de ficha usan "MLC-<n>". Misma normalización que mapPolycard, y por el
  // mismo motivo: un external_id con otro formato duplica el anuncio entero.
  const external_id = String(item.id).replace(/^MLC-?/, 'MLC-')
  const source_url = item.permalink
    ? String(item.permalink)
    : `https://www.portalinmobiliario.com/${external_id}`

  const atributos = new Map()
  for (const a of Array.isArray(item.attributes) ? item.attributes : []) {
    if (a?.id) atributos.set(String(a.id), a)
  }
  const numero = (...ids) => {
    for (const id of ids) {
      const a = atributos.get(id)
      const n = Number(a?.value_struct?.number ?? a?.value_name)
      if (Number.isFinite(n)) return n
    }
    return null
  }
  const texto = (id) => {
    const v = atributos.get(id)?.value_name
    return v ? String(v) : null
  }

  const dominio = String(item.domain_id ?? '')
  const operation = /FOR_RENT|_RENT$/i.test(dominio) ? 'rent'
    : /FOR_SALE|_SALE$/i.test(dominio) ? 'sale'
    : (fold(texto('OPERATION') ?? '').startsWith('arriendo') ? 'rent'
      : fold(texto('OPERATION') ?? '').startsWith('venta') ? 'sale' : null)
  const property_type = /APARTMENT/i.test(dominio) ? 'departamento'
    : /HOUSE/i.test(dominio) ? 'casa'
    : (texto('PROPERTY_TYPE') ? fold(texto('PROPERTY_TYPE')) : null)

  const location = item.location ?? item.address ?? {}
  const comuna = location.city?.name ?? location.city_name ?? null
  const region = location.state?.name ?? location.state_name ?? null

  return {
    external_id,
    source_url,
    title: item.title ? String(item.title) : null,
    operation,
    property_type,
    // Proyectos en obra: el plan cubre primero propiedades USADAS, así que el
    // discovery los filtra. Se marcan igual que en el HTML, por el dominio.
    is_development: /DEVELOPMENT/i.test(dominio),
    price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    // "CLF" es el código ISO 4217 de la UF; el resto del scraper la llama "UF".
    currency: item.currency_id === 'CLF' ? 'UF' : (item.currency_id ?? 'CLP'),
    price_from: false,
    bedrooms: numero('BEDROOMS', 'ROOMS'),
    bathrooms: numero('FULL_BATHROOMS', 'BATHROOMS'),
    square_meters: numero('COVERED_AREA', 'TOTAL_AREA'),
    location_text: [comuna, region].filter(Boolean).join(', ') || null,
    advertiser_name: item.seller?.nickname ? String(item.seller.nickname) : null,
    // El listado no distingue de forma fiable particular vs profesional: eso se
    // resuelve en la ficha (parseDetailPage, vía seller_type). Igual que en HTML.
    advertiser_type: 'unknown',
  }
}

/**
 * Traduce los nombres del objetivo (región, comuna, operación, tipo) a los ids
 * opacos que la API pide como filtros, preguntándoselos a la propia API.
 *
 * No se hardcodean: son ids como `TUxDQ0xBUzc0OTBa` que Mercado Libre puede
 * cambiar y que, escritos a mano, fallarían en silencio devolviendo la comuna
 * equivocada. Preguntarlos cuesta dos o tres peticiones la PRIMERA vez de cada
 * combinación y cero el resto del proceso (caché en memoria, como los circuitos).
 */
export function crearResolutorMl({ buscar = searchListings, estados = getEstadosCl, ciudades = getCiudadesEstado } = {}) {
  const cacheEstado = new Map()   // region folded → { ok, id } | { ok:false, reason }
  const cacheCiudad = new Map()   // `${estadoId}|comuna folded` → idem
  const cacheFiltro = new Map()   // clave de filtro → idem
  // El id de orden "más recientes" que la API declaró la última vez. Se aprende
  // de las búsquedas de resolución, que ya se hacen igualmente — no cuesta una
  // petición extra.
  let sortReciente = null

  async function estadoDe(region) {
    const clave = fold(String(region ?? ''))
    if (cacheEstado.has(clave)) return cacheEstado.get(clave)
    const res = await estados()
    let out
    if (!res.ok) {
      out = { ok: false, reason: `no se pudo listar las regiones de Chile: ${res.reason}` }
    } else {
      // "Región Metropolitana de Santiago" en nuestra base contra "Capital
      // Federal"/"Metropolitana de Santiago" en la de ML: se compara por la
      // palabra que identifica de verdad, no por la cadena entera.
      const lista = res.data?.states ?? []
      const hit = elegirPorNombre(lista, [region, String(region ?? '').replace(/^regi[oó]n\s+(de\s+)?/i, '')])
        ?? lista.find((s) => fold(String(s?.name ?? '')).includes(clave.replace(/^region\s+(de\s+)?/, '')))
      out = hit?.id
        ? { ok: true, id: hit.id }
        : { ok: false, reason: `Mercado Libre no reconoce la región "${region}"` }
    }
    // Un fallo de RED no se cachea: sería condenar la región hasta reiniciar el
    // worker por un timeout de un segundo. Solo se recuerda lo concluyente.
    if (out.ok || !/no se pudo/.test(out.reason)) cacheEstado.set(clave, out)
    return out
  }

  async function ciudadDe(estadoId, comuna) {
    const clave = `${estadoId}|${fold(String(comuna ?? ''))}`
    if (cacheCiudad.has(clave)) return cacheCiudad.get(clave)
    const res = await ciudades(estadoId)
    let out
    if (!res.ok) {
      out = { ok: false, reason: `no se pudieron listar las comunas de ${estadoId}: ${res.reason}` }
    } else {
      const hit = elegirPorNombre(res.data?.cities ?? [], [comuna])
      out = hit?.id
        ? { ok: true, id: hit.id }
        : { ok: false, reason: `Mercado Libre no reconoce la comuna "${comuna}" en ${estadoId}` }
    }
    if (out.ok || !/no se pudieron/.test(out.reason)) cacheCiudad.set(clave, out)
    return out
  }

  /**
   * Id del valor de un filtro (`OPERATION`, `PROPERTY_TYPE`) cuyo nombre casa con
   * `candidatos`. Se obtiene de `available_filters` de una búsqueda real con los
   * filtros que ya tengamos resueltos: es la propia API la que dice qué valores
   * existen para ese recorte.
   */
  async function valorFiltro(nombreFiltro, candidatos, filtrosBase) {
    const clave = `${nombreFiltro}|${candidatos[0]}|${JSON.stringify(filtrosBase)}`
    if (cacheFiltro.has(clave)) return cacheFiltro.get(clave)
    // limit=0: solo interesan los filtros disponibles y el total, no los ítems.
    const res = await buscar({ filtros: filtrosBase, limit: 1, offset: 0 })
    let out
    if (!res.ok) {
      out = { ok: false, reason: `no se pudo leer los filtros de ${nombreFiltro}: ${res.reason}` }
    } else {
      sortReciente = elegirSortReciente(res.data?.available_sorts) ?? sortReciente
      const disponibles = res.data?.available_filters ?? []
      const aplicados = res.data?.filters ?? []
      const filtro = [...disponibles, ...aplicados].find((f) => String(f?.id) === nombreFiltro)
      const hit = elegirPorNombre(filtro?.values ?? [], candidatos)
      out = hit?.id
        ? { ok: true, id: hit.id }
        : { ok: false, reason: `Mercado Libre no ofrece "${candidatos[0]}" en el filtro ${nombreFiltro}` }
    }
    if (out.ok || !/no se pudo leer/.test(out.reason)) cacheFiltro.set(clave, out)
    return out
  }

  /**
   * Filtros completos para un objetivo, o el motivo por el que no se pudieron
   * resolver. `{ ok: true, filtros }`.
   */
  return async function filtrosDe(target) {
    const estado = await estadoDe(target.region)
    if (!estado.ok) return estado
    const ciudad = await ciudadDe(estado.id, target.comuna_name)
    if (!ciudad.ok) return ciudad

    const base = { state: estado.id, city: ciudad.id }
    const operacion = await valorFiltro('OPERATION', NOMBRES_OPERACION[target.operation] ?? [target.operation], base)
    if (!operacion.ok) return operacion

    const conOperacion = { ...base, OPERATION: operacion.id }
    const tipoNombres = NOMBRES_TIPO[fold(String(target.property_type ?? ''))] ?? [target.property_type]
    const tipo = await valorFiltro('PROPERTY_TYPE', tipoNombres, conOperacion)
    // Un tipo que la comuna no ofrece NO es un fallo: significa que ahí no hay
    // inventario de ese tipo. Se barre sin ese filtro y el propio total (0) lo
    // dice; abortar aquí dejaría el objetivo "fallando" para siempre.
    if (!tipo.ok) return { ok: true, filtros: conOperacion, sort: sortReciente, sinTipo: tipo.reason }
    return { ok: true, filtros: { ...conOperacion, PROPERTY_TYPE: tipo.id }, sort: sortReciente }
  }
}

/**
 * Fuente que lee el listado por la API oficial de Mercado Libre.
 *
 * Devuelve `resultsLimit: 1000` porque ese es el tope duro de la API
 * (`offset + limit ≤ 1000`). El discovery ya sabe qué hacer con un tope: bisecar
 * por bandas de precio hasta que cada banda quepa debajo — la misma maquinaria
 * que usa contra el tope de ~2000 del HTML, sin tocarla.
 */
export function fuenteApiMl({ buscar = searchListings, resolutor = null, permiteBajas = null } = {}) {
  const filtrosDe = resolutor ?? crearResolutorMl({ buscar })

  return {
    nombre: 'api-ml',
    tamanoPagina: PAGINA_API,
    permiteBajas: permiteBajas ?? apiMlPuedeDarDeBaja(),
    async pedirPagina({ target, offset = 0, priceRange = null, sortRecent = true }) {
      // Pedir más allá del tope es un 400 de la API. Se devuelve como página
      // vacía —que para el discovery significa "fin de resultados"— en vez de
      // como fallo: no es un error, es el borde de lo que esta vía deja leer, y
      // el contraste de cobertura ya se encarga de marcar el barrido incompleto
      // (que es lo que impide dar de baja lo no visto). Va ANTES de resolver los
      // filtros porque una página que no se va a pedir tampoco necesita saber
      // por qué comuna preguntar.
      if (offset >= TOPE_OFFSET_ML) {
        return { ok: true, listings: [], meta: { total: null, pageCount: null, resultsLimit: TOPE_OFFSET_ML } }
      }

      const resueltos = await filtrosDe(target)
      if (!resueltos.ok) return { ok: false, status: 0, reason: resueltos.reason }

      const filtros = { ...resueltos.filtros }
      const precio = filtroPrecioMl(priceRange)
      if (precio) filtros.price = precio

      const res = await buscar({
        filtros,
        limit: Math.min(PAGINA_API, TOPE_OFFSET_ML - offset),
        offset,
        // "Más recientes" primero: es lo que hace que las altas estén siempre en
        // la primera página y que el barrido de cabecera valga para algo. El id
        // exacto lo dice la propia API (ver elegirSortReciente); si no ofrece
        // ninguno por fecha se va sin orden, que es preferible a un 400.
        sort: sortRecent ? (resueltos.sort ?? null) : null,
      })
      if (!res.ok) return { ok: false, status: res.status, reason: `API Mercado Libre: ${res.reason}` }

      const listings = []
      for (const item of res.data?.results ?? []) {
        const m = mapItemMl(item)
        if (m) listings.push(m)
      }

      const total = Number.isFinite(Number(res.data?.paging?.total)) ? Number(res.data.paging.total) : null
      return {
        ok: true,
        listings,
        meta: {
          total,
          pageCount: total != null ? Math.ceil(Math.min(total, TOPE_OFFSET_ML) / PAGINA_API) : null,
          resultsLimit: TOPE_OFFSET_ML,
        },
      }
    },
  }
}

// ─── Elección y respaldo ─────────────────────────────────────────────────────

/**
 * Fuente con RESPALDO: intenta la primera y, si no consigue la página, repite
 * por la segunda.
 *
 * Es lo que hace que activar la API no pueda empeorar nada: si las credenciales
 * caducan, si ML cambia un id de filtro o si la búsqueda devuelve un error, el
 * barrido no se para — vuelve por el HTML, que es exactamente donde estaba antes
 * de este cambio. Y al revés: mientras el HTML esté bloqueado, la API responde y
 * el respaldo nunca llega a usarse.
 *
 * `permiteBajas` es el del PRIMARIO: la decisión de dar de baja depende de con
 * qué catálogo se comparó lo visto, y si el barrido lo lideró la API, el total
 * contra el que se contrastó es el suyo.
 */
export function fuenteConRespaldo(primaria, respaldo, { avisar = console.warn } = {}) {
  if (!respaldo) return primaria
  return {
    nombre: `${primaria.nombre}+${respaldo.nombre}`,
    tamanoPagina: primaria.tamanoPagina,
    permiteBajas: primaria.permiteBajas,
    async pedirPagina(peticion) {
      const r = await primaria.pedirPagina(peticion)
      if (r.ok) return r
      avisar(`[fuente] ${primaria.nombre} no sirvió la página (${r.reason}) → se reintenta por ${respaldo.nombre}`)
      const alternativa = await respaldo.pedirPagina(peticion)
      // El respaldo pagina de otra manera (48 vs 50 por página). Se avisa de qué
      // fuente vino cada página para que quien lea el resultado no mezcle
      // tamaños al calcular desplazamientos.
      return alternativa.ok ? { ...alternativa, via: respaldo.nombre } : r
    },
  }
}

/**
 * La fuente que toca según cómo esté configurada la instalación:
 *
 *   - con ML_CLIENT_ID/ML_CLIENT_SECRET → API oficial, con el HTML de respaldo.
 *   - sin ellas                          → HTML a secas, igual que siempre.
 *
 * `deps.html` es la fuente HTML ya construida por el llamador (es quien conoce
 * el formato de URL del portal).
 */
export function elegirFuente({ html, api = null, configurada = apiMlConfigurada, avisar = console.warn } = {}) {
  if (!configurada()) return html
  const principal = api ?? fuenteApiMl()
  return fuenteConRespaldo(principal, html, { avisar })
}
