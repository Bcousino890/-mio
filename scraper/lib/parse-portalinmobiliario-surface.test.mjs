// Tests de superficie y deduplicación de fotos en la ficha (parseDetailPage).
//
// Correr:  node --test scraper/lib/parse-portalinmobiliario-surface.test.mjs
//
// Dos bugs reportados desde el CRM (fichas de Las Condes):
//
//  1) SUPERFICIE inflada: la ficha mostraba "23056 m²" (el TERRENO de la parcela)
//     como superficie del inmueble, cuando la construida es "232 m²". El bloque
//     de specs destacados puede traer DOS valores de m² (construido + terreno) y
//     el último ganaba. Ahora el terreno se separa y NUNCA pisa la construida;
//     además se leen los valores tipados de la tabla rayada.
//
//  2) FOTOS infladas: "21 fotos cuando el original tiene 16". Las 5 del mosaico
//     estático llegan con una plantilla de URL y las del modal con otra, para la
//     MISMA imagen; deduplicar por URL completa las contaba doble. Ahora se
//     deduplica por id de foto de Mercado Libre.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetailPage } from './parse-portalinmobiliario.mjs';

const NO_GALLERY = { fetchGallery: async () => [], fetchGalleryById: async () => [] };

/** HTML de ficha con specs destacados (highlighted) + tabla rayada opcional. */
function detailHtml({ highlighted = [], stripedRows = [], gallery = null } = {}) {
  const components = {
    header: { title: 'Casa en Las Condes' },
    track: {},
  };
  if (highlighted.length) components.highlighted_specs_res = { attributes: highlighted };
  if (gallery) components.gallery_mosaic = gallery;
  const initialState = {
    track: { melidata_event: { event_data: { domain_id: 'MLC-INDIVIDUAL_HOUSES_FOR_SALE' } } },
    components,
  };
  const blob = { appProps: { pageProps: { initialState } } };
  const rowsHtml = stripedRows
    .map((r) => `<tr class="ui-vpp-striped-specs__row"><th>${r.k}</th><td>${r.v}</td></tr>`)
    .join('');
  return `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(blob)};self.__x=1</script></head><body><table>${rowsHtml}</table></body></html>`;
}

const scale = (text) => ({ icon: { id: 'SCALE_UP' }, label: { text } });

test('superficie: el terreno del spec destacado NO pisa la superficie construida', async () => {
  // Orden real que disparaba el bug: primero construida, luego terreno (ganaba).
  const p = await parseDetailPage(
    detailHtml({ highlighted: [scale('232 m² totales'), scale('23.056 m² de terreno')] }),
    'MLC-1', NO_GALLERY,
  );
  assert.equal(p.square_meters, 232);
  assert.equal(p.sqm_terreno, 23056);
});

test('superficie: la tabla rayada aporta útil/total/terreno tipados', async () => {
  const p = await parseDetailPage(
    detailHtml({
      highlighted: [scale('232,33 m² totales')],
      stripedRows: [
        { k: 'Superficie total', v: '232,33 m²' },
        { k: 'Superficie útil', v: '136,26 m²' },
        { k: 'Superficie del terreno', v: '23.056 m²' },
      ],
    }),
    'MLC-2', NO_GALLERY,
  );
  assert.equal(p.square_meters, 232);   // construida (total), no el terreno
  assert.equal(p.sqm_total, 232);
  assert.equal(p.sqm_util, 136);
  assert.equal(p.sqm_terreno, 23056);
  assert.equal(p.sqm_construida, 232);
});

test('superficie: si SOLO viene el terreno, square_meters queda nulo (mejor "—" que 23056)', async () => {
  const p = await parseDetailPage(
    detailHtml({ highlighted: [scale('23.056 m² de terreno')] }),
    'MLC-3', NO_GALLERY,
  );
  assert.equal(p.square_meters, null);
  assert.equal(p.sqm_terreno, 23056);
});

test('fotos: la misma imagen en mosaico y modal (plantillas de URL distintas) NO se cuenta doble', async () => {
  // El mosaico trae las fotos con plantilla "2X_...-F.webp"; el modal por item_id
  // las reconstruye como "..-O.webp". Mismo id de foto ⇒ una sola foto.
  const gallery = {
    primary: { src: 'https://http2.mlstatic.com/D_NQ_NP_2X_800001-MLC999_042026-F.webp' },
    secondary: [
      { src: 'https://http2.mlstatic.com/D_NQ_NP_2X_800002-MLC999_042026-F.webp' },
      { src: 'https://http2.mlstatic.com/D_NQ_NP_2X_800003-MLC999_042026-F.webp' },
    ],
    total_count: 4,
  };
  const p = await parseDetailPage(
    detailHtml({ gallery }),
    'MLC-999',
    {
      fetchGallery: async () => [],
      // El modal devuelve las MISMAS 3 (otra plantilla) + 1 nueva.
      fetchGalleryById: async () => [
        'https://http2.mlstatic.com/D_NQ_NP_800001-MLC999_042026-O.webp',
        'https://http2.mlstatic.com/D_NQ_NP_800002-MLC999_042026-O.webp',
        'https://http2.mlstatic.com/D_NQ_NP_800003-MLC999_042026-O.webp',
        'https://http2.mlstatic.com/D_NQ_NP_800004-MLC999_042026-O.webp',
      ],
    },
  );
  assert.equal(p.photos.length, 4); // 3 del mosaico + 1 nueva, sin duplicar las 3
});
