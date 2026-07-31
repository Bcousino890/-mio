// Tests de la galería de fotos en la ficha (parseDetailPage · fix "solo 5 fotos").
//
// Correr:  node --test scraper/lib/parse-portalinmobiliario-photos.test.mjs
//
// El HTML estático de la ficha SIEMPRE trae solo 5 fotos (`gallery_mosaic`),
// sin importar cuántas tenga el aviso en realidad (`total_count`, hasta 30).
// El resto solo se consigue con un fetch adicional a los endpoints de galería
// (`fetchGalleryPhotos`/`fetchGalleryByItemId` en parse-portalinmobiliario.mjs),
// que antes NO tenían fallback a proxy y se rendían en silencio ante cualquier
// bloqueo — dejando la ficha pegada en 5 fotos para siempre. Estos tests
// verifican, vía inyección de dependencias, que parseDetailPage SÍ integra
// las fotos que devuelven esos fetches cuando el blob estático se queda corto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetailPage, aMaximaResolucion } from './parse-portalinmobiliario.mjs';

function galleryMosaicHtml({ totalCount = 20, mediaCounters = [] } = {}) {
  const initialState = {
    track: { melidata_event: { event_data: { domain_id: 'MLC-INDIVIDUAL_HOUSES_FOR_SALE' } } },
    components: {
      header: { title: 'Casa en Las Condes' },
      gallery_mosaic: {
        primary: { src: 'https://http2.mlstatic.com/D_NQ_NP_000001-MLC900000001_042026-F.webp' },
        secondary: [
          { src: 'https://http2.mlstatic.com/D_NQ_NP_000002-MLC900000002_042026-F.webp' },
          { src: 'https://http2.mlstatic.com/D_NQ_NP_000003-MLC900000003_042026-F.webp' },
          { src: 'https://http2.mlstatic.com/D_NQ_NP_000004-MLC900000004_042026-F.webp' },
          { src: 'https://http2.mlstatic.com/D_NQ_NP_000005-MLC900000005_042026-F.webp' },
        ],
        total_count: totalCount,
        media_counters: mediaCounters,
      },
    },
  };
  const blob = { appProps: { pageProps: { initialState } } };
  return `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(blob)};self.__x=1</script></head><body></body></html>`;
}

test('el blob estático solo trae 5 fotos aunque total_count declare más', async () => {
  const p = await parseDetailPage(galleryMosaicHtml({ totalCount: 20 }), 'MLC-100', {
    fetchGallery: async () => [], fetchGalleryById: async () => [],
  });
  assert.equal(p.photos.length, 5);
  assert.equal(p.photos_total_count, 20);
});

test('fetchGalleryById (inyectado) completa las fotos que faltan cuando el blob se queda corto', async () => {
  // Simula lo que antes fallaba en silencio: el modal de galería SÍ tiene el
  // resto de las fotos, pero solo llegan si algo las va a buscar.
  const extra = Array.from({ length: 15 }, (_, i) => `https://http2.mlstatic.com/D_NQ_NP_10000${i}-MLC91000000${i}-O.webp`);
  const p = await parseDetailPage(galleryMosaicHtml({ totalCount: 20 }), 'MLC-101', {
    fetchGallery: async () => [],
    fetchGalleryById: async (externalId) => {
      assert.equal(externalId, 'MLC-101');
      return extra;
    },
  });
  assert.equal(p.photos.length, 20); // 5 del blob + 15 del modal
});

test('fetchGallery (media_counters.url, inyectado) también aporta fotos y evita duplicados', async () => {
  const p = await parseDetailPage(
    galleryMosaicHtml({ totalCount: 8, mediaCounters: [{ type: 'photos', url: 'https://www.portalinmobiliario.com/vis-modals/gallery/MLC102' }] }),
    'MLC-102',
    {
      fetchGallery: async (url) => {
        assert.equal(url, 'https://www.portalinmobiliario.com/vis-modals/gallery/MLC102');
        // Incluye una foto repetida (ya está en el blob) + 3 nuevas.
        return [
          'https://http2.mlstatic.com/D_NQ_NP_000001-MLC900000001_042026-O.webp', // repetida (ya está en el blob, otra plantilla)
          'https://http2.mlstatic.com/D_NQ_NP_000011-MLC900000011-O.webp',
          'https://http2.mlstatic.com/D_NQ_NP_000012-MLC900000012-O.webp',
          'https://http2.mlstatic.com/D_NQ_NP_000013-MLC900000013-O.webp',
        ];
      },
      fetchGalleryById: async () => [],
    }
  );
  assert.equal(p.photos.length, 8); // 5 del blob + 3 nuevas del modal (la repetida se dedup por Set)
});

test('cap de 30 fotos aunque el modal devuelva más', async () => {
  const many = Array.from({ length: 50 }, (_, i) => `https://http2.mlstatic.com/D_NQ_NP_20000${i}-MLC92000000${i}-O.webp`);
  const p = await parseDetailPage(galleryMosaicHtml({ totalCount: 55 }), 'MLC-103', {
    fetchGallery: async () => [],
    fetchGalleryById: async () => many,
  });
  assert.equal(p.photos.length, 30);
});

test('sin deps inyectadas, parseDetailPage usa las funciones reales por defecto (no revienta si la red falla)', async () => {
  // Sin inyectar nada: cae en las funciones reales de fetch (con su fallback a
  // proxy). En este entorno de test la red puede estar bloqueada — igual no
  // debe reventar ni colgar, solo quedarse con lo que trae el blob estático.
  const p = await parseDetailPage(galleryMosaicHtml({ totalCount: 5 }), 'MLC-104');
  assert.ok(p.photos.length >= 5);
});

test('los gráficos de la interfaz de Mercado Libre NO cuentan como fotos del anuncio', async () => {
  // Bug real, verificado contra el portal: MLC-4021070764 guardaba 3 "fotos" y
  // dos eran `frontend-assets/vis-transactions-frontend/{big,little}-empty-state.webp`
  // — los placeholders de "aquí no hay nada" de la galería. La ficha mostraba
  // 3 imágenes y solo 1 era la casa. Y MLC-4098190146 guardaba 3 cuando el
  // portal declara 2 ("2 Fotos"), por el mismo motivo.
  //
  // Se colaban porque varios patrones de extracción son a propósito amplios
  // (cualquier imagen de http2.mlstatic.com). Una foto del anuncio siempre
  // lleva el id {secuencia}-MLC{item}; un recurso de la web, no.
  const p = await parseDetailPage(galleryMosaicHtml({ totalCount: 5 }), 'MLC-105', {
    fetchGallery: async () => [],
    fetchGalleryById: async () => [
      'https://http2.mlstatic.com/frontend-assets/vis-transactions-frontend/big-empty-state.webp',
      'https://http2.mlstatic.com/frontend-assets/vis-transactions-frontend/little-empty-state.webp',
      'https://http2.mlstatic.com/D_NQ_NP_000099-MLC900000099-O.webp', // esta sí
    ],
  });
  assert.equal(p.photos.length, 6); // 5 del blob + 1 real; los 2 placeholders fuera
  assert.ok(p.photos.every((u) => !u.includes('frontend-assets')));
});

test('una galería que llega a medias se reintenta por proxy, no solo si viene vacía', async () => {
  // Un bloqueo no siempre llega vacío: llega como un 200 con la página a
  // medias. Antes solo se reintentaba con CERO fotos, así que un aviso de 29
  // podía guardarse con 17 y darse por bueno para siempre — nadie volvía a
  // mirarlo porque "ya tenía fotos".
  let intentos = 0;
  const p = await parseDetailPage(galleryMosaicHtml({ totalCount: 29 }), 'MLC-106', {
    fetchGallery: async () => [],
    fetchGalleryById: async (_id, { esperadas } = {}) => {
      intentos++;
      assert.equal(esperadas, 29); // el total declarado llega hasta el fetch
      return Array.from({ length: 24 }, (_, i) => `https://http2.mlstatic.com/D_NQ_NP_3000${i}-MLC93000000${i}-O.webp`);
    },
  });
  assert.equal(intentos, 1);
  assert.equal(p.photos.length, 29); // 5 del blob + 24 del modal
  assert.equal(p.photos_total_count, 29);
});

test('todas las fotos se guardan en la variante de máxima resolución', async () => {
  // Medido contra el CDN con la MISMA imagen: -F es 800x597 (122.848 bytes) y
  // -O es 500x373 (52.996). El blob de la ficha trae las primeras en -F, pero
  // la galería por item_id las construía en -O: por eso las primeras se veían
  // bien y el resto peor. No era el anuncio, era la plantilla con la que
  // pedíamos la imagen.
  const p = await parseDetailPage(galleryMosaicHtml({ totalCount: 8 }), 'MLC-107', {
    fetchGallery: async () => [],
    fetchGalleryById: async () => [
      'https://http2.mlstatic.com/D_NQ_NP_000021-MLC900000021-O.webp',
      'https://http2.mlstatic.com/D_NQ_NP_2X_000022-MLC900000022_052026-V.webp',
      'https://http2.mlstatic.com/D_000023-MLC900000023_052026-L.webp',
    ],
  });
  assert.equal(p.photos.length, 8);
  // Ninguna se queda en un tamaño menor, venga de donde venga.
  for (const u of p.photos) {
    assert.doesNotMatch(u, /-[A-EG-Z][-.]/, `foto en tamaño reducido: ${u}`);
  }
  assert.ok(p.photos.includes('https://http2.mlstatic.com/D_NQ_NP_000021-MLC900000021-F.webp'));
  assert.ok(p.photos.includes('https://http2.mlstatic.com/D_NQ_NP_2X_000022-MLC900000022_052026-F.webp'));
  assert.ok(p.photos.includes('https://http2.mlstatic.com/D_000023-MLC900000023_052026-F.webp'));
});

test('aMaximaResolucion no toca lo que no es una foto de Mercado Libre', async () => {
  assert.equal(
    aMaximaResolucion('https://http2.mlstatic.com/frontend-assets/vis-transactions-frontend/big-empty-state.webp'),
    'https://http2.mlstatic.com/frontend-assets/vis-transactions-frontend/big-empty-state.webp',
  );
  assert.equal(aMaximaResolucion(null), '');
});

test('m²: el spec destacado abrevia los miles, se usa el valor escrito completo', async () => {
  // Verificado en el blob real de MLC-4029240828, que trae las dos formas:
  //   "1.505 m² totales"  ← el valor de verdad
  //   "1,5 m²"            ← el mismo dato, abreviado
  // Al caer al destacado, toSqm("1,5") descartaba los decimales y guardaba 1 m².
  // Así había 14 casas de 1 m² en producción.
  const blob = { appProps: { pageProps: { initialState: {
    track: { melidata_event: { event_data: { domain_id: 'MLC-INDIVIDUAL_HOUSES_FOR_SALE' } } },
    components: {
      header: { title: 'Casa' },
      highlighted_specs_res: { attributes: [{ icon: { id: 'SCALE_UP' }, label: { text: '1,5 m²' } }] },
    },
  } } } };
  const html = `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(blob)};self.x=1</script></head><body><p>1.505 m² totales</p></body></html>`;
  const p = await parseDetailPage(html, 'MLC-200', { fetchGallery: async () => [], fetchGalleryById: async () => [] });
  assert.equal(p.square_meters, 1505);
});

test('m²: una superficie imposible se descarta y se usa la siguiente que declara el anuncio', async () => {
  // Verificado en MLC-1958761199, que publica las dos cosas a la vez:
  //   "Superficie total": 1 m²    ← basura que puso el vendedor
  //   "Superficie útil": 160 m²   ← la superficie real
  // La precedencia se quedaba con el 1 por venir del campo con más prioridad,
  // teniendo el dato bueno justo al lado. No se inventa nada: se ignora lo
  // imposible y se usa la siguiente medida que el propio anuncio declara.
  const html = `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={};self.x=1</script></head>
    <body><table><tbody>
      <tr class="ui-vpp-striped-specs__row"><th>Superficie total</th><td>1 m²</td></tr>
      <tr class="ui-vpp-striped-specs__row"><th>Superficie útil</th><td>160 m²</td></tr>
    </tbody></table></body></html>`;
  const p = await parseDetailPage(html, 'MLC-201', { fetchGallery: async () => [], fetchGalleryById: async () => [] });
  assert.equal(p.square_meters, 160);
});

test('m²: si TODAS las superficies son imposibles, no se inventa ninguna', async () => {
  const html = `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={};self.x=1</script></head>
    <body><table><tbody>
      <tr class="ui-vpp-striped-specs__row"><th>Superficie total</th><td>1 m²</td></tr>
    </tbody></table></body></html>`;
  const p = await parseDetailPage(html, 'MLC-202', { fetchGallery: async () => [], fetchGalleryById: async () => [] });
  assert.equal(p.square_meters, null);
});
