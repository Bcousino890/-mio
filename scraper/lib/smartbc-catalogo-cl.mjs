// ─────────────────────────────────────────────────────────────────────────────
// Normalización de región / comuna / zona contra el catálogo de SmartBC.
//
// El contrato es explícito: "No mandes texto libre en región y comuna. Normaliza
// contra el catálogo". Este módulo descarga ese catálogo y traduce nuestra
// nomenclatura (chile_comunas / chile-comunas.mjs) a la suya ANTES de enviar.
//
// Por qué hace falta traducir y no basta con mandar nuestro nombre: los dos
// sistemas escriben lo mismo de formas distintas ("Región Metropolitana de
// Santiago" frente a "Metropolitana", "Ñuñoa" frente a "Nunoa"), y una comuna
// que no case se queda sin normalizar en su lado. El emparejamiento se hace
// sobre el texto plegado —sin tildes, sin mayúsculas, sin dobles espacios— que
// es lo único estable entre ambas taxonomías, más el código de región que
// SmartBC empezó a devolver (`region_code`), que es aún más estable que el
// nombre.
//
// Lo que NO hace: inventar. Una comuna nuestra sin correspondencia en el
// catálogo se registra en `faltantes` y el campo NO viaja, en vez de colarse
// como texto libre. Es la instrucción literal del equipo de SmartBC ("si una
// comuna tuya no aparece en el listado, dímelo antes de forzarla"), y además es
// lo prudente: `commune` es campo del equipo y un valor equivocado se queda en
// su ficha.
// ─────────────────────────────────────────────────────────────────────────────

/** Texto plegado: sin tildes, minúsculas, espacios colapsados. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Variantes bajo las que buscar una región. Las dos taxonomías difieren sobre
 * todo en el prefijo ("Región de …", "Región del …") y en el sufijo geográfico
 * ("Región Metropolitana **de Santiago**"), así que se prueban todas las formas
 * antes de darla por ausente.
 */
export function regionVariants(name) {
  const base = fold(name)
  const sinPrefijo = base.replace(/^region\s+(de\s+l[ao]s?\s+|de\s+la\s+|del\s+|de\s+)?/, '')
  const out = new Set([base, sinPrefijo])
  out.add(sinPrefijo.replace(/\s+de\s+santiago$/, ''))   // Metropolitana de Santiago → Metropolitana
  out.add(sinPrefijo.replace(/^la\s+/, ''))              // la araucania → araucania
  return [...out].filter(Boolean)
}

/**
 * Descarga el catálogo geográfico completo.
 *
 * Las zonas se piden por comuna (su endpoint las filtra con `?comuna=`), así
 * que solo se descargan las de las comunas que nos interesan: pedir las 346
 * serían 346 peticiones y el límite es 120/min.
 */
export async function fetchCatalogo(smartbc, { comunasDeInteres = [] } = {}) {
  const [regiones, comunas] = await Promise.all([
    smartbc.catalogo('regiones').then((r) => r.data ?? []),
    smartbc.catalogo('comunas').then((r) => r.data ?? []),
  ])

  const zonasPorComuna = new Map()
  for (const nombre of comunasDeInteres) {
    const { data } = await smartbc.catalogo('zonas', { comuna: nombre })
    zonasPorComuna.set(fold(nombre), data ?? [])
  }

  return { regiones, comunas, zonasPorComuna }
}

/** Nombre de una entrada del catálogo, venga como string o como objeto. */
function nombreDe(entry) {
  if (typeof entry === 'string') return entry
  return entry?.name ?? entry?.nombre ?? entry?.label ?? null
}

/**
 * Índice de búsqueda sobre el catálogo. Devuelve funciones que traducen un
 * nombre nuestro al valor exacto de SmartBC, o `null` si no existe allí.
 */
export function buildNormalizer(catalogo) {
  const regionPorClave = new Map()
  for (const r of catalogo.regiones ?? []) {
    const nombre = nombreDe(r)
    if (!nombre) continue
    for (const v of regionVariants(nombre)) regionPorClave.set(v, nombre)
    // El código (RM, XVI…) es la clave más estable de todas.
    const code = typeof r === 'object' ? (r.code ?? r.region_code ?? null) : null
    if (code) regionPorClave.set(fold(code), nombre)
  }

  const comunaPorClave = new Map()
  for (const c of catalogo.comunas ?? []) {
    const nombre = nombreDe(c)
    if (!nombre) continue
    comunaPorClave.set(fold(nombre), {
      name: nombre,
      region: typeof c === 'object' ? (c.region ?? null) : null,
      regionCode: typeof c === 'object' ? (c.region_code ?? null) : null,
    })
  }

  const zonaPorComuna = new Map()
  for (const [comunaFold, zonas] of catalogo.zonasPorComuna ?? new Map()) {
    const idx = new Map()
    for (const z of zonas) {
      const nombre = nombreDe(z)
      if (nombre) idx.set(fold(nombre), nombre)
    }
    zonaPorComuna.set(comunaFold, idx)
  }

  // Lo que se intentó traducir y no estaba. Se acumula durante la corrida para
  // poder reportarlo entero al equipo de SmartBC, en vez de descubrirlo comuna
  // a comuna.
  const faltantes = { regiones: new Set(), comunas: new Set(), zonas: new Set() }

  return {
    faltantes,

    region(name) {
      if (!name) return null
      for (const v of regionVariants(name)) {
        const hit = regionPorClave.get(v)
        if (hit) return hit
      }
      faltantes.regiones.add(name)
      return null
    },

    comuna(name) {
      if (!name) return null
      const hit = comunaPorClave.get(fold(name))
      if (hit) return hit.name
      faltantes.comunas.add(name)
      return null
    },

    /** La región oficial de una comuna del catálogo, mejor que la nuestra. */
    regionDeComuna(name) {
      const hit = name ? comunaPorClave.get(fold(name)) : null
      return hit?.region ?? null
    },

    zona(comunaName, zonaName) {
      if (!zonaName) return null
      const idx = zonaPorComuna.get(fold(comunaName))
      // Sin zonas descargadas para esa comuna no se puede afirmar que falte:
      // se deja pasar la nuestra en vez de borrar un dato bueno.
      if (!idx) return zonaName
      const hit = idx.get(fold(zonaName))
      if (hit) return hit
      faltantes.zonas.add(`${comunaName} / ${zonaName}`)
      return null
    },
  }
}

/** Normalizador neutro: deja pasar todo tal cual. Para tests y para el caso
 *  en que el catálogo no esté disponible y se prefiera no bloquear la corrida. */
export const PASSTHROUGH = {
  faltantes: { regiones: new Set(), comunas: new Set(), zonas: new Set() },
  region: (v) => v ?? null,
  comuna: (v) => v ?? null,
  regionDeComuna: () => null,
  zona: (_comuna, v) => v ?? null,
}

/** Resumen legible de lo que no casó, para reportarlo al equipo de SmartBC. */
export function reportarFaltantes(faltantes) {
  const lineas = []
  if (faltantes.regiones.size) lineas.push(`regiones sin correspondencia: ${[...faltantes.regiones].join(', ')}`)
  if (faltantes.comunas.size) lineas.push(`comunas sin correspondencia: ${[...faltantes.comunas].join(', ')}`)
  if (faltantes.zonas.size) lineas.push(`zonas sin correspondencia: ${[...faltantes.zonas].join(', ')}`)
  return lineas
}
