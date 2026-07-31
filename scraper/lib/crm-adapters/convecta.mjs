// ─────────────────────────────────────────────────────────────────────────────
// crm-adapters/convecta.mjs — adaptador para webs de corredoras sobre Convecta
// (plan Anuncios CL · Fase 4 / H21).
// Verificado contra HTML/JSON real de magnoliaproperty.cl, elbarrio.cl y
// keyproperties.com (julio 2026).
//
// CORRECCIÓN sobre la versión anterior de este archivo, que asumía que el
// listado de Convecta "se carga por JS y por eso parseList devuelve []". El
// diagnóstico era erróneo en las dos mitades:
//
//   1) El listado NO es opaco: lo sirve un endpoint JSON público,
//      /recursos/publico.ashx?…listadoPropiedades, que devuelve el HTML de las
//      tarjetas YA RENDERIZADO más el total de fichas y el paginador. Es decir:
//      el inventario completo de la corredora es accesible sin navegador — 20
//      fichas por página y `numRegistros` diciendo cuántas hay en total.
//   2) Los enlaces a ficha SÍ estaban en el HTML estático de la portada, pero
//      como rutas numéricas desnudas ("/12828"), que el heurístico genérico —el
//      que exige /propiedad|ficha|detalle/ en la URL— descartaba. Se recogían 4
//      de 9 enlaces por accidente, no por diseño.
//
// DOS DIALECTOS. La misma plataforma expone el endpoint con dos juegos de
// nombres de parámetro según la versión instalada:
//   · corto (elbarrio.cl, keyproperties.com): ac=  op  tp  co  or  pa  pd  ph …
//   · largo (magnoliaproperty.cl):            acci= oper tpro comu orde pagi …
// En vez de detectar la versión por dominio (un dato más que mantener, y que se
// desincroniza cuando el proveedor actualiza a un cliente), se manda UN
// querystring con AMBOS juegos: cada backend lee los suyos e ignora el resto.
// Verificado: los tres dominios responden correctamente a la misma URL.
// El dialecto largo exige que las claves vacías VENGAN presentes (orde, pred,
// preh, tlis…); omitirlas devuelve [{"error":"si"}]. Por eso se emiten siempre.
//
// FICHA. La ruta corta "/<código>" NO es universal: en keyproperties.com
// devuelve 500. La que funciona en los tres es /fichaPropiedad.aspx?i=<código>,
// así que es la canónica.
// ─────────────────────────────────────────────────────────────────────────────
import { load } from 'cheerio'
import { clean, cleanPhotos, parsePropertyType, parseSmallInt, siteBase } from './index.mjs'
import { normalizeDomain } from '../detect-corredora-crm-cl.mjs'

export const platform = 'convecta'

// El listado llega como JSON, no como HTML: el crawler no debe pasarlo por un
// parser de DOM antes de dárnoslo.
export const listIsJson = true
// Fichas por página que devuelve el endpoint. Sirve para deducir cuántas
// páginas pedir a partir de `total`, sin depender de la ventana del paginador.
export const pageSize = 20

// Códigos de operación del endpoint: 0 = venta y arriendo, 1 = venta, 2 = arriendo.
const OPERATION_CODE = { sale: '1', rent: '2' }

/**
 * URL del listado (endpoint JSON). `operation` ausente = todas las operaciones.
 *
 * Los parámetros van duplicados a propósito (dialecto corto + largo, ver
 * cabecera). `cache` es el cache-buster que manda el propio front de Convecta;
 * se replica para no comer respuestas cacheadas por intermediarios.
 */
export function listUrl(domain, { operation, page = 1, baseUrl } = {}) {
  const op = OPERATION_CODE[operation] ?? '0'
  const pa = String(Math.max(1, Number(page) || 1))
  const params = new URLSearchParams({
    // acción (ambos dialectos)
    ac: 'listadoPropiedades',
    acci: 'listadoPropiedades',
    // operación
    op, oper: op,
    // tipo de propiedad (0 = todos)
    tp: '0', tpro: '0',
    // comuna / región (0 = todas)
    co: '0', comu: '0', regi: '0',
    // orden (vacío = el que trae el sitio por defecto)
    or: '', orde: '',
    // página
    pa, pagi: pa,
    // rango de precio (vacío = sin filtro)
    pd: '', pred: '', ph: '', preh: '',
    // dormitorios / baños (0 = sin filtro)
    do: '0', dorm: '0', bn: '0', bath: '0',
    // divisa: 1 = UF, que es como publica el sitio
    div: '1', divi: '1',
    // tipo de listado y sector (vacíos = todos)
    tl: '', tlis: '', sect: '0',
    leng: 'es',
    cache: String(Math.random() * 10),
  })
  return `${siteBase(domain, baseUrl)}/recursos/publico.ashx?${params.toString()}`
}

/** URL canónica de la ficha. Funciona en los tres dominios verificados. */
export function detailUrl(domain, ref, { baseUrl } = {}) {
  return `${siteBase(domain, baseUrl)}/fichaPropiedad.aspx?i=${encodeURIComponent(ref)}`
}

/**
 * Total de fichas que declara el buscador. El dialecto corto devuelve el número
 * pelado ("668"); el largo, HTML ("<span…>1.116 Propiedades</span> Encontradas").
 * Se limpian tags y separadores de miles y se toma el primer número.
 */
function parseDeclaredTotal(numRegistros) {
  const text = clean(String(numRegistros ?? '').replace(/<[^>]+>/g, ' '))
  const m = text.match(/(\d[\d.]*)/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Última página según el paginador. El dialecto corto marca las páginas con
 * rel='N' y el largo con data-pagina='N'; en ambos el número más alto es la
 * última (el botón "Última" apunta ahí). Es una VENTANA deslizante: en la
 * página 1 solo se ven las primeras, por eso manda `total`/pageSize y esto es
 * el respaldo cuando el total no viene.
 */
function parseLastPage(paginador) {
  const nums = [...String(paginador ?? '').matchAll(/(?:rel|data-pagina)=['"](\d+)['"]/g)]
    .map((m) => Number(m[1]))
    .filter(Number.isFinite)
  return nums.length ? Math.max(...nums) : null
}

/**
 * Parsea una página del listado.
 *
 * @param {string|object} body Cuerpo JSON tal cual lo devuelve el endpoint.
 * @returns {{ items: Array<{url:string, seller_reference:string}>, total: number|null, lastPage: number|null }}
 */
export function parseList(body, { domain = '', baseUrl } = {}) {
  const empty = { items: [], total: null, lastPage: null }
  if (!body) return empty

  let payload
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body
  } catch {
    // Respuesta no-JSON (error del sitio, HTML de mantenimiento…): sin fichas,
    // pero sin romper el crawl.
    return empty
  }
  const node = Array.isArray(payload) ? payload[0] : payload
  // El backend responde [{"error":"si"}] cuando falta algún parámetro del
  // dialecto largo. Se trata como página vacía, no como excepción.
  if (!node || typeof node !== 'object' || !node.listing) return empty

  // Los códigos aparecen de dos formas según la plantilla de la instalación:
  // data-id='12828' (elbarrio, keyproperties) o href='/8812?leng=es' (magnolia).
  // Se recogen ambas: son el MISMO código interno de la corredora.
  const html = String(node.listing)
  const refs = new Set()
  for (const m of html.matchAll(/data-id=['"](\d{2,9})['"]/g)) refs.add(m[1])
  for (const m of html.matchAll(/href=['"]\/(\d{2,9})(?:[?#][^'"]*)?['"]/g)) refs.add(m[1])

  return {
    items: [...refs].map((ref) => ({
      url: detailUrl(domain, ref, { baseUrl }),
      seller_reference: ref,
    })),
    total: parseDeclaredTotal(node.numRegistros),
    lastPage: parseLastPage(node.paginador),
  }
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

/**
 * Indexa el bloque "Detalles" por etiqueta normalizada, en vez de barrer el
 * texto plano con regex sueltas: en el texto corrido "Código: 12.828" queda
 * pegado a "M2 Constr.: 393" y los patrones se pisan entre sí — así es como el
 * parser genérico sacaba bedrooms=2 de una ficha de 4 dormitorios.
 *
 * Convecta sirve el bloque con DOS maquetados según la plantilla del cliente, y
 * los dos hay que soportarlos porque conviven entre dominios activos:
 *   · lista  (elbarrio.cl):        <li><strong>Etiqueta:</strong> valor</li>
 *   · tabla  (magnoliaproperty.cl): <td class="detail-title">Etiqueta</td><td>valor</td>
 * La tabla además se repite dos veces en la página (una versión escritorio y
 * otra móvil), así que se conserva la primera aparición de cada etiqueta.
 */
function parseDetailFields($) {
  const fields = new Map()

  const put = (rawLabel, rawValue) => {
    const label = clean(rawLabel).replace(/[:\s]+$/, '').toLowerCase()
    const value = clean(rawValue)
    // "-" es como la plantilla de tabla escribe "sin dato"; guardarlo haría que
    // un campo vacío pareciera relleno.
    if (!label || !value || value === '-') return
    // Con etiqueta repetida (Precio UF y Precio CLP van en el mismo <li>) se
    // conserva la primera y la segunda va a una clave con sufijo.
    if (fields.has(label)) {
      if (!fields.has(`${label}#2`)) fields.set(`${label}#2`, value)
    } else {
      fields.set(label, value)
    }
  }

  // Maquetado de lista.
  $('.detail-list li, .detail-block li').each((_, el) => {
    $(el).find('strong').each((__, s) => {
      // El valor es el texto que sigue a este <strong> hasta el siguiente.
      let value = ''
      let node = s.nextSibling
      while (node && !(node.type === 'tag' && node.name === 'strong')) {
        value += $(node).text() ?? ''
        node = node.nextSibling
      }
      put($(s).text(), value)
    })
  })

  // Maquetado de tabla: la etiqueta es un td.detail-title y el valor, el td
  // siguiente. Una misma <tr> encadena dos pares etiqueta/valor.
  $('table.detail-table td.detail-title, td.detail-title').each((_, el) => {
    put($(el).text(), $(el).next('td').text())
  })

  // Maquetado de "meta" (keyproperties.com): no hay pares etiqueta/valor sino
  // una tira de <span> donde el ICONO dice qué es el número.
  //   <span><i class='fa fa-object-group'></i>Cons. 183 M²</span>
  //   <span><i class='fa fa-bed'></i> 3</span>
  //   <span><i class='fa fa-bath'></i> 3 Baño/s</span>
  $('.property_meta span').each((_, el) => {
    const $s = $(el)
    const cls = $s.find('i').attr('class') || ''
    const text = clean($s.text())
    if (/fa-bed/.test(cls)) put('dormitorios', text)
    else if (/fa-bath/.test(cls)) put('baños', text)
    else if (/^cons/i.test(text)) put('m2 constr.', text.replace(/^cons\.?\s*/i, ''))
    else if (/^terreno/i.test(text)) put('m2 terreno', text.replace(/^terreno\s*/i, ''))
  })

  // Precio y operación de esa misma plantilla, que los saca del bloque de
  // detalles y los pone sobre la foto:
  //   <div class='estadoAV'><span class='spanEAV'>Venta</span>
  //                         <span class='precioEAV'>UF 1,09/m2</span></div>
  // El selector va ANCLADO a .estadoAV: la clase .spanEAV se reutiliza antes en
  // la página para el badge del código ("COD: 10.886"), así que sin anclar la
  // operación se leía como un campo llamado "cod: 10.886" y la ficha se
  // guardaba sin precio.
  const $estado = $('.estadoAV').first()
  const precioEAV = clean($estado.find('.precioEAV').first().text())
  const estadoEAV = clean($estado.find('.spanEAV').first().text())
  if (precioEAV && estadoEAV) put(estadoEAV, precioEAV)
  // El badge del código de esa misma plantilla, que no tiene bloque "Detalles".
  const codBadge = clean($('.cont__dirWeb .spanEAV').first().text())
  if (/cod/i.test(codBadge)) put('código', codBadge.replace(/^\s*cod\.?\s*:?\s*/i, ''))

  return fields
}

/** Primer valor no vacío entre varias etiquetas equivalentes. */
function pick(fields, ...labels) {
  for (const l of labels) {
    const v = fields.get(l)
    if (v) return v
  }
  return ''
}

/** "UF 28.300" | "UF 9,50" → 28300 | 9.5. Punto = miles, coma = decimal. */
function parseUf(text) {
  const t = clean(text)
  if (!/uf/i.test(t)) return null
  const m = t.match(/uf\s*([\d.]+(?:,\d+)?)/i)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Precio unitario de un "UF 3,30/m2". Aquí la coma SIEMPRE es decimal y no hay
 * separador de miles que valga: los precios por metro son de un dígito o dos.
 */
function parseUnitPrice(text) {
  const m = clean(text).match(/uf\s*(\d+(?:[.,]\d+)?)\s*\/\s*m/i)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** "$ 1.155.907.557" → 1155907557. */
function parseClp(text) {
  const m = clean(text).match(/\$\s*([\d.]+)/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * "393 M2" | "984,68 M2" → 393 | 985 (entero, que es lo que guarda la tabla).
 *
 * La unidad se quita ANTES de buscar el número: la plantilla de tabla escribe
 * el "sin dato" como "- m<sup>2</sup>", y buscar el primer dígito sobre eso
 * devuelve el 2 de "m2" — una oficina sin terreno declarado acababa con un
 * terreno de 2 m².
 */
function parseM2(text) {
  const t = clean(text).replace(/\bm\s*(?:2|²)\b/gi, ' ')
  const m = t.match(/([\d.]+(?:,\d+)?)/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/**
 * Coordenadas exactas. La ficha las lleva en el onclick del tab de mapa:
 *   verMapaPropiedad('map','…/maps/embed/v1/place?key=…&q=-33.2777,-70.6257')
 * Es el único sitio del HTML donde aparecen, y son el dato que permite cruzar
 * la ficha contra el catastro (rol SII) sin geocodificar la dirección.
 */
function parseCoords(html) {
  const m = String(html).match(
    /maps\/embed\/v1\/(?:place\?[^'"]*?q=|streetview\?location=)(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/
  )
  if (!m) return { latitude: null, longitude: null }
  const lat = Number(m[1])
  const lng = Number(m[2])
  // Chile continental: descarta un (0,0) o unas coordenadas de otro país que
  // vendrían de una plantilla mal rellenada.
  if (!(lat >= -56 && lat <= -17 && lng >= -76 && lng <= -66)) {
    return { latitude: null, longitude: null }
  }
  return { latitude: lat, longitude: lng }
}

/**
 * Operación. El og:title la trae explícita en las dos plantillas ("Casa en
 * venta en Colina", "Arriendo - Oficina - UF 9,50"), y como respaldo la tabla
 * de detalle tiene filas separadas "Venta" y "Arriendo" de las que solo una
 * lleva precio.
 *
 * Cuando la ficha está publicada en venta Y en arriendo a la vez —las hay—
 * manda venta, que es la operación con la que se capta.
 */
function parseOperationFromTitle(title, fields) {
  const t = clean(title).toLowerCase()
  if (/\bventa\b|vende/.test(t)) return 'sale'
  if (/arriend|arrend/.test(t)) return 'rent'
  if (fields.has('venta') || fields.has('precio')) return 'sale'
  if (fields.has('arriendo')) return 'rent'
  return null
}

/**
 * Comuna desde el título. Los dos formatos la ponen al final tras "en"
 * ("Casa en venta en Colina", "Oficina en Vitacura"), así que hay que quedarse
 * con el ÚLTIMO "en": anclar al final sin más devuelve "venta en Colina",
 * porque la clase de caracteres admite espacios y se traga el tramo entero.
 */
function parseComunaFromTitle(title) {
  const t = clean(title)
  if (!t) return null
  const m = t.match(/^.*\ben\s+([A-Za-zÁÉÍÓÚÑÜáéíóúñü]+(?:\s+[A-Za-zÁÉÍÓÚÑÜáéíóúñü]+){0,2})\s*$/i)
  return m ? m[1].trim() : null
}

/**
 * Ficha de Convecta ya normalizada para upsertListingCl.
 *
 * @param {string} html
 * @param {{ url?: string, domain?: string, seller_reference?: string }} ctx
 */
export function parseDetail(html, { url = '', domain = '', seller_reference = null } = {}) {
  if (!html) return null
  const $ = load(html)
  const fields = parseDetailFields($)

  const title = clean($('meta[property="og:title"]').attr('content'))
  const ogDesc = clean($('meta[property="og:description"]').attr('content'))

  // Código interno: la etiqueta "Código: 12.828" lleva separador de miles, que
  // NO forma parte del código — hay que quitarlo o el enlace determinista de
  // Nivel 1.5 compara "12.828" contra "12828" y no casa nunca.
  const refFromUrl =
    String(url).match(/[?&]i=(\d{2,9})/)?.[1] ?? String(url).match(/\/(\d{2,9})(?:[?#]|$)/)?.[1] ?? null
  const ref =
    clean(pick(fields, 'código', 'codigo', 'cod.', 'cod')).replace(/\D/g, '') || seller_reference || refFromUrl
  if (!ref) return null

  // El precio vive bajo "Precio" (plantilla de lista), bajo la fila de su
  // operación (tabla: "Venta" / "Arriendo") o en .precioEAV (plantilla meta).
  const precioRaw = pick(fields, 'precio', 'venta', 'arriendo')

  // PRECIO POR METRO CUADRADO. Los terrenos se publican muy a menudo como
  // "UF 3,30/m2" o "UF 1,09/m2" — un precio UNITARIO, no el total. Guardarlo en
  // la columna de precio metería un sitio de 5.100 m² como si costara UF 3,30 y
  // ese número entraría en las medias de mercado, en los filtros de rango y en
  // el dedup sin que nadie lo mire dos veces (un terreno "de UF 3" al lado de
  // casas de UF 30.000 no llama la atención de nadie: simplemente ensucia).
  //
  // Se deja el precio en NULL y el dato se conserva en features, con el total
  // calculado aparte y marcado como derivado. Preferimos "sin precio" —que se
  // ve y se puede revisar— antes que un total que el vendedor nunca publicó
  // presentado como si lo hubiera hecho.
  const esPorM2 = /\/\s*m\s*(?:2|²)/i.test(precioRaw)
  const priceUf = esPorM2 ? null : (parseUf(precioRaw) ?? parseUf(title))
  // El CLP puede venir en un segundo "Precio" (lista) o pegado al UF en la
  // misma celda (tabla: "UF 9,50 $ 388.025").
  const priceClp = esPorM2 ? null : (parseClp(pick(fields, 'precio#2')) ?? parseClp(precioRaw))

  const bedrooms = parseSmallInt(pick(fields, 'dormitorios', 'dormitorio'))
  const bathrooms = parseSmallInt(pick(fields, 'baños', 'banos', 'baño', 'bano'))
  const builtM2 = parseM2(
    pick(fields, 'm2 constr.', 'm2 constr', 'm2 construidos', 'sup. útil', 'sup. util', 'sup útil')
  )
  const landM2 = parseM2(pick(fields, 'm2 terreno', 'sup. total', 'sup total'))

  // Fotos a resolución completa: el <a data-fancybox> apunta al original y el
  // <img> del carrusel a la versión escalada. Se prefiere el enlace, y solo se
  // cae a los <img> de galería/lightbox si la ficha no monta fancybox (que es
  // el caso de la plantilla de tabla).
  const photoUrls = []
  $('a[data-fancybox][href]').each((_, el) => photoUrls.push($(el).attr('href')))
  if (photoUrls.length === 0) {
    $('#lightbox-slider img[src], .gallery-item img[src], .slideshow-nav img[src], .item-thumb img[src]')
      .each((_, el) => photoUrls.push($(el).attr('src')))
  }
  photoUrls.push($('meta[property="og:image"]').attr('content'))
  const photos = cleanPhotos(photoUrls.filter(Boolean))

  const features = []
  $('.detail-features .list-features li, ul.list-features li, ul.caracteristicas-add li').each((_, el) => {
    const f = clean($(el).text())
    if (f) features.push(f)
  })
  for (const [etiqueta, ...labels] of [
    ['Gastos comunes', 'gastos comunes', 'g. comunes'],
    ['Contribuciones', 'contribuciones'],
    ['Estacionamientos', 'estac. cubiertos', 'estacionamientos'],
  ]) {
    const v = pick(fields, ...labels)
    if (v) features.push(`${etiqueta}: ${v}`)
  }
  if (landM2) features.push(`Terreno: ${landM2} m²`)
  if (esPorM2) {
    features.push(`Precio unitario: ${precioRaw}`)
    const unitario = parseUnitPrice(precioRaw)
    if (unitario != null && landM2) {
      // Marcado como estimado a propósito: es aritmética nuestra sobre dos
      // datos del sitio, no una cifra que la corredora haya publicado.
      const total = Math.round(unitario * landM2)
      features.push(`Precio total estimado: UF ${total.toLocaleString('es-CL')} (${unitario} × ${landM2} m²)`)
    }
  }

  const video = clean($('.property-video iframe').attr('src') || $('iframe[src*="youtube" i]').attr('src')) || null
  const description =
    clean($('.property-description p').first().text()) ||
    clean($('.property-description .article-body p').first().text()) ||
    clean($('.info__ficha p.p-font-15').first().text()) ||
    ogDesc ||
    null

  // Comuna: el og:title la lleva en la plantilla de lista ("Casa en venta en
  // Colina"); en la de tabla el título es "Arriendo - Oficina - UF 9,50" y la
  // comuna está en el h2 de la ficha ("Oficina en Vitacura").
  const comuna =
    parseComunaFromTitle(title) ||
    parseComunaFromTitle(clean($('.property-title').first().text())) ||
    clean($('.property-location').first().text()) ||
    null

  const { latitude, longitude } = parseCoords(html)
  const d = normalizeDomain(domain) || normalizeDomain(url)

  return {
    portal: `web:${d}`,
    source_type: 'agency_web',
    external_id: `${d}:${ref}`,
    source_url: url || null,
    operation: parseOperationFromTitle(title, fields),
    property_type:
      parsePropertyType(pick(fields, 'tipo')) ||
      parsePropertyType(title) ||
      parsePropertyType(clean($('.property-title').first().text())),
    advertiser_type: 'professional',
    advertiser_name: null,
    phone: null,
    price: priceClp,
    price_uf: priceUf,
    currency: priceUf != null ? 'UF' : 'CLP',
    bedrooms,
    bathrooms,
    square_meters: builtM2,
    comuna,
    address: clean($('.property-address, .item-address').first().text()) || null,
    latitude,
    longitude,
    description,
    photos,
    photos_total_count: photos.length || null,
    features,
    has_video: Boolean(video),
    video_modal_url: video,
    property_code: null,
    advertiser_id: null,
    seller_reference: ref,
    crm_platform: platform,
  }
}
