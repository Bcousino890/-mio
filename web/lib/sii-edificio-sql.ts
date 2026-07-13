// Agrupación de unidades de edificio/condominio por dirección base.
//
// Los archivos SII oficiales subidos a mano traen rol_padre/rol_bien_comun
// para vincular departamentos con su edificio, pero el dataset nacional
// (catastral.cl, raw_source='catastral_cl.csv' / 'BRTMPCATASN_*') trae esos
// campos en NULL en todo Chile. La única señal disponible a nivel nacional
// es la propia dirección: las unidades comparten la dirección base y llevan
// un sufijo de unidad después de la numeración ("PEUMO 1190 DP 502",
// "PEUMO 1190 BD 227", "DEL CANDIL 690 DP 2 A", "VITACURA 2909 OF 401").
//
// El corte exige número de calle ANTES del token, lo que evita falsos
// positivos con calles que contienen el token como nombre ("AV LA TORRE 45")
// y con abreviaturas parciales ("ESTADIO 120", "LOS MILITARES 5150 ESTUDIO 2"
// no matchean EST porque el token requiere borde de palabra). LT/PC/SITIO/HIJ
// se excluyen a propósito: son subdivisiones de terreno, no unidades de un
// conjunto. Casos validados en un Postgres 16 local antes de commitear.
const UNIT_SUFFIX_TOKENS =
  'DP|DPTO|DEPTO|DEP|BD|BOD|BDGA|BODEGA|BX|EST|ESTAC|LC|LOC|LOCAL|OF|OFIC|OFICINA|CS|CASA|PISO|BLOCK|BLK|TORRE'

/** Regex POSIX (para `~`): la dirección es una unidad de edificio/condominio. */
export const UNIT_ADDR_MATCH = `^.*?[0-9]+[[:space:]]+(${UNIT_SUFFIX_TOKENS})([[:space:]]|$)`

/** Expresión SQL: dirección base del conjunto (todo lo anterior al sufijo de unidad). */
export function unitBaseAddressExpr(col: string): string {
  return `regexp_replace(${col}, '^(.*?[0-9]+)[[:space:]]+(${UNIT_SUFFIX_TOKENS})([[:space:]]|$).*$', '\\1')`
}
