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

/** HTML mínimo con blob Nordic + (opcional) dataLayer GTM + (opcional) logo. */
function detailHtml({ eventData = {}, gtmSellerId = null, logoId = null } = {}) {
  const initialState = {
    track: { melidata_event: { event_data: { domain_id: 'MLC-INDIVIDUAL_HOUSES_FOR_SALE', ...eventData } } },
    components: { header: { title: 'Casa en Las Condes' } },
  };
  const blob = { appProps: { pageProps: { initialState } } };
  let html = `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(blob)};self.__x=1</script></head><body>`;
  if (gtmSellerId != null) html += `<script>dataLayer.push({"pageId":"VIP","sellerId":${gtmSellerId},"status":"active"});</script>`;
  if (logoId != null) html += `<img src="https://resources.mlstatic.com/classifieds_accounts/MLC_real_estate_agency/${logoId}_vip_v3.gif" alt="Logo">`;
  html += '</body></html>';
  return html;
}

test('advertiser_id primario: event_data.seller_id', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: { seller_id: 251889930 } }), 'MLC-1');
  assert.equal(p.advertiser_id, '251889930');
});

test('advertiser_id fallback: GTM dataLayer sellerId (la fuente del usuario)', async () => {
  // Sin seller_id en el blob, pero con el dataLayer de GTM → debe identificarse igual.
  const p = await parseDetailPage(detailHtml({ eventData: {}, gtmSellerId: 330114547 }), 'MLC-2');
  assert.equal(p.advertiser_id, '330114547');
});

test('advertiser_id fallback: URL del logo de tienda oficial', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: {}, logoId: 491510094 }), 'MLC-3');
  assert.equal(p.advertiser_id, '491510094');
});

test('advertiser_logo se captura cuando hay logo de tienda oficial', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: { seller_id: 491510094 }, logoId: 491510094 }), 'MLC-4');
  assert.match(p.advertiser_logo, /MLC_real_estate_agency\/491510094_vip/);
});

test('sin ninguna fuente de id → advertiser_id null (no revienta)', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: {} }), 'MLC-5');
  assert.equal(p.advertiser_id, null);
  assert.equal(p.advertiser_logo, null);
});

test('prioridad: el blob gana al GTM si ambos están', async () => {
  const p = await parseDetailPage(detailHtml({ eventData: { seller_id: 111 }, gtmSellerId: 999 }), 'MLC-6');
  assert.equal(p.advertiser_id, '111');
});
