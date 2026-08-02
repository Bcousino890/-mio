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
 * Una persona de la ficha, lista para elegirla como dueña de un teléfono.
 *
 * @typedef {Object} Persona
 * @property {string} nombre
 * @property {string | null} relacion
 * @property {string | null} rut RUT ya formateado ("9250701-7"), si se conoce.
 */

/** RUT de un relacionado, que DealerNet entrega partido en número y dígito. */
export function rutDeRelacionado(rel) {
  if (rel?.rut == null || rel.rut === '') return null
  return `${rel.rut}${rel.dv ? `-${rel.dv}` : ''}`
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
 * @returns {{ name: string, relationship: string | null, rut: string | null, esTitular: boolean }}
 */
export function duenoDeTelefono(relacion, { ownerName = null, ownerRut = null, relacionados = [] } = {}) {
  const relaciones = splitRelaciones(relacion)
  if (!relaciones.length) return { name: ownerName ?? '', relationship: null, rut: ownerRut, esTitular: true }
  for (const r of relaciones) {
    const hit = relacionados.find((x) => foldRelacion(x?.relacion) === foldRelacion(r))
    if (hit?.nombre) return { name: hit.nombre, relationship: r, rut: rutDeRelacionado(hit), esTitular: false }
  }
  return { name: '', relationship: relaciones[0], rut: null, esTitular: false }
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
    personas.push({ nombre, relacion: rel?.relacion ?? null, rut })
  }
  const titular = String(ownerName ?? '').trim()
  // Por NOMBRE, no por RUT: el RUT del certificado TGR y el que respondió
  // DealerNet no tienen por qué ser el mismo, y duplicar a la misma persona con
  // dos RUT distintos es peor que no ofrecerla dos veces.
  const nombres = new Set(personas.map((p) => foldRelacion(p.nombre)))
  if (titular && !nombres.has(foldRelacion(titular))) {
    personas.push({ nombre: titular, relacion: 'Titular', rut: ownerRut ?? null })
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
