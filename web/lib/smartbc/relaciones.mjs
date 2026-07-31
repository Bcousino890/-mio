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
 * De quién es un teléfono: su nombre y la relación concreta.
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
 * @param {{ ownerName?: string | null, relacionados?: Array<{ nombre?: string | null, relacion?: string | null }> }} [opts]
 * @returns {{ name: string, relationship: string | null, esTitular: boolean }}
 */
export function duenoDeTelefono(relacion, { ownerName = null, relacionados = [] } = {}) {
  const relaciones = splitRelaciones(relacion)
  if (!relaciones.length) return { name: ownerName ?? '', relationship: null, esTitular: true }
  for (const r of relaciones) {
    const hit = relacionados.find((x) => foldRelacion(x?.relacion) === foldRelacion(r))
    if (hit?.nombre) return { name: hit.nombre, relationship: r, esTitular: false }
  }
  return { name: '', relationship: relaciones[0], esTitular: false }
}
