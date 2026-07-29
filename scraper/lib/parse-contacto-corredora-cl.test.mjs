// Tests del extractor de ficha de empresa de corredoras
// (parse-contacto-corredora-cl.mjs · H4/H21).
//
// Correr:  node --test scraper/lib/parse-contacto-corredora-cl.test.mjs
//
// Los fixtures reproducen el markup REAL de las webs verificadas:
//   · finhabit.cl (Convecta): WhatsApp en <a href="wa.me/...">, email en
//     mailto: y la dirección dentro de un enlace a Google Maps.
//   · bpropiedades.cl (Ofinet): página de equipo con nombre + cargo + correo +
//     teléfono por tarjeta, servida en ISO-8859-1.
// Los casos negativos son los falsos positivos que aparecieron de verdad al
// probar contra esas webs (hash de imagen, RUT, email pegado al texto vecino).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeChilePhone,
  phonesFromText,
  extractContacto,
  pickContactPages,
  mergeContacto,
  addressFromText,
} from './parse-contacto-corredora-cl.mjs'

// ── normalizeChilePhone ──────────────────────────────────────────────────────

test('normaliza los formatos con que las webs escriben el mismo número', () => {
  for (const raw of ['+56995377271', '+569 9537 7271', '56995377271', '995377271',
                     '9 9537 7271', '(+56) 9-9537-7271', '0056995377271']) {
    assert.equal(normalizeChilePhone(raw), '+56995377271', `falló con "${raw}"`)
  }
})

test('acepta fijo de Santiago y regional', () => {
  assert.equal(normalizeChilePhone('+56 2 2422 908'), null) // 8 dígitos: incompleto
  assert.equal(normalizeChilePhone('+56 2 2242 2908'), '+56222422908')
  assert.equal(normalizeChilePhone('+56 32 2345 678'), '+56322345678')
})

test('rechaza lo que NO es un teléfono chileno', () => {
  assert.equal(normalizeChilePhone(null), null)
  assert.equal(normalizeChilePhone(''), null)
  assert.equal(normalizeChilePhone('12345678'), null)        // 8 dígitos
  assert.equal(normalizeChilePhone('1234567890'), null)      // 10 dígitos
  assert.equal(normalizeChilePhone('123456789'), null)       // empieza en 1
  assert.equal(normalizeChilePhone('999999999'), null)       // relleno de maqueta
  assert.equal(normalizeChilePhone('78.987.370-4'), null)    // RUT de la corredora
  assert.equal(normalizeChilePhone('78987370-K'), null)      // RUT con dígito K
})

// ── phonesFromText: los falsos positivos reales ─────────────────────────────

test('no captura dígitos incrustados en un hash de imagen', () => {
  // Caso real de chilepropiedades.cl: el nombre del .webp contiene "933370113",
  // que es un móvil chileno perfectamente válido si no se exige frontera.
  const text = '/imagenes/publicacion/9369f1147c62480491f933370113c3eb.webp 360w'
  assert.deepEqual(phonesFromText(text), [])
})

test('no confunde fechas ni códigos largos con teléfonos', () => {
  assert.deepEqual(phonesFromText('Actualizado 20260303 · folio 202511180001'), [])
})

test('captura con +56 explícito y con palabra clave delante', () => {
  assert.deepEqual(phonesFromText('Whatsapp Empresa: +569 9537 7271'), ['+56995377271'])
  assert.deepEqual(phonesFromText('Fono: 2 2242 2908'), ['+56222422908'])
  assert.deepEqual(phonesFromText('Celular 9 4546 1308'), ['+56945461308'])
})

test('un número suelto sin prefijo ni palabra clave NO se acepta', () => {
  assert.deepEqual(phonesFromText('Superficie 945461308 m2 de terreno'), [])
})

// ── extractContacto: fixture estilo finhabit.cl (Convecta) ──────────────────

const HTML_FINHABIT = `<!doctype html><html><head>
<meta name="author" content="Convecta Desarrollos Informaticos SpA"></head><body>
<ul class="contact-info">
  <li><a href="https://wa.me/56995377271" target="_blank">Whatsapp Empresa: +569 9537 7271</a></li>
  <li><a href="mailto:info@finhabit.cl">info@finhabit.cl</a></li>
  <li><a href="https://www.google.com/maps/place/Av.+Padre+Hurtado+Norte+1947/@-33.38,-70.55,17z">Av. Padre Hurtado Norte 1947, Vitacura, Santiago de Chile</a></li>
</ul>
<footer>Desarrollado por <a href="https://convecta.cl">Convecta</a></footer>
</body></html>`

test('finhabit: WhatsApp, email y dirección desde los enlaces declarados', () => {
  const r = extractContacto(HTML_FINHABIT, { url: 'https://www.finhabit.cl/contacto.aspx', domain: 'finhabit.cl' })
  assert.deepEqual(r.phones, ['+56995377271'])
  assert.deepEqual(r.whatsapp, ['+56995377271'])
  assert.deepEqual(r.emails, ['info@finhabit.cl'])
  assert.equal(r.address, 'Av. Padre Hurtado Norte 1947, Vitacura, Santiago de Chile')
})

test('el correo del proveedor del CRM no se guarda como de la corredora', () => {
  const html = `<body><a href="mailto:soporte@convecta.cl">soporte</a>
    <a href="mailto:info@finhabit.cl">info</a></body>`
  assert.deepEqual(extractContacto(html).emails, ['info@finhabit.cl'])
})

test('elementos contiguos no se pegan formando un email inexistente', () => {
  // Caso real de magnoliaproperty.cl: <li>hola@…cl</li><li>tel</li> daba
  // "hola@magnoliaproperty.cltel" al concatenar sin separador.
  const html = `<body><ul><li>hola@magnoliaproperty.cl</li><li>tel</li></ul></body>`
  assert.deepEqual(extractContacto(html).emails, ['hola@magnoliaproperty.cl'])
})

// ── extractContacto: fixture estilo bpropiedades.cl (equipo) ────────────────

const HTML_EQUIPO = `<body><section class="team">
  <div class="card">
    <h4>Verónica Boetsch Vicuña Socia</h4><p>Socia Fundadora</p>
    <a href="mailto:vboetsch@bpropiedades.cl">vboetsch@bpropiedades.cl</a>
    <a href="tel:+56993343428">+56 9 9334 3428</a>
  </div>
  <div class="card">
    <h4>Luz María de la Sotta</h4><p>Agente Inmobiliario</p>
    <a href="mailto:ldelasotta@bpropiedades.cl">correo</a>
  </div>
  <div class="card">
    <h4>Contáctese Con Nosotros</h4><p>Nuestros agentes le responden</p>
  </div>
</section></body>`

test('equipo: nombre, cargo, email y teléfono por persona', () => {
  const r = extractContacto(HTML_EQUIPO, { url: 'https://www.bpropiedades.cl/equipo.asp', corredoraName: 'b propiedades' })
  const vero = r.people.find((p) => p.full_name.startsWith('Verónica'))
  assert.ok(vero, 'no encontró a la socia fundadora')
  // El cargo va en role_raw, NO pegado al nombre.
  assert.equal(vero.full_name, 'Verónica Boetsch Vicuña')
  assert.equal(vero.role_kind, 'jefatura')
  assert.equal(vero.email, 'vboetsch@bpropiedades.cl')
  assert.equal(vero.phone, '+56993343428')
})

test('equipo: los apellidos con partícula no se cortan', () => {
  const r = extractContacto(HTML_EQUIPO)
  assert.ok(r.people.some((p) => p.full_name === 'Luz María de la Sotta'),
    `esperaba "Luz María de la Sotta", salió: ${r.people.map((p) => p.full_name).join(' | ')}`)
})

test('equipo: un titular de sección no se guarda como persona', () => {
  const r = extractContacto(HTML_EQUIPO)
  assert.ok(!r.people.some((p) => /cont[aá]ctese|nosotros/i.test(p.full_name)))
})

test('la razón social no se cuela como persona del equipo', () => {
  const html = `<body><div>Finhabit Propiedades · Corredora de propiedades</div></body>`
  const r = extractContacto(html, { corredoraName: 'finhabit propiedades' })
  assert.deepEqual(r.people, [])
})

// ── JSON-LD y redes ─────────────────────────────────────────────────────────

test('JSON-LD de Organization aporta teléfono, email y dirección', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@type":"RealEstateAgent","telephone":"+56 2 2470 0360","email":"hola@magnoliaproperty.cl",
     "address":{"streetAddress":"Vespucio Norte 1128","addressLocality":"Vitacura"}}
  </script></head><body>web</body></html>`
  const r = extractContacto(html)
  assert.deepEqual(r.phones, ['+56224700360'])
  assert.deepEqual(r.emails, ['hola@magnoliaproperty.cl'])
  assert.equal(r.address, 'Vespucio Norte 1128, Vitacura')
})

test('redes sociales sí, botones de compartir no', () => {
  const html = `<body>
    <a href="https://www.instagram.com/magnoliaproperty">ig</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">compartir</a>
  </body>`
  const r = extractContacto(html)
  assert.equal(r.socials.instagram, 'https://www.instagram.com/magnoliaproperty')
  assert.equal(r.socials.facebook, undefined)
})

// ── addressFromText ─────────────────────────────────────────────────────────

test('dirección en texto: exige vía + número', () => {
  assert.equal(addressFromText('Estamos en Av. Apoquindo 3000, Las Condes.'), 'Av. Apoquindo 3000')
  assert.equal(addressFromText('Somos una corredora con 29 años de experiencia'), null)
})

// ── pickContactPages ────────────────────────────────────────────────────────

test('elige páginas institucionales del MISMO dominio, contacto primero', () => {
  const html = `<body>
    <a href="/propiedades.aspx">Propiedades</a>
    <a href="/nosotros.aspx">Quiénes somos</a>
    <a href="/contacto.aspx">Contacto</a>
    <a href="https://www.portalinmobiliario.com/x">Ver en el portal</a>
  </body>`
  const pages = pickContactPages(html, { domain: 'finhabit.cl' })
  assert.equal(pages[0], 'https://www.finhabit.cl/contacto.aspx')
  assert.ok(pages.includes('https://www.finhabit.cl/nosotros.aspx'))
  assert.ok(!pages.some((u) => u.includes('portalinmobiliario')))
  assert.ok(!pages.some((u) => u.includes('propiedades.aspx')))
})

test('respeta el tope de páginas (crawl cortés, H22)', () => {
  const html = `<body>${['contacto', 'nosotros', 'equipo', 'about', 'staff', 'empresa']
    .map((s) => `<a href="/${s}">${s}</a>`).join('')}</body>`
  assert.equal(pickContactPages(html, { domain: 'x.cl', max: 2 }).length, 2)
})

// ── mergeContacto ───────────────────────────────────────────────────────────

test('fusiona páginas sin duplicar y completa a la misma persona', () => {
  const merged = mergeContacto([
    { phones: ['+56995377271'], whatsapp: ['+56995377271'], emails: [], address: null, socials: {},
      people: [{ full_name: 'Ana Urzúa', role_raw: null, role_kind: 'desconocido', email: 'a@x.cl', phone: null }],
      source_url: 'https://www.x.cl/' },
    { phones: ['+56995377271', '+56222422908'], whatsapp: [], emails: ['info@x.cl'],
      address: 'Av. Apoquindo 3000', socials: { instagram: 'https://instagram.com/x' },
      people: [{ full_name: 'ana urzúa', role_raw: 'Gerente', role_kind: 'jefatura', email: null, phone: '+56999888777' }],
      source_url: 'https://www.x.cl/equipo' },
  ])
  assert.deepEqual(merged.phones, ['+56995377271', '+56222422908'])
  assert.deepEqual(merged.emails, ['info@x.cl'])
  assert.equal(merged.address, 'Av. Apoquindo 3000')
  assert.equal(merged.source_urls.length, 2)
  assert.equal(merged.people.length, 1)
  assert.equal(merged.people[0].role_kind, 'jefatura')
  assert.equal(merged.people[0].email, 'a@x.cl')
  assert.equal(merged.people[0].phone, '+56999888777')
})

test('HTML vacío o basura no revienta', () => {
  for (const bad of [null, undefined, '', 123, '<<<>>']) {
    const r = extractContacto(bad)
    assert.deepEqual(r.phones, [])
    assert.deepEqual(r.people, [])
  }
})
