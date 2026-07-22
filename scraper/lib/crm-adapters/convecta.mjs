// ─────────────────────────────────────────────────────────────────────────────
// crm-adapters/convecta.mjs — adaptador para webs de corredoras sobre Convecta
// (plan Anuncios CL · Fase 4 / H21). Verificado: magnoliaproperty.cl.
//
// Convecta corre sobre ASP.NET (.aspx). El listado va por SEGMENTOS de carpeta
// (/Todos_los_tipos/Venta_y_Arriendo/Todas_las_comunas), no querystring. El HTML
// estático del listado NO trae enlaces a fichas (se cargan por JS/AJAX) → por
// eso parseList puede quedar vacío; el enlace determinista (Nivel 1.5) opera
// sobre la ficha individual, que sí es HTML estático. La forma de los datos de
// la ficha es la genérica ASP.NET → se delega en parseDetailGeneric.
// ─────────────────────────────────────────────────────────────────────────────
import { parseDetailGeneric, parseListGeneric } from './index.mjs'
import { normalizeDomain } from '../detect-corredora-crm-cl.mjs'

export const platform = 'convecta'

const TYPE_SEGMENT = { casa: 'Casas', departamento: 'Departamentos', oficina: 'Oficinas', terreno: 'Terrenos' }
const OP_SEGMENT = { sale: 'Venta', rent: 'Arriendo' }

/**
 * URL del listado de inventario. Convecta segmenta por carpetas; sin comuna se
 * usa "Todas_las_comunas". Best-effort: cada instalación puede tener variantes,
 * el crawler valida la respuesta.
 */
export function listUrl(domain, { operation, propertyType, comuna } = {}) {
  const d = normalizeDomain(domain)
  const tipo = TYPE_SEGMENT[propertyType] || 'Todos_los_tipos'
  const op = OP_SEGMENT[operation] || 'Venta_y_Arriendo'
  const cm = comuna ? comuna.replace(/\s+/g, '_') : 'Todas_las_comunas'
  return `https://www.${d}/${tipo}/${op}/${cm}`
}

export function parseList(html, ctx = {}) {
  return parseListGeneric(html, ctx)
}

export function parseDetail(html, ctx = {}) {
  return parseDetailGeneric(html, { ...ctx, platform })
}
