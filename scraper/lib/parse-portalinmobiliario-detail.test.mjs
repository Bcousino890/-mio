// Tests de la identidad de corredora en la ficha (parseDetailPage · H4).
//
// Correr:  node --test scraper/lib/parse-portalinmobiliario-detail.test.mjs
//
// El id ESTABLE de la corredora (advertiser_id = seller_id de Mercado Libre) es
// la clave de corredoras_cl. Estos tests blindan que NUNCA quede sin identificar
// cuando el dato está presente: fuente primaria (blob) + fallbacks (GTM dataLayer,
// URL del logo de tienda oficial), más la captura del logo para la ficha.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetailPage } from './parse-portalinmobiliario.mjs';

// Estos tests solo verifican advertiser_id/logo — no fotos. Inyectamos
// fetchGallery/fetchGalleryById en NO-OP para no depender de red real
// (antes de que parseDetailPage aceptara `deps`, esto era imposible: cada
// test disparaba un fetch real a portalinmobiliario.com, con su
// fallback a curl+proxy incluido, solo para terminar descartando el resultado).
const NO_GALLERY = { fetchGallery: async () => [], fetchGalleryById: async () => [] };

// Los dos formatos reales de URL de logo de corredora en Mercado Libre.
const LOGO_URL = {
  classifieds: (id) => `https://resources.mlstatic.com/classifieds_accounts/MLC_real_estate_agency/${id}_vip_v3.gif`,
  visAccounts: (id) => `https://http2.mlstatic.com/storage/vis-accounts/${id}_vip-67b6dc3f-204c-4e51-95f3-b286c5b44a6e.jpg`,
};

/** HTML mínimo con blob Nordic + (opcional) dataLayer GTM + (opcional) logo/tienda. */
function detailHtml({ eventData = {}, gtmSellerId = null, logoId = null, logoFormat = 'classifieds', storeSlug = null, storeName = 'Corredora' } = {}) {
  const initialState = {
    track: { melidata_event: { event_data: { domain_id: 'MLC-INDIVIDUAL_HOUSES_FOR_SALE', ...eventData } } },
    components: { header: { title: 'Casa en Las Condes' } },
  };
  const blob = { appProps: { pageProps: { initialState } } };
  let html = `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(blob)};self.__x=1</script></head><body>`;
  if (gtmSellerId != null) html += `<script>dataLayer.push({"pageId":"VIP","sellerId":${gtmSellerId},"status":"active"});</script>`;
  if (logoId != null) html += `<img src="${LOGO_URL[logoFormat](logoId)}" alt="Logo">`;
  // Enlace real "Ir a la tienda oficial de <nombre>" (verificado contra HTML de
  // Remax Diamante) — la fuente del store slug (H23).
  if (storeSlug != null) html += `<span>Ir a la tienda oficial de </span><a href="https://www.portalinmobiliario.com/tienda/${storeSlug}" target="_self">${storeName}</a>`;
  html += '</body></html>';
  return html;
}

test('advertiser_id primario: event_data.seller_id', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: { seller_id: 251889930 } }), 'MLC-1', NO_GALLERY);
  assert.equal(p.advertiser_id, '251889930');
});

test('advertiser_id fallback: GTM dataLayer sellerId (la fuente del usuario)', async () => {
  // Sin seller_id en el blob, pero con el dataLayer de GTM → debe identificarse igual.
  const p = await parseDetailPage(detailHtml({ eventData: {}, gtmSellerId: 330114547 }), 'MLC-2', NO_GALLERY);
  assert.equal(p.advertiser_id, '330114547');
});

test('advertiser_id fallback: URL del logo (formato classifieds_accounts)', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: {}, logoId: 491510094, logoFormat: 'classifieds' }), 'MLC-3', NO_GALLERY);
  assert.equal(p.advertiser_id, '491510094');
});

test('advertiser_id fallback: URL del logo (formato vis-accounts, ej. Romo 234292543)', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: {}, logoId: 234292543, logoFormat: 'visAccounts' }), 'MLC-3b', NO_GALLERY);
  assert.equal(p.advertiser_id, '234292543');
});

test('advertiser_logo se captura en AMBOS formatos de URL', async () => {
  const p1 = await parseDetailPage(detailHtml({ eventData: { seller_id: 491510094 }, logoId: 491510094, logoFormat: 'classifieds' }), 'MLC-4', NO_GALLERY);
  assert.match(p1.advertiser_logo, /MLC_real_estate_agency\/491510094_vip/);
  // Formato vis-accounts (el que usa Romo Propiedades): antes se perdía.
  const p2 = await parseDetailPage(detailHtml({ eventData: { seller_id: 234292543 }, logoId: 234292543, logoFormat: 'visAccounts' }), 'MLC-4b', NO_GALLERY);
  assert.match(p2.advertiser_logo, /vis-accounts\/234292543_vip-/);
});

test('sin ninguna fuente de id → advertiser_id null (no revienta)', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: {} }), 'MLC-5', NO_GALLERY);
  assert.equal(p.advertiser_id, null);
  assert.equal(p.advertiser_logo, null);
});

test('prioridad: el blob gana al GTM si ambos están', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: { seller_id: 111 }, gtmSellerId: 999 }), 'MLC-6', NO_GALLERY);
  assert.equal(p.advertiser_id, '111');
});

// ── advertiser_store_slug: tienda oficial dentro del portal (H23) ───────────
// Habilita el barrido de inventario COMPLETO de una corredora (RM entera, sin
// depender de qué comunas estén activadas) — ver discovery-corredora-tienda-cl.mjs.

test('advertiser_store_slug se captura del enlace "Ir a la tienda oficial de"', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: { seller_id: 234292543 }, storeSlug: 'remax-diamante', storeName: 'Remax Diamante' }), 'MLC-7', NO_GALLERY);
  assert.equal(p.advertiser_store_slug, 'remax-diamante');
});

test('sin tienda oficial → advertiser_store_slug null (no revienta)', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: { seller_id: 111 } }), 'MLC-8', NO_GALLERY);
  assert.equal(p.advertiser_store_slug, null);
});
