// Tests de los parentescos de DealerNet.
//
//   node --test lib/smartbc/relaciones.test.mjs
//
// El caso que los motiva: la ficha del rol 3604-34 (Lo Barnechea) trae 27
// relacionados —tres hijos, cuatro nietos, tres sociedades— y cada teléfono
// solo dice "Hijo". El pipeline elegía siempre al primero y el nombre se
// corregía a mano; ahora se elige de la lista, y estas funciones son las que
// deciden qué se ofrece y en qué orden.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  splitRelaciones,
  duenoDeTelefono,
  personasDeLaFicha,
  candidatosDeNombre,
  rutDeRelacionado,
  numeroDeRut,
  edadAproximada,
} from './relaciones.mjs'

// Recorte real de la ficha de Lo Barnechea (nombres y RUT tal como los
// devuelve DealerNet, partidos en número y dígito verificador).
const RELACIONADOS = [
  { rut: 4187271, dv: '3', nombre: 'Tamara Patricia Chirighin Chamorro', relacion: 'Titular' },
  { rut: 96517970, dv: '4', nombre: 'Inversiones Daco S A', relacion: 'Sociedad' },
  { rut: 76073333, dv: '4', nombre: 'Inmobiliaria Tamara Spa', relacion: 'Sociedad' },
  { rut: 9250701, dv: '7', nombre: 'Alejandro Danus Chirighin', relacion: 'Hijo' },
  { rut: 7415795, dv: '5', nombre: 'Francisco Javier Danus Chirighin', relacion: 'Hijo' },
  { rut: 7415785, dv: '8', nombre: 'Luis Patricio Danus Chirighin', relacion: 'Hijo' },
  { rut: 9253268, dv: '2', nombre: 'Luz Maria Danus Chirighin', relacion: 'Hija' },
]

test('el RUT de un relacionado se arma con su dígito verificador', () => {
  assert.equal(rutDeRelacionado({ rut: 9250701, dv: '7' }), '9250701-7')
  assert.equal(rutDeRelacionado({ rut: '7415795', dv: null }), '7415795')
  assert.equal(rutDeRelacionado({ rut: null, dv: '3' }), null)
  assert.equal(rutDeRelacionado(null), null)
})

// ─── Personas de la ficha ────────────────────────────────────────────────────

test('las personas de la ficha salen de los relacionados, con su RUT armado', () => {
  const personas = personasDeLaFicha({ relacionados: RELACIONADOS })
  assert.equal(personas.length, RELACIONADOS.length)
  assert.deepEqual(personas[3], {
    nombre: 'Alejandro Danus Chirighin', relacion: 'Hijo', rut: '9250701-7',
    edad: edadAproximada(9250701),
  })
})

test('el titular del certificado TGR se suma si DealerNet no lo trae', () => {
  const personas = personasDeLaFicha({
    relacionados: RELACIONADOS,
    ownerName: 'Sucesion Krunoslav Chirighin',
    ownerRut: '4187271-3',
  })
  const titular = personas.at(-1)
  assert.deepEqual(titular, {
    nombre: 'Sucesion Krunoslav Chirighin', relacion: 'Titular', rut: '4187271-3',
    edad: edadAproximada(4187271),
  })
})

test('el titular del TGR no se duplica cuando ya está entre los relacionados', () => {
  // Caso real: TGR da como dueña a la sociedad, que DealerNet lista con OTRO
  // RUT (el suyo) mientras el consultado es el de la persona. Duplicarla con
  // dos RUT distintos sería peor que ofrecerla una vez.
  const personas = personasDeLaFicha({
    relacionados: RELACIONADOS,
    ownerName: 'INMOBILIARIA TAMARA SPA',
    ownerRut: '4187271-3',
  })
  const tamara = personas.filter((p) => /tamara spa/i.test(p.nombre))
  assert.equal(tamara.length, 1)
  assert.equal(tamara[0].rut, '76073333-4', 'gana el RUT de DealerNet, no el del certificado')
})

test('una persona que figura dos veces se ofrece una sola', () => {
  const personas = personasDeLaFicha({
    relacionados: [
      { rut: 9250701, dv: '7', nombre: 'Alejandro Danus Chirighin', relacion: 'Hijo' },
      { rut: 9250701, dv: '7', nombre: 'Alejandro Danus Chirighin', relacion: 'Socio' },
    ],
  })
  assert.equal(personas.length, 1)
  assert.equal(personas[0].relacion, 'Hijo', 'manda la relación más directa, la primera')
})

test('un relacionado sin nombre no es elegible', () => {
  const personas = personasDeLaFicha({
    relacionados: [{ rut: 1, dv: '9', nombre: '  ', relacion: 'Nieto' }],
  })
  assert.deepEqual(personas, [])
})

// ─── Candidatos por teléfono ─────────────────────────────────────────────────

test('con tres hijos, los tres se ofrecen para el teléfono de "Hijo"', () => {
  // El bug de fondo: el pipeline elegía a Alejandro y no había forma de decir
  // que el número era de Luis Patricio sin escribir el nombre a mano.
  const personas = personasDeLaFicha({ relacionados: RELACIONADOS })
  const { sugeridos, otros } = candidatosDeNombre('Hijo', personas)
  assert.deepEqual(sugeridos.map((p) => p.nombre), [
    'Alejandro Danus Chirighin',
    'Francisco Javier Danus Chirighin',
    'Luis Patricio Danus Chirighin',
  ])
  assert.ok(otros.some((p) => p.nombre === 'Luz Maria Danus Chirighin'), 'la hija queda en el resto')
  assert.equal(sugeridos.length + otros.length, personas.length, 'nadie se pierde por el camino')
})

test('un teléfono compartido ofrece a todos sus parientes, en el orden del número', () => {
  const personas = personasDeLaFicha({ relacionados: RELACIONADOS })
  const { sugeridos } = candidatosDeNombre('Relación directa con Titular, Sociedad', personas)
  assert.deepEqual(sugeridos.map((p) => p.nombre), [
    'Tamara Patricia Chirighin Chamorro',
    'Inversiones Daco S A',
    'Inmobiliaria Tamara Spa',
  ])
})

test('el primer candidato es el que el pipeline elige solo', () => {
  // Invariante: lo que la lista propone primero y lo que `duenoDeTelefono`
  // rellena al marcar el teléfono tienen que ser la misma persona, o la ficha
  // se contradice a sí misma.
  const personas = personasDeLaFicha({ relacionados: RELACIONADOS })
  for (const relacion of ['Hijo', 'Hija', 'Sociedad', 'Titular, Sociedad', 'Conyuge, Hija']) {
    const { sugeridos } = candidatosDeNombre(relacion, personas)
    const auto = duenoDeTelefono(relacion, { relacionados: personas })
    assert.equal(sugeridos[0]?.nombre ?? '', auto.name, `no coinciden para «${relacion}»`)
  }
})

test('sin parentesco en el número no hay sugerencias, pero la ficha entera sigue elegible', () => {
  const personas = personasDeLaFicha({ relacionados: RELACIONADOS })
  const { sugeridos, otros } = candidatosDeNombre(null, personas)
  assert.deepEqual(sugeridos, [])
  assert.equal(otros.length, personas.length)
})

test('un parentesco que no calza con nadie deja igual toda la lista a mano', () => {
  const personas = personasDeLaFicha({ relacionados: RELACIONADOS })
  const { sugeridos, otros } = candidatosDeNombre('Empleador', personas)
  assert.deepEqual(sugeridos, [])
  assert.equal(otros.length, personas.length)
})

// ─── Dueño del teléfono ──────────────────────────────────────────────────────

test('el dueño de un teléfono viaja con su RUT', () => {
  const dueno = duenoDeTelefono('Hijo', { relacionados: RELACIONADOS })
  assert.deepEqual(dueno, {
    name: 'Alejandro Danus Chirighin', relationship: 'Hijo', rut: '9250701-7',
    edad: edadAproximada(9250701), esTitular: false,
  })
})

test('un número sin parentesco es del titular, con el RUT del certificado', () => {
  const dueno = duenoDeTelefono(null, { ownerName: 'María Pérez', ownerRut: '12345678-9' })
  assert.deepEqual(dueno, {
    name: 'María Pérez', relationship: null, rut: '12345678-9',
    edad: edadAproximada(12345678), esTitular: true,
  })
})

test('un parentesco sin nadie detrás no inventa nombre ni RUT', () => {
  const dueno = duenoDeTelefono('Suegra', { ownerName: 'María Pérez', relacionados: RELACIONADOS })
  assert.deepEqual(dueno, { name: '', relationship: 'Suegra', rut: null, edad: null, esTitular: false })
})

test('el texto "Relación directa con" del anuncio no cuenta como parentesco', () => {
  assert.deepEqual(splitRelaciones('Relación directa con Hijo, Nuera'), ['Hijo', 'Nuera'])
})

// ─── Edad aproximada por RUT (fvillena/rut-a-edad) ──────────────────────────

test('reproduce el ejemplo publicado del modelo: RUT 5126663 → 69 años (2018)', () => {
  // https://github.com/fvillena/rut-a-edad — "El individuo tiene 69 años y
  // nació en abril de 1949". Ancla el cálculo contra un resultado ya conocido,
  // no solo contra la fórmula reescrita.
  assert.equal(edadAproximada(5126663, new Date('2018-06-15')), 69)
})

test('la edad crece con el correlativo — más antiguo el RUT, mayor la edad', () => {
  const hoy = new Date('2026-01-01')
  const mayor = edadAproximada(2000000, hoy)
  const menor = edadAproximada(20000000, hoy)
  assert.ok(mayor > menor, 'un RUT más bajo (asignado antes) da una persona de más edad')
})

test('un RUT de empresa no da una edad — la fórmula lo delata sola', () => {
  // Sin necesitar el campo `clasificacion` (P/E) de DealerNet, que esta tabla
  // de relacionados nunca capturó: 76 millones "nacería" el año 2185.
  assert.equal(edadAproximada(76073333), null, 'Inmobiliaria Tamara Spa')
  assert.equal(edadAproximada(96517970), null, 'Inversiones Daco S A')
})

test('un correlativo inválido no revienta, da null', () => {
  assert.equal(edadAproximada(0), null)
  assert.equal(edadAproximada(-9250701), null)
  assert.equal(edadAproximada(null), null)
  assert.equal(edadAproximada(undefined), null)
  assert.equal(edadAproximada('no es un rut'), null)
})

test('el correlativo se extrae de un RUT formateado, con o sin puntos', () => {
  assert.equal(numeroDeRut('9.250.701-7'), 9250701)
  assert.equal(numeroDeRut('9250701-7'), 9250701)
  assert.equal(numeroDeRut('4187271-3'), 4187271)
  assert.equal(numeroDeRut(null), null)
  assert.equal(numeroDeRut('sin rut'), null)
})
