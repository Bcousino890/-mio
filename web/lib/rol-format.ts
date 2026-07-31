/**
 * Fachada tipada de `rol-format.mjs` — ahí está la implementación y la
 * explicación de por qué hay dos formatos de Rol de Avalúo (canónico interno
 * para comparar, oficial para mostrar y enviar fuera).
 *
 * La implementación vive en .mjs porque también la cargan los módulos de
 * SmartBC, que son .mjs para que el CLI del scraper pueda importarlos desde el
 * checkout (mismo motivo que web/lib/smartbc/). Una sola definición: si el
 * formato cambia, cambia en un solo sitio.
 */
import { normalizeClRol as normalizeImpl, formatRolCl as formatImpl } from './rol-format.mjs'

/**
 * Formato CANÓNICO INTERNO, sin ceros a la izquierda ("02452-00014" →
 * "2452-14"): el de `sii_roles_cl.rol` y el que usa toda la base desde la
 * migración 0093. Es el que sirve para COMPARAR (ficha ↔ captación, dirección
 * exacta del catastro, caché de certificados TGR).
 *
 * Lo que no sea "manzana-predio" numérico se devuelve tal cual.
 */
export const normalizeClRol: (raw: string) => string = normalizeImpl

/**
 * Formato OFICIAL, manzana y predio a cinco dígitos ("3810-21" →
 * "03810-00021"): como lo imprime el SII y como sale en el certificado de la
 * Tesorería. Es el que va a la vista y el que se manda fuera (CRM SmartBC).
 *
 * null si no hay rol; intacto si no es "manzana-predio" numérico.
 */
export const formatRolCl: (raw: string | null | undefined) => string | null = formatImpl
