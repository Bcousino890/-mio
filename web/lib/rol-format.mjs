/**
 * Los DOS formatos del Rol de Avalúo chileno, y cuándo va cada uno.
 *
 * El mismo rol se escribe de dos maneras y las dos son legítimas:
 *
 *   · CANÓNICO INTERNO — "3810-21", sin ceros a la izquierda. Es el formato de
 *     `sii_roles_cl.rol` y el que usa toda la base desde la migración 0093:
 *     con él se cruzan la ficha y su captación, se busca la dirección exacta
 *     del catastro y se acierta la caché de certificados de TGR. Sirve para
 *     COMPARAR, y por eso tiene que haber uno solo.
 *
 *   · OFICIAL — "03810-00021", manzana y predio a cinco dígitos. Es como lo
 *     imprime el SII, como sale en el certificado de la Tesorería y como lo
 *     teclea alguien que lo está buscando. Sirve para MOSTRAR y para MANDARLO
 *     fuera (la ficha del CRM SmartBC, un informe).
 *
 * Normalizar la base fue lo correcto para lo primero, pero no convierte al
 * formato interno en el que sale al mundo: a un CRM donde alguien va a buscar
 * el rol se le manda el oficial.
 *
 * Módulo .mjs sin dependencias a propósito: lo importan componentes cliente
 * (vía rol-format.ts), rutas de API y los módulos de SmartBC, que son .mjs
 * porque el CLI del scraper también los carga.
 */

/** Los dos tramos numéricos de un "manzana-predio", o null si no lo es. */
function partirRol(raw) {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  const parts = trimmed.split('-')
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null
  return parts
}

/**
 * Formato CANÓNICO INTERNO: "02452-00014" → "2452-14".
 *
 * Si el string no matchea "manzana-predio" numérico se devuelve tal cual (p. ej.
 * un `rol_padre` "comuna-manzana-predio"). Espejo exacto de la función SQL
 * `normalizar_rol_cl()` de la migración 0093 — si una cambia, cambia la otra.
 */
export function normalizeClRol(raw) {
  const parts = partirRol(raw)
  if (!parts) return String(raw ?? '').trim()
  return `${parseInt(parts[0], 10)}-${parseInt(parts[1], 10)}`
}

/** Ancho de cada tramo en el rol impreso por el SII. */
const ANCHO_TRAMO = 5

/**
 * Formato OFICIAL para mostrar o enviar fuera: "3810-21" → "03810-00021".
 *
 * Devuelve null si no hay rol, y el valor intacto si no es "manzana-predio"
 * numérico: mejor mandar lo que hay que inventarse un formato.
 */
export function formatRolCl(raw) {
  if (raw == null || String(raw).trim() === '') return null
  const parts = partirRol(raw)
  if (!parts) return String(raw).trim()
  const [manzana, predio] = parts
  // Un tramo más largo de la cuenta se manda entero: recortarlo sería cambiar
  // de rol.
  return `${manzana.padStart(ANCHO_TRAMO, '0')}-${predio.padStart(ANCHO_TRAMO, '0')}`
}
