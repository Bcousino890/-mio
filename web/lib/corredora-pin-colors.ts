// ─────────────────────────────────────────────────────────────────────────────
// Colores de los pines de corredora del mapa de la ficha chilena.
//
// Vive en lib/ (y no dentro de PropertyLocationMap) porque lo usan los dos
// lados a la vez: el mapa para pintar los pines y la leyenda de la ficha para
// nombrarlos. La ficha carga el mapa con dynamic({ ssr: false }), así que
// importar la paleta desde el componente del mapa arrastraría Leaflet y su CSS
// al bundle de la ficha solo por leer una lista de colores.
//
// Ni verde (reservado al PIN REAL corregido a mano) ni naranja (reservado a las
// parcelas del catastro SII): el mapa se lee por color y repetirlos lo rompería.
// ─────────────────────────────────────────────────────────────────────────────

export const CORREDORA_COLORS = [
  '#3b82f6', // azul
  '#a855f7', // violeta
  '#ec4899', // rosa
  '#06b6d4', // cian
  '#6366f1', // índigo
  '#f43f5e', // rojo
  '#14b8a6', // teal
  '#8b5cf6', // púrpura
]

/** Color del pin n-ésimo. Cicla si el grupo tiene más corredoras que colores. */
export function corredoraColor(index: number): string {
  return CORREDORA_COLORS[index % CORREDORA_COLORS.length]
}
