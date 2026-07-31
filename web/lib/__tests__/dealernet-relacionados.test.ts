// Tests del parser de "Relacionados" de DealerNet.
//
//   node --import tsx --test lib/__tests__/dealernet-relacionados.test.ts
//
// El caso que motiva estos tests: la ficha del rol 03858-00010 (Lo Barnechea)
// mostraba 97 relacionados — la familia y las sociedades del titular mezcladas
// con decenas de "propietario actual"/"propietario histórico" de otros
// inmuebles que el informe trae en sus propios bloques.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDealernetResponse, esPropietarioActual, esPropietarioHistorico } from '../dealernet'

function envelope(productCode: string, colectXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <CentralDeInformacionResult>
      <retcode>0</retcode>
      <retmsg>OK</retmsg>
      <output>
        <rut>
          <prd cod="${productCode}">
            <DLNTDIRTELEFONOWS>
              <ROOT>
                <D nombre="Bruno Guillermo Cominetti Infanti">
                  <result>
                    <colect>${colectXml}</colect>
                  </result>
                </D>
              </ROOT>
            </DLNTDIRTELEFONOWS>
          </prd>
        </rut>
      </output>
    </CentralDeInformacionResult>
  </soap:Body>
</soap:Envelope>`
}

// Tabla real de relacionados, tal como viene en 3410 (verificada contra
// producción, ver docs/DEALERNET-PROTOCOLO.md §3).
const TABLA_RELACIONADOS = `
  <relacionados>
    <d><clasificacion>P</clasificacion><rut>7011574</rut><dv>3</dv>
       <nombres>Bruno Guillermo</nombres><apellidos>Cominetti Infanti</apellidos>
       <organizacion/><relacion>Titular</relacion></d>
    <d><clasificacion>E</clasificacion><rut>79861700</rut><dv>1</dv>
       <nombres/><apellidos/>
       <organizacion>Inmobiliaria Rio Claro Sociedad Anonima</organizacion>
       <relacion>Sociedad</relacion></d>
    <d><clasificacion>P</clasificacion><rut>10316924</rut><dv>0</dv>
       <nombres>Bernardita</nombres><apellidos>Garcia Galleguillos</apellidos>
       <organizacion/><relacion>Conyuge</relacion></d>
  </relacionados>`

// Teléfono con su <relacionados> anidado: solo <relacion>, sin RUT ni nombre.
const TELEFONOS = `
  <telefono_contacto_probable>
    <d><telefono>56 (9) 78989823</telefono><clasificacion>C</clasificacion>
       <ind_whatsapp>1</ind_whatsapp><ranking>4.5</ranking><calidad>2.7</calidad>
       <relacionados><relacion>Titular</relacion><relacion>Sociedad</relacion></relacionados>
    </d>
  </telefono_contacto_probable>`

test('extrae la tabla de relacionados y no duplica la relación por teléfono', () => {
  const r = parseDealernetResponse(envelope('3410', TELEFONOS + TABLA_RELACIONADOS), ['3410'])

  assert.equal(r.relacionados.length, 3)
  assert.deepEqual(
    r.relacionados.map(x => [x.rut, x.nombre, x.relacion]),
    [
      [7011574, 'Bruno Guillermo Cominetti Infanti', 'Titular'],
      [79861700, 'Inmobiliaria Rio Claro Sociedad Anonima', 'Sociedad'],
      [10316924, 'Bernardita Garcia Galleguillos', 'Conyuge'],
    ],
  )
  // La relación del teléfono sigue aplanándose como antes.
  assert.equal(r.phones[0].relacion, 'Titular, Sociedad')
})

test('los dueños de los predios del informe no son relacionados del titular', () => {
  // Bloque de direcciones/predios: misma forma (rut + nombre + relación) pero
  // fuera de <relacionados>. Es lo que metía 60+ desconocidos en la ficha.
  const residencias = `
    <residencia_probable>
      <d><direccion>Camino El Alba 11000</direccion><rol>03858-00010</rol>
         <titularidad>
           <d><rut>7011574</rut><dv>3</dv><nombre>Bruno Guillermo Cominetti Infanti</nombre>
              <relacion>propietario actual</relacion></d>
           <d><rut>78901030</rut><dv>7</dv><nombre>Comercial D Y B Limitada</nombre>
              <relacion>propietario historico</relacion></d>
         </titularidad>
      </d>
    </residencia_probable>
    <residencia_alternativa>
      <d><direccion>Av. Vitacura 2939</direccion>
         <titularidad>
           <d><rut>48121035</rut><dv>6</dv><nombre>Konstantopoulos Constantin</nombre>
              <relacion>propietario actual</relacion></d>
           <d><rut>77663110</rut><dv>8</dv><nombre>D2 Homecenters Chile Limitada</nombre>
              <relacion>propietario historico</relacion></d>
         </titularidad>
      </d>
    </residencia_alternativa>`

  const r = parseDealernetResponse(envelope('3410', TELEFONOS + residencias + TABLA_RELACIONADOS), ['3410'])

  assert.equal(r.relacionados.length, 3)
  assert.equal(r.relacionados.some(x => /propietario/i.test(x.relacion ?? '')), false)
  assert.equal(r.relacionados.some(x => x.nombre === 'Konstantopoulos Constantin'), false)
})

test('solo cuenta la tabla: un bloque suelto con forma de relación no entra', () => {
  // Cualquier otro bloque del informe puede traer rut + nombre + relación
  // (aquí, la malla societaria de una empresa del titular). Fuera del
  // contenedor <relacionados> no es un vínculo del titular.
  const mallaSocietaria = `
    <malla_societaria>
      <d><rut>5101562</rut><dv>2</dv><nombre>Luis Armando Montero Rios</nombre>
         <relacion>Socio</relacion></d>
    </malla_societaria>`

  const r = parseDealernetResponse(envelope('3410', mallaSocietaria + TABLA_RELACIONADOS), ['3410'])

  assert.equal(r.relacionados.length, 3)
  assert.equal(r.relacionados.some(x => x.nombre === 'Luis Armando Montero Rios'), false)
})

test('tampoco entran si DealerNet las mete dentro del contenedor', () => {
  const contaminada = `
    <relacionados>
      <d><rut>7011574</rut><dv>3</dv><nombres>Bruno Guillermo</nombres>
         <apellidos>Cominetti Infanti</apellidos><relacion>Titular</relacion></d>
      <d><rut>4329549</rut><dv>7</dv><nombre>Marcela Mercedes Raquel Bravo Santander</nombre>
         <relacion>propietario actual</relacion></d>
      <d><rut>76335793</rut><dv>7</dv><organizacion>Inversiones Cofanti Limitada</organizacion>
         <relacion>propietario histórico</relacion></d>
    </relacionados>`

  const r = parseDealernetResponse(envelope('3410', contaminada), ['3410'])

  assert.deepEqual(r.relacionados.map(x => x.relacion), ['Titular'])
})

test('3421 sin contenedor propio sigue leyéndose entero', () => {
  // El producto 3421 ES la tabla de relacionados; si su payload no usa el tag
  // <relacionados>, no puede devolver vacío.
  const suelto = `
    <d><rut>3157372</rut><dv>6</dv><nombre>Bruno Luigi Cominetti Palini</nombre>
       <relacion>Padre</relacion></d>
    <d><rut>7011576</rut><dv>K</dv><nombre>Claudia Cecilia Cominetti Infanti</nombre>
       <relacion>Hermana</relacion></d>`

  const r = parseDealernetResponse(envelope('3421', suelto), ['3421'])

  assert.deepEqual(r.relacionados.map(x => x.relacion), ['Padre', 'Hermana'])
})

// ─── Propietario actual vs. histórico (Buscador Múltiple por rol) ────────────
// El pipeline solo consulta al ACTUAL: un histórico ya no es el dueño y
// cada consulta de contactabilidad se paga.
test('reconoce la marca de propietario del candidato', () => {
  const cand = (propietario: string | null) => ({
    rut: 7011574, dv: '3', clasif: 'P', nombres: null, apellidos: null,
    razonSocial: null, propietario, similitud: null, probabilidad: 'Alta',
  })

  assert.equal(esPropietarioHistorico(cand('Histórico')), true)
  assert.equal(esPropietarioHistorico(cand('historico')), true)
  assert.equal(esPropietarioHistorico(cand(' HISTÓRICO ')), true)
  assert.equal(esPropietarioHistorico(cand('Actual')), false)
  // Sin marca (búsqueda por nombre/dirección) no es histórico: no hay dato,
  // y ahí manda el calce por nombre.
  assert.equal(esPropietarioHistorico(cand(null)), false)

  assert.equal(esPropietarioActual(cand('Actual')), true)
  assert.equal(esPropietarioActual(cand('Histórico')), false)
  assert.equal(esPropietarioActual(cand(null)), false)
})
