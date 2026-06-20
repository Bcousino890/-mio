/**
 * Taxonomía canónica de comunas de Chile cubiertas por el módulo Chile:
 * toda la Región Metropolitana (52 comunas) + comunas de mayor valor fuera
 * de la RM (zonas de vacaciones/segunda vivienda de alto poder adquisitivo).
 *
 * `priority` marca el objetivo de scraping inicial: las comunas más caras
 * ("barrio alto") y las zonas de veraneo pedidas explícitamente. El resto
 * de la RM queda en la taxonomía (para cobertura/filtros) pero se scrapea
 * después, igual que Madrid empezó por Salamanca/Goya antes de expandir.
 */

export type ChileComuna = {
  name: string
  region: string
  provincia: string
  /** Localidades/sectores con identidad propia dentro de la comuna (ej. balnearios). */
  localidades?: string[]
  priority: boolean
}

export const CHILE_REGIONS = [
  'Región Metropolitana de Santiago',
  'Región de Valparaíso',
  'Región de la Araucanía',
] as const

const RM = 'Región Metropolitana de Santiago'
const VALPARAISO = 'Región de Valparaíso'
const ARAUCANIA = 'Región de la Araucanía'

// Comunas "barrio alto" — las más caras de la Región Metropolitana.
const BARRIO_ALTO = new Set(['Vitacura', 'Las Condes', 'Lo Barnechea', 'Providencia', 'La Reina', 'Ñuñoa'])

function comuna(name: string, provincia: string, opts: { region?: string; localidades?: string[]; priority?: boolean } = {}): ChileComuna {
  return {
    name,
    region: opts.region ?? RM,
    provincia,
    localidades: opts.localidades,
    priority: opts.priority ?? BARRIO_ALTO.has(name),
  }
}

export const CHILE_COMUNAS: ChileComuna[] = [
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
  comuna('Til Til', 'Chacabuco'),

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
export function groupByRegion(comunas: ChileComuna[] = CHILE_COMUNAS): Record<string, ChileComuna[]> {
  const groups: Record<string, ChileComuna[]> = {}
  for (const region of CHILE_REGIONS) groups[region] = []
  for (const c of comunas) (groups[c.region] ??= []).push(c)
  return groups
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const COMUNA_BY_FOLDED = new Map<string, ChileComuna>()
const LOCALIDAD_TO_COMUNA = new Map<string, ChileComuna>()
for (const c of CHILE_COMUNAS) {
  COMUNA_BY_FOLDED.set(fold(c.name), c)
  for (const loc of c.localidades ?? []) {
    LOCALIDAD_TO_COMUNA.set(fold(loc), c)
  }
}

export type NormalizedComuna = {
  comuna: ChileComuna | null
  /** Localidad reconocida dentro de la comuna (ej. "Cachagua" dentro de Zapallar). */
  localidad: string | null
  raw: string
}

/**
 * Normaliza un texto de ubicación "sucio" del scraper (comuna o localidad,
 * posiblemente con ruido tipo "Cachagua, Zapallar") a su comuna canónica.
 */
export function normalizeComuna(raw: string | null | undefined): NormalizedComuna {
  const text = (raw ?? '').trim()
  if (!text) return { comuna: null, localidad: null, raw: text }

  const candidates = [text, ...text.split(/[,\-–—/]| en /).map((p) => p.trim())].filter(Boolean)

  for (const c of candidates) {
    const f = fold(c).replace(/^(comuna|localidad|sector)\s+(de\s+)?/, '')
    const direct = COMUNA_BY_FOLDED.get(f)
    if (direct) return { comuna: direct, localidad: null, raw: text }
    const viaLocalidad = LOCALIDAD_TO_COMUNA.get(f)
    if (viaLocalidad) {
      const localidad = viaLocalidad.localidades!.find((l) => fold(l) === f) ?? null
      return { comuna: viaLocalidad, localidad, raw: text }
    }
  }
  return { comuna: null, localidad: null, raw: text }
}
