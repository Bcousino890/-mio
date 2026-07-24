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
import { parseDetailPage } from './parse-portalinmobiliario.mjs';

function galleryMosaicHtml({ totalCount = 20, mediaCounters = [] } = {}) {
  const initialState = {
    track: { melidata_event: { event_data: { domain_id: 'MLC-INDIVIDUAL_HOUSES_FOR_SALE' } } },
    components: {
      header: { title: 'Casa en Las Condes' },
      gallery_mosaic: {
        primary: { src: 'https://http2.mlstatic.com/D_1-O.jpg' },
        secondary: [
          { src: 'https://http2.mlstatic.com/D_2-O.jpg' },
          { src: 'https://http2.mlstatic.com/D_3-O.jpg' },
          { src: 'https://http2.mlstatic.com/D_4-O.jpg' },
          { src: 'https://http2.mlstatic.com/D_5-O.jpg' },
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
  const extra = Array.from({ length: 15 }, (_, i) => `https://http2.mlstatic.com/EXTRA-${i}-O.webp`);
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
        return ['https://http2.mlstatic.com/D_1-O.jpg', 'https://http2.mlstatic.com/G_1-O.jpg', 'https://http2.mlstatic.com/G_2-O.jpg', 'https://http2.mlstatic.com/G_3-O.jpg'];
      },
      fetchGalleryById: async () => [],
    }
  );
  assert.equal(p.photos.length, 8); // 5 del blob + 3 nuevas del modal (la repetida se dedup por Set)
});

test('cap de 30 fotos aunque el modal devuelva más', async () => {
  const many = Array.from({ length: 50 }, (_, i) => `https://http2.mlstatic.com/MANY-${i}-O.webp`);
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
