/**
 * Taxonomía canónica de zonas de Madrid capital: 21 distritos con sus
 * barrios. Se usa para ordenar/agrupar las zonas que llegan "sueltas" del
 * scraper de particulares (que mezcla distritos y barrios en un solo campo
 * `zone`) y para los filtros jerárquicos Distrito → Barrio.
 */

export const MADRID_DISTRICTS: Record<string, string[]> = {
  "Arganzuela": ["Acacias", "Atocha", "Chopera", "Delicias", "Imperial", "Legazpi", "Palos de Moguer", "Palos de la Frontera"],
  "Barajas": ["Aeropuerto", "Alameda de Osuna", "Casco Histórico de Barajas", "Corralejos", "Timón"],
  "Carabanchel": ["Abrantes", "Buenavista", "Comillas", "Opañel", "Puerta Bonita", "San Isidro", "Vista Alegre"],
  "Centro": ["Cortes", "Embajadores", "Justicia", "Lavapiés", "Malasaña", "Palacio", "Sol", "Universidad", "Chueca", "Huertas", "La Latina"],
  "Chamartín": ["Castilla", "Ciudad Jardín", "El Viso", "Hispanoamérica", "Nueva España", "Prosperidad"],
  "Chamberí": ["Almagro", "Arapiles", "Gaztambide", "Ríos Rosas", "Trafalgar", "Vallehermoso"],
  "Ciudad Lineal": ["Atalaya", "Colina", "Concepción", "Costillares", "Pueblo Nuevo", "Quintana", "San Juan Bautista", "San Pascual", "Ventas"],
  "Fuencarral-El Pardo": ["Barrio del Pilar", "El Goloso", "El Pardo", "Fuentelarreina", "La Paz", "Mirasierra", "Montecarmelo", "Peñagrande", "Tres Olivos", "Valverde", "Las Tablas", "Arroyofresno"],
  "Hortaleza": ["Apóstol Santiago", "Canillas", "Palomas", "Pinar del Rey", "Piovera", "Sanchinarro", "Valdebebas", "Valdefuentes"],
  "Latina": ["Aluche", "Águilas", "Campamento", "Cuatro Vientos", "Las Águilas", "Lucero", "Los Cármenes", "Puerta del Ángel"],
  "Moncloa-Aravaca": ["Aravaca", "Argüelles", "Casa de Campo", "Ciudad Universitaria", "El Plantío", "Valdemarín", "Valdezarza"],
  "Moratalaz": ["Fontarrón", "Horcajo", "Marroquina", "Media Legua", "Pavones", "Vinateros"],
  "Puente de Vallecas": ["Entrevías", "Numancia", "Palomeras Bajas", "Palomeras Sureste", "Portazgo", "San Diego"],
  "Retiro": ["Adelfas", "Estrella", "Ibiza", "Jerónimos", "Niño Jesús", "Pacífico"],
  "Salamanca": ["Castellana", "Fuente del Berro", "Goya", "Guindalera", "Lista", "Recoletos"],
  "San Blas-Canillejas": ["Amposta", "Arcos", "Canillejas", "Hellín", "Rejas", "Rosas", "Salvador", "Simancas"],
  "Tetuán": ["Almenara", "Bellas Vistas", "Berruguete", "Castillejos", "Cuatro Caminos", "Valdeacederas", "Ventilla"],
  "Usera": ["Almendrales", "Moscardó", "Orcasitas", "Orcasur", "Pradolongo", "San Fermín", "Zofío"],
  "Vicálvaro": ["Ambroz", "Casco Histórico de Vicálvaro", "El Cañaveral", "Valdebernardo", "Valderrivas"],
  "Villa de Vallecas": ["Casco Histórico de Vallecas", "Ensanche de Vallecas", "Santa Eugenia"],
  "Villaverde": ["Butarque", "Los Ángeles", "Los Rosales", "San Andrés", "San Cristóbal"],
};

export const MADRID_DISTRICT_NAMES = Object.keys(MADRID_DISTRICTS).sort((a, b) =>
  a.localeCompare(b, "es"),
);

/** Etiqueta para zonas que no casan con ningún distrito/barrio conocido. */
export const OTHER_ZONE_LABEL = "Otras zonas";

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Índice barrio(normalizado) → distrito y distrito(normalizado) → distrito.
const BARRIO_TO_DISTRICT = new Map<string, { district: string; barrio: string }>();
const DISTRICT_BY_FOLDED = new Map<string, string>();
for (const [district, barrios] of Object.entries(MADRID_DISTRICTS)) {
  DISTRICT_BY_FOLDED.set(fold(district), district);
  for (const barrio of barrios) {
    BARRIO_TO_DISTRICT.set(fold(barrio), { district, barrio });
  }
}

export type NormalizedZone = {
  /** Distrito canónico, u OTHER_ZONE_LABEL si no se reconoce. */
  district: string;
  /** Barrio canónico si la zona original era un barrio conocido. */
  barrio: string | null;
  /** Texto original tal cual vino del scraper (para mostrar/filtrar fino). */
  raw: string;
};

/**
 * Normaliza una zona "sucia" del scraper (puede ser distrito, barrio, o
 * texto libre tipo "Goya, Madrid") a su distrito + barrio canónicos.
 */
export function normalizeZone(raw: string | null | undefined): NormalizedZone {
  const text = (raw ?? "").trim();
  if (!text) return { district: OTHER_ZONE_LABEL, barrio: null, raw: text };

  // Probamos el texto completo y también sus fragmentos ("Goya - Madrid",
  // "Salamanca, Madrid", "barrio Goya").
  const candidates = [
    text,
    ...text.split(/[,\-–—/·]| en /).map((p) => p.trim()),
  ].filter(Boolean);

  for (const c of candidates) {
    const f = fold(c).replace(/^(barrio|distrito|zona)\s+(de\s+)?/, "");
    const district = DISTRICT_BY_FOLDED.get(f);
    if (district) return { district, barrio: null, raw: text };
    const viaBarrio = BARRIO_TO_DISTRICT.get(f);
    if (viaBarrio) {
      return { district: viaBarrio.district, barrio: viaBarrio.barrio, raw: text };
    }
  }
  return { district: OTHER_ZONE_LABEL, barrio: null, raw: text };
}
