// ─────────────────────────────────────────────────────────────────────────────
// crm-adapters/ofinet.mjs — adaptador para webs de corredoras sobre Ofinet
// (plan Anuncios CL · Fase 4 / H21). Verificado: bpropiedades.cl, cympropiedades.cl.
//
// Ofinet corre sobre ASP clásico (.asp). Footer "Designed by Ofinet". El listado
// va por querystring con parámetros select-* (ej.
// i_listing-4-column.asp?select-status=VE&select-property-type=-1). La forma de
// los datos de la ficha es la genérica ASP.NET → se delega en parseDetailGeneric.
// ─────────────────────────────────────────────────────────────────────────────
import { parseDetailGeneric, parseListGeneric } from './index.mjs'
import { normalizeDomain } from '../detect-corredora-crm-cl.mjs'

export const platform = 'ofinet'

// Códigos de estado de Ofinet en el querystring select-status.
const STATUS = { sale: 'VE', rent: 'AR' }
// -1 = "todos los tipos" en Ofinet. Los códigos por tipo varían por instalación,
// así que por defecto pedimos todos y filtramos al parsear.
const PROPERTY_TYPE_ALL = '-1'

/**
 * URL del listado de inventario. Ofinet usa i_listing-4-column.asp con
 * parámetros select-*. Best-effort; el crawler valida la respuesta.
 */
export function listUrl(domain, { operation, page } = {}) {
  const d = normalizeDomain(domain)
  const params = new URLSearchParams()
  params.set('select-status', STATUS[operation] || '-1')
  params.set('select-property-type', PROPERTY_TYPE_ALL)
  if (page && page > 1) params.set('page', String(page))
  return `https://www.${d}/i_listing-4-column.asp?${params.toString()}`
}

export function parseList(html, ctx = {}) {
  return parseListGeneric(html, ctx)
}

export function parseDetail(html, ctx = {}) {
  return parseDetailGeneric(html, { ...ctx, platform })
}
