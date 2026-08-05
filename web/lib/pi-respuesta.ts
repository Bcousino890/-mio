/**
 * Fachada tipada de `pi-respuesta.mjs` — ahí está la implementación y la
 * explicación de por qué "HTTP 200 con blob Nordic" NO significa que la página
 * sirva (la pantalla antibot de Mercado Libre también lo trae).
 *
 * Se mantiene la implementación en .mjs porque el worker del scraper la importa
 * tal cual desde `scraper/lib/fetch.mjs`: una sola definición para los dos
 * runtimes, igual que rol-format.mjs.
 */
import {
  clasificarHtmlPi as clasificarImpl,
  veredictoPi as veredictoImpl,
  PI_UTIL as PI_UTIL_IMPL,
  PI_ANTIBOT as PI_ANTIBOT_IMPL,
  PI_LIGERA as PI_LIGERA_IMPL,
  PI_DESCONOCIDA as PI_DESCONOCIDA_IMPL,
  PI_VACIA as PI_VACIA_IMPL,
} from './pi-respuesta.mjs'

export type TipoRespuestaPi = 'util' | 'antibot' | 'ligera' | 'desconocida' | 'vacia'

export type RespuestaPi = {
  /** ¿Se puede scrapear? Solo `util` lo es. */
  usable: boolean
  tipo: TipoRespuestaPi
  /** Por qué no sirve, en lenguaje de panel. `null` cuando sí sirve. */
  motivo: string | null
}

export const PI_UTIL = PI_UTIL_IMPL as TipoRespuestaPi
export const PI_ANTIBOT = PI_ANTIBOT_IMPL as TipoRespuestaPi
export const PI_LIGERA = PI_LIGERA_IMPL as TipoRespuestaPi
export const PI_DESCONOCIDA = PI_DESCONOCIDA_IMPL as TipoRespuestaPi
export const PI_VACIA = PI_VACIA_IMPL as TipoRespuestaPi

export function clasificarHtmlPi(html: string | null | undefined): RespuestaPi {
  return clasificarImpl(html) as RespuestaPi
}

export function veredictoPi(tipo: TipoRespuestaPi, etiquetaVia: string): string {
  return veredictoImpl(tipo, etiquetaVia) as string
}
