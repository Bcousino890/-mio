// Tests del "Código de la propiedad" (property_code) en la ficha
// (parseDetailPage).
//
// Correr:  node --test scraper/lib/parse-portalinmobiliario-code.test.mjs
//
// Bug reportado desde el CRM: muchos anuncios quedaban SIN property_code aunque
// el portal lo muestra ("Código de la propiedad: 114611"). Causa: el blob Nordic
// NO siempre trae ese código en `seller_profile(.rex)?.bottom_extra_info[]`
// (varía por layout y es frecuente en tiendas oficiales `seller_profile_rex`);
// en esas fichas el código solo vive en el DOM, en el bloque "Información de la
// corredora" (`.ui-seller-info__status-info__title` = etiqueta,
// `.ui-seller-info__status-info__subtitle` = valor). El parser ahora cae a ese
// DOM cuando el blob no dio nada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetailPage } from './parse-portalinmobiliario.mjs';

const NO_GALLERY = { fetchGallery: async () => [], fetchGalleryById: async () => [] };

/**
 * HTML de ficha con blob Nordic y, opcionalmente, el bloque DOM de la corredora.
 * @param {object} o
 * @param {string} [o.blobCode]  código en `seller_profile.bottom_extra_info` (blob)
 * @param {boolean} [o.rex]      usa `seller_profile_rex` (tienda oficial) en vez de `seller_profile`
 * @param {string} [o.domCode]   código renderizado en el DOM (status-info)
 * @param {string} [o.domLabel]  etiqueta del bloque DOM (default "Código de la propiedad")
 */
function detailHtml({ blobCode = null, rex = false, domCode = null, domLabel = 'Código de la propiedad' } = {}) {
  const sellerProfile = { seller_name: { title: { text: 'Easy Prop' } } };
  if (blobCode != null) {
    sellerProfile.bottom_extra_info = [
      { title: { text: 'Código de la propiedad' }, subtitles: [{ text: blobCode }] },
    ];
  }
  const components = { header: { title: 'Casa en Las Condes' } };
  components[rex ? 'seller_profile_rex' : 'seller_profile'] = sellerProfile;
  const initialState = {
    track: { melidata_event: { event_data: { domain_id: 'MLC-HOUSES_FOR_RENT' } } },
    components,
  };
  const blob = { appProps: { pageProps: { initialState } } };
  let html = `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(blob)};self.__x=1</script></head><body>`;
  if (domCode != null) {
    // Estructura real del bloque "Información de la corredora" (DevTools):
    // <ul class="ui-vip-seller-profile__list-extra-info"> … status-info …
    html += `
      <ul class="ui-vip-seller-profile__list-extra-info">
        <div class="ui-seller-info__status-info">
          <figure aria-hidden="true" class="ui-seller-info__status-info__icon"></figure>
          <div>
            <h3 class="ui-seller-info__status-info__title ui-pdp-color--BLACK ui-vip-seller-profile__title">${domLabel}</h3>
            <p class="ui-seller-info__status-info__subtitle">${domCode}</p>
          </div>
        </div>
      </ul>`;
  }
  html += '</body></html>';
  return html;
}

test('property_code primario: blob seller_profile.bottom_extra_info', async () => {
  const p = await parseDetailPage(detailHtml({ blobCode: '999001' }), 'MLC-1', NO_GALLERY);
  assert.equal(p.property_code, '999001');
});

test('property_code fallback DOM: blob SIN código, DOM con status-info (el bug de MLC-4146257742)', async () => {
  // Sin bottom_extra_info en el blob, pero el portal lo renderiza en el DOM.
  const p = await parseDetailPage(detailHtml({ blobCode: null, domCode: '114611' }), 'MLC-4146257742', NO_GALLERY);
  assert.equal(p.property_code, '114611');
});

test('property_code fallback DOM: tienda oficial (seller_profile_rex) sin código en el blob', async () => {
  const p = await parseDetailPage(detailHtml({ rex: true, blobCode: null, domCode: '250834' }), 'MLC-2', NO_GALLERY);
  assert.equal(p.property_code, '250834');
});

test('property_code fallback DOM: acepta código alfanumérico (hash), no solo dígitos', async () => {
  const p = await parseDetailPage(detailHtml({ blobCode: null, domCode: 'AB12-CD34' }), 'MLC-3', NO_GALLERY);
  assert.equal(p.property_code, 'AB12-CD34');
});

test('property_code prioridad: el blob gana al DOM si ambos están', async () => {
  const p = await parseDetailPage(detailHtml({ blobCode: '111', domCode: '222' }), 'MLC-4', NO_GALLERY);
  assert.equal(p.property_code, '111');
});

test('property_code: sin blob ni DOM → null (no revienta)', async () => {
  const p = await parseDetailPage(detailHtml({ blobCode: null, domCode: null }), 'MLC-5', NO_GALLERY);
  assert.equal(p.property_code, null);
});

test('fallback DOM ignora otros status-info que no sean el código de la propiedad', async () => {
  // Un bloque de la corredora con OTRA etiqueta no debe rellenar property_code.
  const p = await parseDetailPage(detailHtml({ blobCode: null, domCode: 'no-soy-el-codigo', domLabel: 'Antigüedad' }), 'MLC-6', NO_GALLERY);
  assert.equal(p.property_code, null);
});
