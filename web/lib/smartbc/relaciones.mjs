// ─────────────────────────────────────────────────────────────────────────────
// Parentescos de DealerNet. Módulo aparte, y sin una sola dependencia de Node,
// a propósito: lo usan el mapper (servidor) y la ficha de Captación (componente
// de cliente). Si viviera dentro de mapper.mjs, importarlo desde el navegador
// arrastraría `node:crypto` al bundle y el build de Next se cae.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Relaciones de un teléfono, en orden.
 *
 * Un mismo número puede pertenecer a varias personas del entorno del dueño y
 * DealerNet lo expresa en una sola cadena: `"Conyuge, Hija, Suegra"` es un
 * teléfono compartido por las tres. Comparar esa cadena entera contra la
 * relación de un relacionado ("Conyuge") no casa nunca, y el nombre se quedaba
 * en blanco justo en los números más útiles: los del entorno directo.
 *
 * La primera relación es la más directa —DealerNet las devuelve de más a menos
 * cercana al titular— así que es la que decide de quién es el teléfono.
 */
export function splitRelaciones(texto) {
  if (!texto) return []
  return String(texto)
    .replace(/^relaci[oó]n\s+directa\s+con\s+/i, '')
    .split(/\s*,\s*/)
    .map((r) => r.trim())
    .filter(Boolean)
}

/** Texto plegado: sin tildes, minúsculas, sin espacios de más. */
export function foldRelacion(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * ¿Esta relación (simple o compuesta, "Titular, Sociedad") incluye "Titular"?
 *
 * DealerNet no siempre deja el campo vacío para el número del propio dueño:
 * a veces lo etiqueta explícitamente "Titular" (o "Titular, Sociedad" cuando
 * el número también es de la empresa). Tratar "solo vacío = titular" perdía
 * ese caso, y el contacto acababa viajando a SmartBC como other en vez de
 * owner — ahí es donde se ve "OTRO" junto al nombre del dueño.
 */
export function esRelacionTitular(relacion) {
  return splitRelaciones(relacion).some((r) => foldRelacion(r) === 'titular')
}

/**
 * Una persona de la ficha, lista para elegirla como dueña de un teléfono.
 *
 * @typedef {Object} Persona
 * @property {string} nombre
 * @property {string | null} relacion
 * @property {string | null} rut RUT ya formateado ("9250701-7"), si se conoce.
 * @property {number | null} edad Edad aproximada estimada por RUT (ver `edadAproximada`). `null` en RUT de empresa o sin RUT.
 */

/** RUT de un relacionado, que DealerNet entrega partido en número y dígito. */
export function rutDeRelacionado(rel) {
  if (rel?.rut == null || rel.rut === '') return null
  return `${rel.rut}${rel.dv ? `-${rel.dv}` : ''}`
}

// ─── Edad aproximada por RUT ────────────────────────────────────────────────
// En Chile el RUT se asigna de forma correlativa al nacer (Registro Civil), así
// que el número por sí solo predice la fecha de nacimiento con precisión
// razonable. Misma regresión lineal (hasta la 5ª cifra decimal) en dos fuentes
// independientes:
//   · fvillena/rut-a-edad — 1175 RUT con fecha de nacimiento conocida,
//     R²=0.9574: https://github.com/fvillena/rut-a-edad
//   · desuc/desuctools::edad_rut — más precisión decimal, y calcula la edad
//     por fecha calendario (no por año truncado):
//     https://github.com/desuc/desuctools/blob/master/R/edad_rut.R
//
// Es una ESTIMACIÓN, no un dato verificado — sirve para distinguir a simple
// vista entre varios relacionados con el mismo parentesco ("Hijo" x3), nunca
// se envía al CRM. Puede fallar por años en casos puntuales (el propio
// docstring de desuctools lo advierte para personas migrantes: alguien que
// obtuvo su RUT ya adulto rompe el supuesto de fondo, "correlativo = orden de
// nacimiento"), así que ningún ajuste de coeficientes la vuelve exacta.
const RUT_EDAD_PENDIENTE = 3.3363697569700348e-6
const RUT_EDAD_INTERCEPTO = 1932.2573852507373
const MS_POR_DIA = 24 * 60 * 60 * 1000

/**
 * Correlativo numérico de un RUT formateado ("9.250.701-7" → 9250701).
 * Asume el separador `-` antes del dígito verificador, que es como lo
 * formatea todo este pipeline (ver `rutDeRelacionado` y `captar-pipeline.ts`).
 */
export function numeroDeRut(rutTexto) {
  if (rutTexto == null) return null
  const [numStr] = String(rutTexto).trim().split('-')
  const digits = numStr.replace(/\D/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Año decimal (p. ej. 1949.36) → fecha calendario, repartiendo la fracción en
 * los milisegundos reales de ESE año (365 o 366 días según corresponda).
 * Mismo cálculo que hace `lubridate::date_decimal()` en desuc/desuctools.
 *
 * @param {number} anioDecimal
 * @returns {Date}
 */
function fechaDesdeAnioDecimal(anioDecimal) {
  const anio = Math.floor(anioDecimal)
  const inicioAnio = Date.UTC(anio, 0, 1)
  const inicioSiguiente = Date.UTC(anio + 1, 0, 1)
  return new Date(inicioAnio + (anioDecimal - anio) * (inicioSiguiente - inicioAnio))
}

/**
 * Edad aproximada de una persona natural a partir del correlativo de su RUT.
 *
 * `null` si la fecha de nacimiento estimada queda en el futuro respecto a
 * `hoy` — RUT de empresa (nunca fue asignado al nacer) o correlativo
 * corrupto. No hace falta distinguirlos a mano: la fórmula misma los delata,
 * porque les da una fecha de nacimiento fuera de cualquier vida humana
 * posible (una Sociedad con RUT 76.xxx.xxx "nacería" en 2185).
 *
 * @param {number | string | null | undefined} rutNumerico Correlativo SIN dígito verificador.
 * @param {Date} [hoy]
 * @returns {number | null}
 */
export function edadAproximada(rutNumerico, hoy = new Date()) {
  const n = Number(rutNumerico)
  if (!Number.isFinite(n) || n <= 0) return null
  const nacimiento = fechaDesdeAnioDecimal(n * RUT_EDAD_PENDIENTE + RUT_EDAD_INTERCEPTO)
  if (nacimiento.getTime() > hoy.getTime()) return null
  const edad = Math.floor((hoy.getTime() - nacimiento.getTime()) / MS_POR_DIA / 365.25)
  // Cota defensiva: con el intercepto actual ningún RUT válido pasa de ~95
  // años calculados desde hoy, pero no cuesta nada dejar el resguardo.
  return edad <= 110 ? edad : null
}

/**
 * De quién es un teléfono: su nombre, la relación concreta y su RUT.
 *
 * DealerNet entrega las dos mitades por separado —en el número solo pone el
 * parentesco, y los nombres van en la lista de relacionados— así que aquí se
 * cierra la correspondencia. Sin parentesco, el número es del titular.
 *
 * Los tipos van en JSDoc porque este módulo lo consumen dos mundos: el mapper
 * (Node) y la ficha de Captación (TypeScript). Sin ellos, TS infiere `never[]`
 * y `null` de los valores por defecto y rechaza cualquier dato real.
 *
 * @param {string | null | undefined} relacion
 * @param {{ ownerName?: string | null, ownerRut?: string | null, relacionados?: Array<{ rut?: number | string | null, dv?: string | null, nombre?: string | null, relacion?: string | null }> }} [opts]
 * @returns {{ name: string, relationship: string | null, rut: string | null, edad: number | null, esTitular: boolean }}
 */
export function duenoDeTelefono(relacion, { ownerName = null, ownerRut = null, relacionados = [] } = {}) {
  const relaciones = splitRelaciones(relacion)
  if (!relaciones.length) {
    return {
      name: ownerName ?? '', relationship: null, rut: ownerRut,
      edad: edadAproximada(numeroDeRut(ownerRut)), esTitular: true,
    }
  }
  for (const r of relaciones) {
    const hit = relacionados.find((x) => foldRelacion(x?.relacion) === foldRelacion(r))
    if (hit?.nombre) {
      const rut = rutDeRelacionado(hit)
      return { name: hit.nombre, relationship: r, rut, edad: edadAproximada(numeroDeRut(rut)), esTitular: false }
    }
  }
  return { name: '', relationship: relaciones[0], rut: null, edad: null, esTitular: false }
}

/**
 * Todas las personas que pueden ser dueñas de un teléfono de la ficha: los
 * relacionados de DealerNet y, si no viene entre ellos, el titular del
 * certificado TGR.
 *
 * El titular del TGR va al final y no al principio a propósito: si DealerNet ya
 * trae su propia fila "Titular", esa es la que manda —es la persona cuyo RUT se
 * consultó— y `duenoDeTelefono` la sigue eligiendo igual que antes. El nombre
 * del certificado se suma detrás porque no siempre coinciden: TGR puede dar la
 * sociedad dueña del inmueble mientras DealerNet responde por la persona.
 *
 * @param {{ relacionados?: Array<{ rut?: number | string | null, dv?: string | null, nombre?: string | null, relacion?: string | null }>, ownerName?: string | null, ownerRut?: string | null }} [opts]
 * @returns {Persona[]}
 */
export function personasDeLaFicha({ relacionados = [], ownerName = null, ownerRut = null } = {}) {
  /** @type {Persona[]} */
  const personas = []
  const vistos = new Set()
  for (const rel of relacionados) {
    const nombre = String(rel?.nombre ?? '').trim()
    if (!nombre) continue
    const rut = rutDeRelacionado(rel)
    // El RUT identifica a la persona; sin él, el nombre. Una misma persona
    // puede figurar dos veces (hijo y socio a la vez) y en el selector es una.
    const clave = rut ?? foldRelacion(nombre)
    if (vistos.has(clave)) continue
    vistos.add(clave)
    // El correlativo crudo (`rel.rut`) todavía está a mano acá — no hace
    // falta reconstruirlo desde el `rut` ya formateado.
    personas.push({ nombre, relacion: rel?.relacion ?? null, rut, edad: edadAproximada(rel?.rut) })
  }
  const titular = String(ownerName ?? '').trim()
  // Por NOMBRE, no por RUT: el RUT del certificado TGR y el que respondió
  // DealerNet no tienen por qué ser el mismo, y duplicar a la misma persona con
  // dos RUT distintos es peor que no ofrecerla dos veces.
  const nombres = new Set(personas.map((p) => foldRelacion(p.nombre)))
  if (titular && !nombres.has(foldRelacion(titular))) {
    personas.push({
      nombre: titular, relacion: 'Titular', rut: ownerRut ?? null,
      edad: edadAproximada(numeroDeRut(ownerRut)),
    })
  }
  return personas
}

/**
 * Candidatos a dueño de UN teléfono, en el orden en que se ofrecen para elegir.
 *
 * DealerNet no dice de quién es un número: solo el parentesco, y de "Hijo"
 * puede haber tres. Los que calzan con el parentesco del teléfono van primero
 * —y en el orden en que el propio teléfono los nombra, así el primer candidato
 * es exactamente el que `duenoDeTelefono` elige solo—; detrás va el resto de la
 * ficha, porque el parentesco a veces no calza con nadie y el nombre está igual
 * en la tabla.
 *
 * @param {string | null | undefined} relacion
 * @param {Persona[]} [personas]
 * @returns {{ sugeridos: Persona[], otros: Persona[] }}
 */
export function candidatosDeNombre(relacion, personas = []) {
  const orden = splitRelaciones(relacion).map(foldRelacion)
  /** @type {Array<{ persona: Persona, i: number }>} */
  const calzan = []
  /** @type {Persona[]} */
  const otros = []
  for (const persona of personas) {
    const i = orden.indexOf(foldRelacion(persona?.relacion))
    if (i >= 0) calzan.push({ persona, i })
    else otros.push(persona)
  }
  // Orden estable: dentro del mismo parentesco mandan como vienen de DealerNet,
  // que los devuelve de más a menos cercano al titular.
  calzan.sort((a, b) => a.i - b.i)
  return { sugeridos: calzan.map((c) => c.persona), otros }
}
