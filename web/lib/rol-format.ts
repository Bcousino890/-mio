/**
 * Normaliza un Rol de Avalúo ya compuesto "manzana-predio" al mismo formato
 * que usa sii_roles_cl.rol (sin ceros a la izquierda, ej. "02452-00014" →
 * "2452-14"). Necesario porque el rol que llega de cadastre_parcels_cl (clic
 * en el mapa), de un deep-link compartido, o de la caja de búsqueda puede
 * traer el padding de ceros del origen y romper el match exacto contra
 * sii_roles_cl. Si el string no matchea "manzana-predio" numérico, se
 * devuelve tal cual (p. ej. rol_padre con formato "comuna-manzana-predio").
 *
 * Módulo sin dependencias de Node (fs/pg) a propósito: se importa tanto desde
 * componentes cliente (page.tsx) como desde API routes.
 */
export function normalizeClRol(raw: string): string {
  const trimmed = raw.trim()
  const parts = trimmed.split('-')
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return trimmed
  return `${parseInt(parts[0], 10)}-${parseInt(parts[1], 10)}`
}
