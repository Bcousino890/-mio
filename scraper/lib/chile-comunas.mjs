// ─────────────────────────────────────────────────────────────────────────────
// Port a JS plano (sin tipos, sin transpilación) de la taxonomía de comunas de
// Chile definida en `web/lib/chile-zones.ts`. El scraper es Node ESM puro y no
// puede `import` un .ts de la app Next.js, así que esta es una copia funcional
// de los datos estáticos (CHILE_COMUNAS) y de la lógica de normalización
// (`fold`, `normalizeComuna`).
//
// IMPORTANTE: si se edita la taxonomía en `web/lib/chile-zones.ts` (nuevas
// comunas, cambios de prioridad, etc.), hay que replicar el cambio aquí a
// mano — no hay generación automática todavía.
// ─────────────────────────────────────────────────────────────────────────────

export const CHILE_REGIONS = [
  'Región Metropolitana de Santiago',
  'Región de Valparaíso',
  'Región de la Araucanía',
]

const RM = 'Región Metropolitana de Santiago'
const VALPARAISO = 'Región de Valparaíso'
const ARAUCANIA = 'Región de la Araucanía'

// Comunas "barrio alto" — las más caras de la Región Metropolitana.
const BARRIO_ALTO = new Set(['Vitacura', 'Las Condes', 'Lo Barnechea', 'Providencia', 'La Reina', 'Ñuñoa'])

/**
 * `opts.aliases`: grafías alternativas del NOMBRE de la comuna (no sectores
 * dentro de ella). Portal Inmobiliario no siempre usa la grafía oficial de
 * SUBDERE/BCN: publica "Tiltil" donde la taxonomía dice "Til Til". Sin el alias,
 * `normalizeComuna` devolvía null y esos anuncios entraban con `comuna_id` NULL
 * — invisibles para los filtros por comuna y, peor, fuera del `markDelisted` del
 * discovery (que filtra por comuna_id), así que quedaban activos para siempre.
 */
function comuna(name, provincia, opts = {}) {
  return {
    name,
    region: opts.region ?? RM,
    provincia,
    localidades: opts.localidades,
    aliases: opts.aliases,
    priority: opts.priority ?? BARRIO_ALTO.has(name),
  }
}

export const CHILE_COMUNAS = [
  // ── Región Metropolitana · Provincia de Santiago (32) ──────────────────
  comuna('Cerrillos', 'Santiago'),
  comuna('Cerro Navia', 'Santiago'),
  comuna('Conchalí', 'Santiago'),
  comuna('El Bosque', 'Santiago'),
  comuna('Estación Central', 'Santiago'),
  comuna('Huechuraba', 'Santiago'),
  comuna('Independencia', 'Santiago'),
  comuna('La Cisterna', 'Santiago'),
  comuna('La Florida', 'Santiago'),
  comuna('La Granja', 'Santiago'),
  comuna('La Pintana', 'Santiago'),
  comuna('La Reina', 'Santiago'),
  comuna('Las Condes', 'Santiago'),
  comuna('Lo Barnechea', 'Santiago'),
  comuna('Lo Espejo', 'Santiago'),
  comuna('Lo Prado', 'Santiago'),
  comuna('Macul', 'Santiago'),
  comuna('Maipú', 'Santiago'),
  comuna('Ñuñoa', 'Santiago'),
  comuna('Pedro Aguirre Cerda', 'Santiago'),
  comuna('Peñalolén', 'Santiago'),
  comuna('Providencia', 'Santiago'),
  comuna('Pudahuel', 'Santiago'),
  comuna('Quilicura', 'Santiago'),
  comuna('Quinta Normal', 'Santiago'),
  comuna('Recoleta', 'Santiago'),
  comuna('Renca', 'Santiago'),
  comuna('San Joaquín', 'Santiago'),
  comuna('San Miguel', 'Santiago'),
  comuna('San Ramón', 'Santiago'),
  comuna('Santiago', 'Santiago'),
  comuna('Vitacura', 'Santiago'),

  // ── Región Metropolitana · Provincia de Cordillera (3) ──────────────────
  comuna('Puente Alto', 'Cordillera'),
  comuna('Pirque', 'Cordillera'),
  comuna('San José de Maipo', 'Cordillera'),

  // ── Región Metropolitana · Provincia de Chacabuco (3) ───────────────────
  comuna('Colina', 'Chacabuco'),
  comuna('Lampa', 'Chacabuco'),
  // Portal Inmobiliario la publica como "Tiltil" (verificado en vivo, 2026-07-28).
  comuna('Til Til', 'Chacabuco', { aliases: ['Tiltil'] }),

  // ── Región Metropolitana · Provincia de Maipo (4) ───────────────────────
  comuna('San Bernardo', 'Maipo'),
  comuna('Buin', 'Maipo'),
  comuna('Calera de Tango', 'Maipo'),
  comuna('Paine', 'Maipo'),

  // ── Región Metropolitana · Provincia de Melipilla (5) ───────────────────
  comuna('Melipilla', 'Melipilla'),
  comuna('Alhué', 'Melipilla'),
  comuna('Curacaví', 'Melipilla'),
  comuna('María Pinto', 'Melipilla'),
  comuna('San Pedro', 'Melipilla'),

  // ── Región Metropolitana · Provincia de Talagante (5) ───────────────────
  comuna('Talagante', 'Talagante'),
  comuna('El Monte', 'Talagante'),
  comuna('Isla de Maipo', 'Talagante'),
  comuna('Padre Hurtado', 'Talagante'),
  comuna('Peñaflor', 'Talagante'),

  // ── Zonas de vacaciones / segunda vivienda fuera de la RM ───────────────
  comuna('Zapallar', 'Petorca', { region: VALPARAISO, localidades: ['Cachagua'], priority: true }),
  comuna('Puchuncaví', 'Valparaíso', { region: VALPARAISO, localidades: ['Maitencillo'], priority: true }),
  comuna('Pucón', 'Cautín', { region: ARAUCANIA, priority: true }),
  comuna('Villarrica', 'Cautín', { region: ARAUCANIA, priority: true }),
]

export const CHILE_PRIORITY_COMUNAS = CHILE_COMUNAS.filter((c) => c.priority)

/** Comunas agrupadas por región, en el orden de CHILE_REGIONS. */
export function groupByRegion(comunas = CHILE_COMUNAS) {
  const groups = {}
  for (const region of CHILE_REGIONS) groups[region] = []
  for (const c of comunas) (groups[c.region] ??= []).push(c)
  return groups
}

export function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const COMUNA_BY_FOLDED = new Map()
const LOCALIDAD_TO_COMUNA = new Map()
for (const c of CHILE_COMUNAS) {
  COMUNA_BY_FOLDED.set(fold(c.name), c)
  // Los alias son la MISMA comuna escrita de otra forma, no un sector dentro de
  // ella: van al índice de comunas (localidad queda null), no al de localidades.
  for (const alias of c.aliases ?? []) {
    COMUNA_BY_FOLDED.set(fold(alias), c)
  }
  for (const loc of c.localidades ?? []) {
    LOCALIDAD_TO_COMUNA.set(fold(loc), c)
  }
}

/**
 * Normaliza un texto de ubicación "sucio" del scraper (comuna o localidad,
 * posiblemente con ruido tipo "Cachagua, Zapallar") a su comuna canónica.
 * Devuelve { comuna, localidad, raw }.
 */
export function normalizeComuna(raw) {
  const text = (raw ?? '').trim()
  if (!text) return { comuna: null, localidad: null, raw: text }

  const candidates = [text, ...text.split(/[,\-–—/]| en /).map((p) => p.trim())].filter(Boolean)

  for (const c of candidates) {
    const f = fold(c).replace(/^(comuna|localidad|sector)\s+(de\s+)?/, '')
    const direct = COMUNA_BY_FOLDED.get(f)
    if (direct) return { comuna: direct, localidad: null, raw: text }
    const viaLocalidad = LOCALIDAD_TO_COMUNA.get(f)
    if (viaLocalidad) {
      const localidad = viaLocalidad.localidades.find((l) => fold(l) === f) ?? null
      return { comuna: viaLocalidad, localidad, raw: text }
    }
  }
  return { comuna: null, localidad: null, raw: text }
}
