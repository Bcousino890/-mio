// Tests de los adaptadores CRM (crm-adapters/ · Fase 4 / H21).
//
// Correr:  node --test scraper/lib/crm-adapters/crm-adapters.test.mjs
//
// Las fixturas NO son HTML inventado: son recortes literales del markup de
// cympropiedades.cl, elbarrio.cl, magnoliaproperty.cl y de la API de
// ppartnersgroup.com, con los valores reales de fichas concretas. La versión
// anterior de estos tests pasaba en verde contra fixturas inventadas mientras
// los parsers devolvían basura contra los sitios de verdad (el código interno
// truncado a "12", 2 dormitorios en una casa de 4, la comuna leída como "s
// Comuna"), así que las aserciones van contra lo que el sitio publica de hecho.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAdapter, SUPPORTED_PLATFORMS, cleanPhotos, parsePropertyType, siteBase } from './index.mjs'
import * as convecta from './convecta.mjs'
import * as ofinet from './ofinet.mjs'
import * as konnect from './konnect.mjs'

// ── Registro ─────────────────────────────────────────────────────────────────

test('getAdapter devuelve el adaptador soportado o null', () => {
  assert.equal(getAdapter('convecta').platform, 'convecta')
  assert.equal(getAdapter('ofinet').platform, 'ofinet')
  assert.equal(getAdapter('konnect').platform, 'konnect')
  assert.equal(getAdapter('other'), null)
  assert.equal(getAdapter('unknown'), null)
  assert.deepEqual([...SUPPORTED_PLATFORMS].sort(), ['convecta', 'konnect', 'ofinet'])
})

// ── Helpers ──────────────────────────────────────────────────────────────────

test('siteBase respeta base_url y solo deriva el dominio si falta', () => {
  // ppartnersgroup.com: www. redirige a la portada en inglés, por eso el target
  // guarda la base sin www. y el helper NO debe reinventarla.
  assert.equal(siteBase('ppartnersgroup.com', 'https://ppartnersgroup.com'), 'https://ppartnersgroup.com')
  assert.equal(siteBase('ppartnersgroup.com', 'https://ppartnersgroup.com/'), 'https://ppartnersgroup.com')
  assert.equal(siteBase('elbarrio.cl', null), 'https://www.elbarrio.cl')
  // Una base_url basura no debe colarse: se cae a la convención.
  assert.equal(siteBase('elbarrio.cl', 'no-es-una-url'), 'https://www.elbarrio.cl')
})

test('cleanPhotos deduplica la misma foto escrita de varias formas', () => {
  // Las tres primeras son la MISMA imagen: barra doble en la ruta (galería de
  // elbarrio) y token SAS del blob de Azure (galería de magnolia).
  const out = cleanPhotos([
    'https://cdn.prop360.cl//x/img/1.jpg?sv=2021&sig=abc',
    'https://cdn.prop360.cl/x/img/1.jpg',
    'https://cdn.prop360.cl//x/img/1.jpg',
    'https://cdn.prop360.cl/x/img/2.png',
    'https://cdn.prop360.cl/x/script.js',
    '/relativa/3.jpg',
  ])
  assert.deepEqual(out, ['https://cdn.prop360.cl//x/img/1.jpg?sv=2021&sig=abc', 'https://cdn.prop360.cl/x/img/2.png'])
})

test('parsePropertyType normaliza el vocabulario', () => {
  assert.equal(parsePropertyType('Linda Casa en Las Condes'), 'casa')
  assert.equal(parsePropertyType('Depto amoblado'), 'departamento')
  assert.equal(parsePropertyType('Oficina'), 'oficina')
  assert.equal(parsePropertyType('sin categoría'), null)
})

// ── Convecta ─────────────────────────────────────────────────────────────────

test('Convecta.listUrl manda los dos dialectos en el mismo querystring', () => {
  const u = convecta.listUrl('elbarrio.cl', { operation: 'sale', page: 3 })
  assert.match(u, /^https:\/\/www\.elbarrio\.cl\/recursos\/publico\.ashx\?/)
  // Dialecto corto (elbarrio, keyproperties) y largo (magnolia) a la vez.
  assert.match(u, /ac=listadoPropiedades/)
  assert.match(u, /acci=listadoPropiedades/)
  assert.match(u, /(^|&)op=1(&|$)/)
  assert.match(u, /(^|&)oper=1(&|$)/)
  assert.match(u, /(^|&)pa=3(&|$)/)
  assert.match(u, /(^|&)pagi=3(&|$)/)
  // El dialecto largo devuelve {"error":"si"} si estas claves no VIENEN, aunque
  // vayan vacías. Su presencia es parte del contrato, no relleno.
  for (const k of ['orde', 'pred', 'preh', 'tlis']) assert.match(u, new RegExp(`(^|&)${k}=(&|$)`))
  assert.match(convecta.listUrl('elbarrio.cl', { operation: 'rent' }), /(^|&)op=2(&|$)/)
  assert.match(convecta.listUrl('elbarrio.cl', {}), /(^|&)op=0(&|$)/)
})

test('Convecta.detailUrl usa la ruta que funciona en los tres dominios', () => {
  // "/<código>" da 500 en keyproperties.com; fichaPropiedad.aspx responde en los tres.
  assert.equal(
    convecta.detailUrl('keyproperties.com', '11701', { baseUrl: 'https://keyproperties.com' }),
    'https://keyproperties.com/fichaPropiedad.aspx?i=11701'
  )
})

// Recorte literal de /recursos/publico.ashx de elbarrio.cl (dialecto corto):
// el código va en data-id, numRegistros es un número pelado y el paginador
// marca las páginas con rel='N'.
const CONVECTA_LISTADO_CORTO = JSON.stringify([{
  listing:
    "<div class='item-wrap'><a href='/16732' class='irFicha' data-id='16732'>" +
    "<img src='https://demoazimg.prop360.cl//elbarrio/img/propiedades/16732_x.jpg'></a></div>" +
    "<div class='item-wrap'><a href='/12828' class='irFicha' data-id='12828'>Casa</a></div>",
  paginador: "<li class='active'><a href='#'>1</a></li><li rel='2'><a href='#'>2</a></li><li rel='34'><a href='#'>34</a></li>",
  numRegistros: '668',
  title: '668 Propiedades en venta y arriendo en todas las comunas ',
}])

// Recorte de magnoliaproperty.cl (dialecto largo): SIN data-id — el código solo
// está en el href— y numRegistros viene envuelto en HTML con separador de miles.
const CONVECTA_LISTADO_LARGO = JSON.stringify([{
  listing: "<div class='item-wrap'><a href='/8812?leng=es' class='imgThumb'><img alt='8812'></a></div>",
  paginador: "<li class='active'><a href='#'>1</a></li><li data-pagina='2'><a href='#'>2</a></li>" +
    "<li class='next' data-pagina='56'><a title='Última' href='#'></a></li>",
  numRegistros: "<span class='caption-subject'>1.116 Propiedades</span> <span class='caption-helper'>Encontradas</span>",
  title: 'Propiedades en venta y arriendo en todas las comunas ',
}])

test('Convecta.parseList lee el código de data-id (dialecto corto)', () => {
  const r = convecta.parseList(CONVECTA_LISTADO_CORTO, { domain: 'elbarrio.cl' })
  assert.deepEqual(r.items.map((i) => i.seller_reference).sort(), ['12828', '16732'])
  assert.equal(r.items[0].url, 'https://www.elbarrio.cl/fichaPropiedad.aspx?i=16732')
  assert.equal(r.total, 668)
  assert.equal(r.lastPage, 34)
})

test('Convecta.parseList lee el código del href cuando no hay data-id (dialecto largo)', () => {
  const r = convecta.parseList(CONVECTA_LISTADO_LARGO, { domain: 'magnoliaproperty.cl' })
  assert.deepEqual(r.items.map((i) => i.seller_reference), ['8812'])
  // numRegistros con tags y separador de miles: 1.116, no 1.
  assert.equal(r.total, 1116)
  assert.equal(r.lastPage, 56)
})

test('Convecta.parseList trata la respuesta de error como página vacía', () => {
  // El backend del dialecto largo responde esto si falta un parámetro.
  assert.deepEqual(convecta.parseList('[{"error":"si"}]', { domain: 'magnoliaproperty.cl' }).items, [])
  assert.deepEqual(convecta.parseList('<html>mantenimiento</html>', { domain: 'x.cl' }).items, [])
  assert.deepEqual(convecta.parseList('', { domain: 'x.cl' }).items, [])
})

// Ficha de elbarrio.cl/12828 (plantilla de LISTA), valores reales.
const CONVECTA_FICHA_LISTA = `<!doctype html><html><head>
  <meta name="author" content="Convecta - Desarrollos Informaticos" />
  <meta property="og:title" content="Casa en venta en Colina" />
  <meta property="og:description" content="Condominio Los Bosques, Piedra Roja - 4D5B" />
  <meta property="og:image" content="https://demoazimg.prop360.cl/elbarrio/img/propiedades/12828_a.jpg" />
  </head><body>
  <div class='slideshow-nav'><div><img src='https://demoazimg.prop360.cl//elbarrio/img/propiedades/12828_a.jpg'></div></div>
  <div><a data-fancybox='gallery' href='https://demoazimg.prop360.cl//elbarrio/img/propiedades/12828_a.jpg'></a></div>
  <div><a data-fancybox='gallery' href='https://demoazimg.prop360.cl//elbarrio/img/propiedades/12828_b.jpg'></a></div>
  <li><a href='#map' onclick="javaScript:verMapaPropiedad('map','https://www.google.com/maps/embed/v1/place?key=AIza&amp;q=-33.2777328489578,-70.62578542541551');"></a></li>
  <div class='property-video'><iframe src="https://www.youtube.com/embed/vOE3Xb_raJk"></iframe></div>
  <div class='property-description'><p>CARACTERISTICAS: Espectacular casa mediterránea moderna.</p></div>
  <div class='detail-list detail-block'><div class='alert alert-info'><ul class='list-three-col'>
    <li><strong>Precio:</strong> UF 28.300<br /><strong>Precio:</strong> $ 1.155.907.557</li>
    <li><strong>Código:</strong> 12.828</li>
    <li><strong>M2 Constr.: </strong> 393 M2</li>
    <li><strong>M2 Terreno: </strong> 984,68 M2</li>
    <li><strong>Dormitorios: </strong> 4</li>
    <li><strong>Baños: </strong> 5 </li>
    <li><strong>Gastos comunes:</strong> $ 160.000</li>
    <li><strong>Estac. Cubiertos:</strong> 2</li>
  </ul></div></div>
  <div class='detail-features detail-block'><ul class='list-features'>
    <li><i class='fa fa-check icon'></i> Piscina</li>
    <li><i class='fa fa-check icon'></i> Bodega</li>
  </ul></div>
  </body></html>`

test('Convecta.parseDetail (plantilla de lista) extrae la ficha completa', () => {
  const l = convecta.parseDetail(CONVECTA_FICHA_LISTA, { url: 'https://www.elbarrio.cl/12828', domain: 'elbarrio.cl' })
  assert.ok(l)
  assert.equal(l.portal, 'web:elbarrio.cl')
  assert.equal(l.source_type, 'agency_web')
  // El separador de miles NO es parte del código: "12.828" → "12828". Si se
  // cuela, el enlace determinista Nivel 1.5 no casa nunca con el de PI.
  assert.equal(l.seller_reference, '12828')
  assert.equal(l.external_id, 'elbarrio.cl:12828')
  assert.equal(l.operation, 'sale')
  assert.equal(l.property_type, 'casa')
  assert.equal(l.price_uf, 28300)
  assert.equal(l.price, 1155907557)
  assert.equal(l.currency, 'UF')
  assert.equal(l.bedrooms, 4)
  assert.equal(l.bathrooms, 5)
  assert.equal(l.square_meters, 393)
  // "Casa en venta en Colina": la comuna es el ÚLTIMO "en …", no "venta en Colina".
  assert.equal(l.comuna, 'Colina')
  assert.equal(l.latitude, -33.2777328489578)
  assert.equal(l.longitude, -70.62578542541551)
  assert.equal(l.has_video, true)
  assert.ok(l.features.includes('Piscina'))
  assert.ok(l.features.includes('Terreno: 985 m²'))
  assert.ok(l.features.includes('Gastos comunes: $ 160.000'))
  // La foto _a aparece tres veces (fancybox con doble barra, slideshow, og:image).
  assert.equal(l.photos.length, 2)
  assert.equal(l.crm_platform, 'convecta')
})

// Ficha de magnoliaproperty.cl/8812 (plantilla de TABLA), valores reales.
const CONVECTA_FICHA_TABLA = `<!doctype html><html><head>
  <meta property="og:title" content="Arriendo - Oficina -  UF 9,50" />
  <meta property="og:description" content="AV kennedy y Gerónimo de Alderete - 1B - 25m2" />
  <meta property="og:image" content="https://demoazimg.prop360.cl/magnolia/img/propiedades/8812_v.jpeg" />
  </head><body>
  <h2 class='property-title'> Oficina en Vitacura </h2>
  <address class='property-address'><i class='fa fa-map-marker'></i> AV kennedy y Gerónimo de Alderete</address>
  <a href='#' class='gallery-item'><img alt='8812' src='https://demoazimg.prop360.cl/magnolia/img/propiedades/8812_v.jpeg?sv=2021&amp;sig=abc'></a>
  <a href='#' class='gallery-item'><img alt='8812' src='https://demoazimg.prop360.cl/magnolia/img/propiedades/8812_w.jpeg?sv=2021&amp;sig=abc'></a>
  <li><a onclick="javaScript:verMapaPropiedad('map','https://www.google.com/maps/embed/v1/place?key=AIza&amp;q=-33.3946109,-70.563724');"></a></li>
  <article class='property-description'><div class='article-body'><p>MAGNOLIA PROPERTY ARRIENDA OFICINA.</p></div></article>
  <table class='table detail-table'>
    <tr><td class='detail-title'>Código</td><td>8.812</td><td class='detail-title'>Tipo</td><td>Oficina</td></tr>
    <tr><td class='detail-title'> Venta</td><td>  - </td><td class='detail-title'> Arriendo</td><td>  UF 9,50<small> $ 388.025</small></td></tr>
    <tr><td class='detail-title'>  Dormitorio</td><td> -</td><td class='detail-title'>  Baño</td><td> 1</td></tr>
    <tr><td class='detail-title'> Sup. útil</td><td> 25 m<sup>2</sup></td><td class='detail-title'> Sup. total</td><td> - m<sup>2</sup></td></tr>
  </table>
  </body></html>`

test('Convecta.parseDetail (plantilla de tabla) extrae la ficha completa', () => {
  const l = convecta.parseDetail(CONVECTA_FICHA_TABLA, {
    url: 'https://www.magnoliaproperty.cl/fichaPropiedad.aspx?i=8812',
    domain: 'magnoliaproperty.cl',
  })
  assert.ok(l)
  assert.equal(l.seller_reference, '8812')
  assert.equal(l.operation, 'rent')
  assert.equal(l.property_type, 'oficina')
  // "UF 9,50": la coma es decimal. Exigir 4 dígitos o separador de miles dejaba
  // sin precio a todos los arriendos de oficina.
  assert.equal(l.price_uf, 9.5)
  assert.equal(l.price, 388025)
  assert.equal(l.bathrooms, 1)
  assert.equal(l.square_meters, 25)
  // El título no lleva la comuna; sale del h2 de la ficha.
  assert.equal(l.comuna, 'Vitacura')
  assert.equal(l.address, 'AV kennedy y Gerónimo de Alderete')
  assert.equal(l.latitude, -33.3946109)
  assert.equal(l.photos.length, 2)
})

test('Convecta.parseDetail: "-" y "m2" no se leen como dato', () => {
  const l = convecta.parseDetail(CONVECTA_FICHA_TABLA, {
    url: 'https://www.magnoliaproperty.cl/fichaPropiedad.aspx?i=8812',
    domain: 'magnoliaproperty.cl',
  })
  // "Dormitorio: -" es "sin dato", no cero.
  assert.equal(l.bedrooms, null)
  // "Sup. total: - m2" no puede acabar en "Terreno: 2 m²" leyendo el 2 de m2.
  assert.equal(l.features.filter((f) => /^Terreno/.test(f)).length, 0)
})

// Ficha de keyproperties.com (tercera plantilla, "meta"): no tiene bloque
// "Detalles" — los datos van en una tira de <span> donde el ICONO dice qué es
// cada número, y el precio/operación viven sobre la foto en .estadoAV.
const CONVECTA_FICHA_META = `<!doctype html><html><head>
  <meta property="og:title" content="Casa en venta en Temuco" />
  </head><body>
  <div class='cont__dirWeb'><span class='spanEAV'>COD: 10.886</span></div>
  <div class='estadoAV'><span class='spanEAV'>Venta </span><span class='precioEAV'>$ 280.000.000</span></div>
  <div class='info__ficha'><p class='p-font-15 bottom20'>Cómoda y luminosa casa en condominio.</p>
    <div class='property_meta'>
      <span><i class='fa fa-object-group'></i>Cons. 183 M<sup>2</sup></span>
      <span><i class='fa fa-object-group'></i>Terreno 5.000 M<sup>2</sup></span>
      <span><i class='fa fa-bed'></i> 3</span>
      <span><i class='fa fa-bath'></i> 3 Baño/s</span>
    </div></div>
  <ul class='caracteristicas-add'><li><i class='fa fa-check-square'></i> Piscina</li></ul>
  <a onclick="javaScript:verMapaPropiedad('m','https://www.google.com/maps/embed/v1/place?key=A&amp;q=-38.7359,-72.5904');"></a>
  <footer>Desarrollado por <a href="www.convecta.cl">Convecta</a></footer>
  </body></html>`

test('Convecta.parseDetail (plantilla meta) extrae la ficha completa', () => {
  const l = convecta.parseDetail(CONVECTA_FICHA_META, {
    url: 'https://keyproperties.com/fichaPropiedad.aspx?i=10886',
    domain: 'keyproperties.com',
  })
  assert.ok(l)
  assert.equal(l.seller_reference, '10886')
  assert.equal(l.operation, 'sale')
  assert.equal(l.property_type, 'casa')
  assert.equal(l.price, 280000000)
  assert.equal(l.currency, 'CLP')
  // Los números salen del icono del span, no de su posición.
  assert.equal(l.bedrooms, 3)
  assert.equal(l.bathrooms, 3)
  assert.equal(l.square_meters, 183)
  assert.equal(l.comuna, 'Temuco')
  assert.ok(l.features.includes('Piscina'))
  assert.ok(l.features.includes('Terreno: 5000 m²'))
})

test('Convecta: la operación NO se lee del badge del código', () => {
  // .spanEAV se reutiliza para el badge "COD: 10.886" ANTES del bloque de
  // precio. Sin anclar el selector a .estadoAV, la operación se leía como un
  // campo llamado "cod: 10.886" y la ficha quedaba sin precio.
  const l = convecta.parseDetail(CONVECTA_FICHA_META, {
    url: 'https://keyproperties.com/fichaPropiedad.aspx?i=10886',
    domain: 'keyproperties.com',
  })
  assert.equal(l.price, 280000000)
})

test('Convecta: un precio POR M2 no se guarda como precio total', () => {
  // Los terrenos se publican como "UF 3,30/m2". Meter 3,30 en la columna de
  // precio pondría un sitio de 5.100 m² como si costara UF 3 — un número que no
  // llama la atención de nadie y contamina medias, filtros y dedup.
  const html = CONVECTA_FICHA_META
    .replace('$ 280.000.000', 'UF 3,30/m2')
    .replace('Terreno 5.000 M<sup>2</sup>', 'Terreno 5.100 M<sup>2</sup>')
  const l = convecta.parseDetail(html, {
    url: 'https://www.elbarrio.cl/fichaPropiedad.aspx?i=33078',
    domain: 'elbarrio.cl',
  })
  assert.equal(l.price_uf, null)
  assert.equal(l.price, null)
  // El dato no se pierde: queda el unitario y el total, marcado como derivado.
  assert.ok(l.features.includes('Precio unitario: UF 3,30/m2'))
  assert.ok(l.features.some((f) => /^Precio total estimado: UF 16\.830/.test(f)))
})

test('Convecta.parseDetail descarta coordenadas fuera de Chile', () => {
  const html = CONVECTA_FICHA_LISTA.replace('-33.2777328489578,-70.62578542541551', '0.0,0.0')
  const l = convecta.parseDetail(html, { url: 'https://www.elbarrio.cl/12828', domain: 'elbarrio.cl' })
  assert.equal(l.latitude, null)
  assert.equal(l.longitude, null)
})

// ── Ofinet ───────────────────────────────────────────────────────────────────

test('Ofinet.listUrl: filtros completos en la página 1, solo NumPag después', () => {
  const p1 = ofinet.listUrl('cympropiedades.cl', { operation: 'sale' })
  assert.match(p1, /^https:\/\/www\.cympropiedades\.cl\/i_listing\.asp\?/)
  assert.match(p1, /select-status=VE/)
  // i_listing-4-column.asp devuelve 24 bytes vacíos: no debe usarse.
  assert.doesNotMatch(p1, /4-column/)
  // El juego completo es obligatorio; con un subconjunto el sitio responde vacío.
  for (const k of ['dormitorios', 'select-property-type', 'select-region', 'select-location', 'rbEs', 'condominio', 'idPro']) {
    assert.match(p1, new RegExp(`(\\?|&)${k}=`))
  }
  assert.match(ofinet.listUrl('cympropiedades.cl', { operation: 'rent' }), /select-status=AR/)
  // La paginación va sin filtros: los hereda de la sesión de ASP.
  assert.equal(
    ofinet.listUrl('cympropiedades.cl', { operation: 'sale', page: 5 }),
    'https://www.cympropiedades.cl/i_listing.asp?Order=ASC&NumPag=5'
  )
})

test('Ofinet declara que necesita sesión', () => {
  // Sin cookie jar la página 2 devuelve cero fichas; el crawler debe saberlo.
  assert.equal(ofinet.requiresSession, true)
})

const OFINET_LISTADO = `<html><body>
  <li><a href="i_listing.asp?select-status=VE&idPro=0">VENTA</a></li>
  <a href="property.asp?idPro=4722"><img src="fotos/4722a.jpg"></a>
  <a href="property.asp?idPro=4606"><img src="fotos/4606a.jpg"></a>
  <ul class="pagination"><li class="active"><a href="#">1</a></li><li><a href="i_listing.asp?Order=ASC&NumPag=2#lista">2</a></li></ul>
  </body></html>`

test('Ofinet.parseList recoge las fichas e ignora el idPro=0 del menú', () => {
  const r = ofinet.parseList(OFINET_LISTADO, { domain: 'cympropiedades.cl' })
  assert.deepEqual(r.items.map((i) => i.seller_reference), ['4722', '4606'])
  assert.equal(r.items[0].url, 'https://www.cympropiedades.cl/property.asp?idPro=4722')
})

test('Ofinet.parseList NO declara última página aunque el paginador la muestre', () => {
  // El paginador es una ventana deslizante: en la página 1 enseña hasta la 4
  // aunque haya 85. Creerle daba 36 fichas de las 759 reales, así que el
  // adaptador devuelve null y el crawler avanza hasta la página vacía.
  const r = ofinet.parseList(OFINET_LISTADO, { domain: 'cympropiedades.cl' })
  assert.equal(r.lastPage, null)
  assert.equal(r.total, null)
})

// Ficha de cympropiedades.cl/property.asp?idPro=2747, valores reales. Incluye
// el sidebar de propiedades relacionadas, que es lo que contaminaba las fotos.
const OFINET_FICHA = `<html><head>
  <meta property="og:title" content="MAYFLOWER/ LA LAGUNA, Lo Barnechea - CyM Propiedades" />
  <meta property="og:image" content="https://www.cympropiedades.cl/fotos/2747a.jpg" />
  </head><body>
  <li><img src="Fotos/2747a.jpg" class="verlineapc">
    <span class="property-thumb-info-label">
      <span class="label price">UF 17.500,00</span>
      <span class="label forrent">Venta</span>
    </span></li>
  <li><img src="Fotos/2747b.jpg"><span class="label price">UF 17.500,00</span><span class="label forrent">Venta</span></li>
  <li><img src="fotos/2747q.jpg" class="slider-images"></li>
  <div class="pgl-detail verlineacel">
    <ul class="list-unstyled amenities amenities-detail">
      <li><strong>C&oacute;d.:</strong> 2747</li>
      <li><strong>Tipo:</strong> Casa</li>
      <li><strong>Sup.:</strong> 207,63<sup>m2</sup>/400<sup>m2</sup></li>
      <li><address><i class="icons icon-location"></i> Lo Barnechea, SANTIAGO</address></li>
      <li><i class="icons icon-bedroom"></i> 4 Dormitorios</li>
      <li><i class="icons icon-bathroom"></i> 4 Ba&ntilde;os</li>
    </ul>
    <h2 style="font-size:1.5em">MAYFLOWER/ LA LAGUNA</h2>
    <p>Linda y moderna casa en condominio de 18 casas con seguridad 24/7.</p>
  </div>
  <iframe src="https://www.youtube.com/embed/I9g4Q8UdCzs"></iframe>
  <ul class="contacts-list">
    <li class="office">Nombre: <b>CyM Propiedades La Dehesa</b></li>
    <li class="mobile">Mobile : +569 66616220</li>
  </ul>
  <!-- Sidebar de propiedades relacionadas: fotos de OTRAS fichas -->
  <div class="pgl-property"><a href="property.asp?idPro=4722"><img src="fotos/4722a.jpg"></a>
    <span class="label price">UF 24.000,00</span><span class="label forrent">Venta - Casa</span></div>
  <div class="pgl-property"><a href="property.asp?idPro=4606"><img src="fotos/4606a.jpg"></a></div>
  <footer>Copyright © 2016 CyM Propiedades. Designed by <a href="http://www.ofinet.cl/">Ofinet</a></footer>
  </body></html>`

test('Ofinet.parseDetail extrae la ficha completa', () => {
  const l = ofinet.parseDetail(OFINET_FICHA, {
    url: 'https://www.cympropiedades.cl/property.asp?idPro=2747',
    domain: 'cympropiedades.cl',
  })
  assert.ok(l)
  assert.equal(l.portal, 'web:cympropiedades.cl')
  assert.equal(l.seller_reference, '2747')
  assert.equal(l.external_id, 'cympropiedades.cl:2747')
  // La etiqueta de la clase es "forrent" para AMBAS operaciones: el valor manda,
  // no el nombre de la clase. Esta ficha es de VENTA.
  assert.equal(l.operation, 'sale')
  // El tipo sale del campo "Tipo", no del título libre "MAYFLOWER/ LA LAGUNA".
  assert.equal(l.property_type, 'casa')
  assert.equal(l.price_uf, 17500)
  assert.equal(l.currency, 'UF')
  assert.equal(l.bedrooms, 4)
  assert.equal(l.bathrooms, 4)
  assert.equal(l.square_meters, 208) // 207,63 construidos
  assert.equal(l.comuna, 'Lo Barnechea')
  // La dirección es el h2, sin la coletilla ", Lo Barnechea - CyM Propiedades".
  assert.equal(l.address, 'MAYFLOWER/ LA LAGUNA')
  assert.ok(l.features.includes('Terreno: 400 m²'))
  assert.equal(l.has_video, true)
  assert.equal(l.phone, '+56966616220')
  assert.equal(l.crm_platform, 'ofinet')
})

test('Ofinet.parseDetail no se queda con las fotos del sidebar', () => {
  const l = ofinet.parseDetail(OFINET_FICHA, {
    url: 'https://www.cympropiedades.cl/property.asp?idPro=2747',
    domain: 'cympropiedades.cl',
  })
  // Solo las de esta ficha (2747a, 2747b, 2747q), no las de 4722/4606. Y "Fotos/"
  // y "fotos/" son la misma foto: no debe contarse dos veces.
  assert.equal(l.photos.length, 3)
  assert.ok(l.photos.every((p) => /\/2747[a-z]?\.jpg$/i.test(p)))
  assert.ok(l.photos.every((p) => p.startsWith('https://www.cympropiedades.cl/')))
})

// ── Konnect (Property Partners) ──────────────────────────────────────────────

test('Konnect.listUrl usa el nombre de parámetro que la API respeta', () => {
  const u = konnect.listUrl('ppartnersgroup.com', { operation: 'sale', page: 2, baseUrl: 'https://ppartnersgroup.com' })
  assert.match(u, /^https:\/\/ppartnersgroup\.com\/api\/properties\/listing\/\?/)
  assert.match(u, /countryId=cl/)
  // `operation`, NO `operationId`: la API ignora operationId en silencio y
  // devuelve el listado sin filtrar con un total idéntico al de "sin filtro".
  assert.match(u, /(^|&|\?)operation=sell(&|$)/)
  assert.doesNotMatch(u, /operationId=/)
  assert.match(u, /page=2/)
  // Sin operación no se manda el parámetro: la API devuelve venta y arriendo.
  assert.doesNotMatch(konnect.listUrl('ppartnersgroup.com', {}), /operation=/)
})

const KONNECT_PAGINA = JSON.stringify({
  data: {
    pagination: { totalProperties: 10870, maxPages: 109, currentPage: 1 },
    properties: [{
      _id: '629642404e6a6cd0f353f548',
      externalId: 'HU0920',
      type: { code: 'apartment' },
      operation: { code: 'sell' },
      title: 'Departamento en Pucón, con excelente ubicación',
      description: 'Departamento en Pucón.',
      images: ['https://ppartnersgroupstorage.blob.core.windows.net/crm-files/properties/288/a.jpg'],
      slug: 'departamento-en-pucon-con-excelente-ubicacion',
      price: 7900,
      currencyId: 'UF',
      location: { countryId: 'CL', type: 'Point', coordinates: [-71.98, -39.274], name: 'Cautín', fullName: 'Cautín, Región de Araucanía' },
      features: { buildSize: 110, bedrooms: 4, bathrooms: 3, parkplaces: 1, warehouses: 1, others: [{ icon: 'MdBalcony', name: 'Balcón' }] },
      office: { slug: 'pucon', externalId: 15, name: 'Pucón', phone: '+56987593638' },
      videos: [''],
      firstPublishedAt: '2024-06-26T17:42:15.224Z',
    }],
  },
  success: true,
})

test('Konnect.parseList devuelve la ficha entera, no solo el enlace', () => {
  const r = konnect.parseList(KONNECT_PAGINA, { domain: 'ppartnersgroup.com', baseUrl: 'https://ppartnersgroup.com' })
  assert.equal(r.total, 10870)
  assert.equal(r.lastPage, 109)
  assert.equal(r.items.length, 1)
  // listIsComplete: el crawler NO debe bajar la ficha, ya la tiene aquí.
  assert.equal(konnect.listIsComplete, true)
  const l = r.items[0].listing
  assert.equal(l.seller_reference, 'HU0920')
  assert.equal(l.external_id, 'ppartnersgroup.com:HU0920')
  assert.equal(l.operation, 'sale')
  assert.equal(l.property_type, 'departamento')
  assert.equal(l.price_uf, 7900)
  assert.equal(l.price, null)
  assert.equal(l.currency, 'UF')
  assert.equal(l.bedrooms, 4)
  assert.equal(l.bathrooms, 3)
  assert.equal(l.square_meters, 110)
  assert.equal(l.advertiser_name, 'Property Partners Pucón')
  assert.equal(l.portal_first_seen_at, '2024-06-26T17:42:15.224Z')
  assert.ok(l.features.includes('Balcón'))
  assert.ok(l.features.includes('Estacionamientos: 1'))
  assert.equal(
    r.items[0].url,
    'https://ppartnersgroup.com/es-cl/propiedad/departamento-en-pucon-con-excelente-ubicacion/HU0920/'
  )
})

test('Konnect: las coordenadas GeoJSON son [lng, lat], no [lat, lng]', () => {
  const r = konnect.parseList(KONNECT_PAGINA, { domain: 'ppartnersgroup.com', baseUrl: 'https://ppartnersgroup.com' })
  const l = r.items[0].listing
  // Pucón está en -39.27, -71.98. Invertirlo la manda al océano Índico, y como
  // el mapa igual pinta un pin es un error que no salta a la vista.
  assert.equal(l.latitude, -39.274)
  assert.equal(l.longitude, -71.98)
})

test('Konnect: videos con cadenas vacías no cuentan como vídeo', () => {
  const r = konnect.parseList(KONNECT_PAGINA, { domain: 'ppartnersgroup.com', baseUrl: 'https://ppartnersgroup.com' })
  assert.equal(r.items[0].listing.has_video, false)
  assert.equal(r.items[0].listing.video_modal_url, null)
})

test('Konnect.parseList tolera cuerpos no-JSON o vacíos', () => {
  assert.deepEqual(konnect.parseList('<html>502</html>', { domain: 'ppartnersgroup.com' }).items, [])
  assert.deepEqual(konnect.parseList('', { domain: 'ppartnersgroup.com' }).items, [])
  assert.deepEqual(konnect.parseList('{"success":false}', { domain: 'ppartnersgroup.com' }).items, [])
})
