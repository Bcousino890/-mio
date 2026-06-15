// Extracción del número de planta de un anuncio.
//
// No existe columna `floor` en BD: los portales entregan la planta dentro de
// `features` ("Planta 3ª exterior", "3ª Exterior", "Bajo"), del título o de
// la descripción ("tercera planta", "ático"). Este parser normaliza esos
// textos a un número para poder filtrar "a partir de planta X" (hay clientes
// que exigen un mínimo de planta).
//
// Convención numérica: sótano = -1, bajo/entreplanta = 0, resto = nº de
// planta. El ático usa un centinela alto para que siempre cumpla cualquier
// "planta mínima".

export const ATICO_FLOOR = 99;

const ORDINAL_WORDS: Record<string, number> = {
  primera: 1,
  segunda: 2,
  tercera: 3,
  cuarta: 4,
  quinta: 5,
  sexta: 6,
  septima: 7,
  octava: 8,
  novena: 9,
  decima: 10,
  undecima: 11,
  duodecima: 12,
};

const ORDINAL_RE = Object.keys(ORDINAL_WORDS).join("|");

// minúsculas + sin tildes, para comparar con los patrones de arriba.
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// `loose` habilita patrones cortos ("3ª", "Bajo") que solo son fiables
// cuando el texto ES el atributo de planta (items de features), no dentro
// de una descripción larga donde "bajo" o "2ª" significan otra cosa.
function parseFloorText(raw: string, loose: boolean): number | null {
  const s = fold(raw);

  // `planta\b` evita el falso positivo "edificio de 7 plantas".
  const m =
    s.match(/planta\s+(-?\d{1,2})\b/) ??
    s.match(/\b(\d{1,2})\s*[ªº]?\s*planta\b/);
  if (m) return Number(m[1]);

  const word =
    s.match(new RegExp(`planta\\s+(${ORDINAL_RE})\\b`)) ??
    s.match(new RegExp(`\\b(${ORDINAL_RE})\\s+planta`));
  if (word) return ORDINAL_WORDS[word[1]] ?? null;

  if (/\batico\b/.test(s)) return ATICO_FLOOR;
  if (/planta baja|\bentreplanta\b/.test(s)) return 0;
  if (/\b(semisotano|sotano)\b/.test(s)) return -1;

  if (loose) {
    if (/^bajo\b/.test(s)) return 0;
    const lm = s.match(/^(\d{1,2})\s*[ªº]/);
    if (lm) return Number(lm[1]);
  }
  return null;
}

/**
 * Devuelve el número de planta del anuncio, o null si no se puede deducir.
 * Mira primero las features (atributos cortos, parsing permisivo) y después
 * los textos largos (título/descripción, parsing estricto).
 */
export function extractFloor(
  features: string[] | null | undefined,
  ...texts: Array<string | null | undefined>
): number | null {
  for (const f of features ?? []) {
    const n = parseFloorText(f, true);
    if (n != null) return n;
  }
  for (const t of texts) {
    if (!t) continue;
    const n = parseFloorText(t, false);
    if (n != null) return n;
  }
  return null;
}

/** Etiqueta legible de una planta extraída ("3ª", "Bajo", "Ático"…). */
export function floorLabel(n: number): string {
  if (n === ATICO_FLOOR) return "Ático";
  if (n === 0) return "Bajo";
  if (n < 0) return "Sótano";
  return `${n}ª`;
}
