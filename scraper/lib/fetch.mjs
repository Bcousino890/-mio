// ─────────────────────────────────────────────────────────────────────────────
// Fetch de HTML vía curl, con un perfil de User-Agent por portal.
//
// Idealista (perfil 'idealista', y el comportamiento POR DEFECTO si no se pasa
// `profile`): DataDome (el anti-bot de Idealista) tiene en whitelist el bot de
// WhatsApp, porque en España se comparten enlaces de Idealista por WhatsApp de
// forma masiva y bloquear sus previews rompería esa función. Hay que usar curl
// (no fetch/undici): DataDome valida también el TLS fingerprint (JA3) además
// del UA — el de curl + UA WhatsApp pasa de forma consistente.
//
// Portalinmobiliario (perfil 'portalinmobiliario'): no hay evidencia de un
// anti-bot tipo DataDome (ver docs/research-portalinmobiliario-chile.md), así
// que basta un UA de navegador normal — el truco de WhatsApp es específico de
// Idealista y no aporta nada aquí. Pendiente de confirmar con un spike real de
// red contra el dominio en producción (el sandbox de investigación bloqueó el
// fetch directo).
//
// IMPORTANTE: `fetchHtml(url, { useProxy })` sin `profile` debe seguir
// comportándose EXACTAMENTE igual que antes (UA de WhatsApp) — no romper el
// scraping de Idealista que ya funciona en producción.
//
// Si se define PROXY_URL (residencial), se enruta a través de él para repartir
// la carga entre IPs y evitar rate-limit por volumen.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import { withResilience } from './resilient-fetch.mjs'
import { envVivo } from './env-vivo.mjs'

const WHATSAPP_UA = 'WhatsApp/2.23.20.0'
// UA de navegador moderno (Chrome de escritorio reciente). Usado para portales
// sin anti-bot conocido tipo DataDome (ver comentario de cabecera).
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Portalinmobiliario sirve DOS variantes de HTML según los headers de la
// petición: con solo el UA devuelve una variante "ligera" (polycards
// renderizadas en servidor, SIN el blob Nordic ni permalinks navegables — el
// parser saca 0). Con headers de navegador completos (Accept, Accept-Language,
// Upgrade-Insecure-Requests) + seguir redirects, devuelve la variante con el
// blob `__NORDIC_RENDERING_CTX__` que trae precio, corredora, m², permalinks —
// la que parse-portalinmobiliario.mjs entiende. Verificado contra HTML real de
// Las Condes (48 tarjetas + total=3469). Misma técnica que el scraper de
// captaciones en producción (smartbc).
const PI_HEADERS = [
  'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language: es-CL,es;q=0.9',
  'Upgrade-Insecure-Requests: 1',
]

const PROFILES = {
  idealista: { ua: WHATSAPP_UA },
  portalinmobiliario: { ua: CHROME_UA, headers: PI_HEADERS, followRedirects: true },
}
const DEFAULT_PROFILE = 'idealista'

const TIMEOUT_S = 25

export function proxyUrl(profile) {
  // SMARTPROXY_URL: URL completa de API Smartproxy (Extracción API)
  // Ej: https://api.smartproxy.com/v2/proxy?cc=CL&city=Santiago&...
  if (process.env.SMARTPROXY_URL) {
    // Las URLs de Smartproxy API tienen formato de extracción, no proxy directo
    // Se usa para generar IPs dinámicamente, pero en curl se pasa como proxy URL
    return process.env.SMARTPROXY_URL
  }
  if (process.env.PROXY_URL) return process.env.PROXY_URL

  // Evomi (residencial, geo Chile) — proxy ACTIVO del plan Anuncios CL (H10),
  // reemplaza a SmartProxy/Geonode para el barrido de Portal Inmobiliario.
  // Prioridad sobre SMARTPROXY_CL_* (que queda como fallback legacy, ver
  // docs/PLAN-ANUNCIOS-CL.md §4 H10) — mismo criterio que SMARTPROXY_URL/
  // PROXY_URL arriba: si está configurado, gana.
  //
  // Se leen con envVivo (no process.env): la UI de Configuración reescribe el
  // .env en caliente, y este proceso lo tenía congelado desde el arranque del
  // contenedor — guardar credenciales nuevas no cambiaba nada hasta recrear el
  // worker (ver env-vivo.mjs).
  if (profile === 'portalinmobiliario') {
    const user = envVivo('EVOMI_PROXY_USER')
    if (user) {
      return `http://${user}:${envVivo('EVOMI_PROXY_PASS') ?? ''}@${envVivo('EVOMI_PROXY_HOST') ?? ''}:${envVivo('EVOMI_PROXY_PORT') ?? ''}`
    }
  }

  // Cuenta SmartProxy dedicada a Chile (geo-targeting CL/Santiago), separada
  // de la cuenta SMARTPROXY_PROXY_* de España/Idealista para no mezclarlas.
  // Fallback legacy si Evomi no está configurado (ver arriba).
  if (profile === 'portalinmobiliario') {
    const user = envVivo('SMARTPROXY_CL_USER')
    if (user) {
      return `http://${user}:${envVivo('SMARTPROXY_CL_PASS') ?? ''}@${envVivo('SMARTPROXY_CL_HOST') ?? ''}:${envVivo('SMARTPROXY_CL_PORT') ?? ''}`
    }
  }

  const { PROXY_PROVIDER, SMARTPROXY_PROXY_HOST, SMARTPROXY_PROXY_PORT,
          SMARTPROXY_PROXY_USER, SMARTPROXY_PROXY_PASS,
          GEONODE_PROXY_HOST, GEONODE_PROXY_PORT, GEONODE_PROXY_USER, GEONODE_PROXY_PASS } = process.env
  if (PROXY_PROVIDER === 'smartproxy' && SMARTPROXY_PROXY_USER) {
    return `http://${SMARTPROXY_PROXY_USER}:${SMARTPROXY_PROXY_PASS}@${SMARTPROXY_PROXY_HOST}:${SMARTPROXY_PROXY_PORT}`
  }
  if (PROXY_PROVIDER === 'geonode' && GEONODE_PROXY_USER) {
    return `http://${GEONODE_PROXY_USER}:${GEONODE_PROXY_PASS}@${GEONODE_PROXY_HOST}:${GEONODE_PROXY_PORT}`
  }
  return null
}

/**
 * Traduce el fallo de `curl` a un motivo legible y, sobre todo, dice si el que
 * falló fue el PROXY (y no el destino). Sin esta distinción, en el panel de
 * salud todo se veía igual —`circuit_open` a secas— tanto si el portal nos
 * estaba bloqueando como si el proxy tenía las credenciales caducadas, que son
 * dos problemas con dos arreglos completamente distintos.
 *
 * Solo se marca `proxyFailed` cuando es INEQUÍVOCO que el proxy es el problema
 * (no resuelve, no conecta, rechaza el CONNECT o pide autenticación). Un timeout
 * o un reset se dejan como fallo genérico a propósito: pueden ser del destino, y
 * no queremos que un portal lento dispare el camino directo (que expone la IP de
 * la VPS).
 *
 * @returns {{ reason: string, proxyFailed: boolean }}
 */
export function motivoDeCurl(err, stderr, { usandoProxy = false } = {}) {
  const code = Number(err?.code ?? 0)
  const texto = String(stderr || err?.message || '').trim()
  const t = texto.toLowerCase()

  if (usandoProxy) {
    if (t.includes('407') || t.includes('proxy authentication')) {
      return { reason: 'el proxy rechazó las credenciales (407)', proxyFailed: true }
    }
    if (code === 5 || t.includes("couldn't resolve proxy") || t.includes('could not resolve proxy')) {
      return { reason: 'no se resuelve el host del proxy', proxyFailed: true }
    }
    if (code === 97 || t.includes('proxy connect') || t.includes('connect tunnel failed')) {
      return { reason: 'el proxy rechazó la conexión (CONNECT)', proxyFailed: true }
    }
    if (code === 7) {
      return { reason: 'no se pudo conectar con el proxy', proxyFailed: true }
    }
  }
  if (code === 28) return { reason: `timeout tras ${TIMEOUT_S}s`, proxyFailed: false }
  return { reason: texto || `curl salió con código ${code}`, proxyFailed: false }
}

/**
 * Descarga el HTML de una URL. Devuelve { ok, html } o
 * { ok: false, status, reason }.
 *
 * `profile` selecciona el User-Agent (y futuros ajustes específicos de
 * portal) vía el mapa PROFILES. Por defecto usa 'idealista' (UA de WhatsApp),
 * idéntico al comportamiento histórico de esta función.
 */
export function fetchHtml(url, { useProxy = true, profile = DEFAULT_PROFILE } = {}) {
  const { ua, headers = [], followRedirects = false } = PROFILES[profile] ?? PROFILES[DEFAULT_PROFILE]
  return new Promise((resolve) => {
    const args = [
      '-sS', '--compressed',
      '-m', String(TIMEOUT_S),
      '-A', ua,
      '-w', '\n__HTTP_STATUS__:%{http_code}',
    ]
    // Seguir redirects (-L) y headers extra del perfil. Portalinmobiliario los
    // necesita para servir la variante con el blob Nordic (ver PI_HEADERS);
    // Idealista no define ninguno → se comporta EXACTAMENTE igual que antes.
    if (followRedirects) args.push('-L')
    for (const h of headers) args.push('-H', h)
    const px = useProxy ? proxyUrl(profile) : null
    if (px) args.push('-x', px)
    args.push(url)

    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        const { reason, proxyFailed } = motivoDeCurl(err, stderr, { usandoProxy: Boolean(px) })
        return resolve({ ok: false, status: 0, reason, proxy_failed: proxyFailed })
      }
      const m = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/)
      const status = m ? Number(m[1]) : 0
      const html = m ? stdout.slice(0, m.index) : stdout
      if (status !== 200) {
        return resolve({ ok: false, status, reason: `HTTP ${status}` })
      }
      if (!html || html.length < 500) {
        return resolve({ ok: false, status, reason: 'HTML vacío/corto' })
      }
      resolve({ ok: true, html })
    })
  })
}

export const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch de Portal Inmobiliario con estrategia DIRECTO-primero, proxy-fallback.
 * Verificado en Fase 0: el fetch directo trae la variante con el blob Nordic sin
 * bloqueos (PI no tiene anti-bot agresivo tipo DataDome). Enrutar todo por el
 * residencial Evomi es más frágil (IP residencial puede recibir otra variante o
 * bloqueo) y era la causa de que el barrido no ingresara datos. Se prueba directo
 * y SOLO si falla (bloqueo/429/HTML corto) se reintenta por Evomi — reservando el
 * proxy para cuando de verdad hace falta (criterio del plan H10). Es UN intento
 * lógico para el circuit-breaker de withResilience (que envuelve esta función).
 */
// Siempre por proxy (decisión del usuario, 2026-07-31): la IP del VPS no debe
// quedar expuesta al portal. Antes se probaba DIRECTO primero y solo se caía a
// Evomi al fallar — más barato en GB, pero cada petición directa enseñaba la IP
// del servidor, y el portal ya nos devolvió un 403 una vez. Con el plan de 100
// GB/mes el tráfico cabe de sobra, así que se prefiere no volver a arriesgar el
// bloqueo. `PI_SOLO_PROXY=0` permite volver al comportamiento anterior sin
// tocar código, por si hiciera falta diagnosticar.
const PI_SOLO_PROXY = process.env.PI_SOLO_PROXY !== '0'

// Red de seguridad para cuando el que se cae es el PROXY, no el portal. Sin
// ella, un problema del proveedor (credenciales caducadas, cuota agotada, host
// inalcanzable) deja el barrido 24/7 completamente parado hasta que alguien lo
// note a mano — que es exactamente lo que pasó: un día entero sin ingresar un
// solo anuncio. Ojo con el matiz: NO se cae a directo si el portal nos responde
// mal (403, 429, variante ligera). Ahí la decisión de no enseñar la IP de la VPS
// sigue intacta; el directo solo entra cuando el proxy ni siquiera llega a
// hablar con el portal. `PI_FALLBACK_DIRECTO=0` lo desactiva.
const PI_FALLBACK_DIRECTO = process.env.PI_FALLBACK_DIRECTO !== '0'

async function fetchHtmlPi(url, { profile = 'portalinmobiliario' } = {}) {
  // "Éxito" para PI NO es solo HTTP 200: la variante LIGERA que PI sirve a
  // algunas IPs (p. ej. datacenter) responde 200 pero SIN el blob Nordic, y el
  // parser saca 0. Solo cuenta como bueno si trae el blob. Así, si el directo
  // (IP de la VPS) recibe la variante ligera, se cae a Evomi (residencial CL),
  // que suele recibir la buena — en vez de aceptar un 200 inútil.
  const hasBlob = (r) => r.ok && typeof r.html === 'string' && r.html.includes('__NORDIC_RENDERING_CTX__')
  // Un 200 sin blob es una página INSERVIBLE (el parser saca 0). Antes se
  // devolvía como `ok: true` "para no disparar el circuit-breaker", y el efecto
  // era el contrario del buscado: el barrido se anotaba como COMPLETO con 0
  // anuncios, marcaba last_success_at y se iba tan tranquilo — un fallo mudo.
  // Devolviéndolo como fallo reintentable, withResilience vuelve a pedir la
  // página y, con un residencial que rota IP, el siguiente intento suele salir
  // por otra IP y traer la buena.
  const ligera = (r) => ({ ok: false, status: r.status ?? 200, reason: 'sin blob Nordic (variante ligera o bloqueo)' })

  if (PI_SOLO_PROXY) {
    const soloProxy = await fetchHtml(url, { useProxy: true, profile })
    if (hasBlob(soloProxy)) return soloProxy

    if (soloProxy.proxy_failed && PI_FALLBACK_DIRECTO) {
      const rescate = await fetchHtml(url, { useProxy: false, profile })
      const marca = { via: 'directo', proxy_caido: soloProxy.reason }
      if (hasBlob(rescate)) {
        console.warn(`[fetch] proxy caído (${soloProxy.reason}) → servido DIRECTO desde la VPS`)
        return { ...rescate, ...marca }
      }
      // El portal SÍ contestó por la vía directa (un 404 de fin de paginación,
      // un 403…): esa respuesta es la real y hay que conservarla — devolver en
      // su lugar el fallo del proxy convertiría un final de paginación normal en
      // un "fallo de red" y rompería la detección de bajas.
      if (Number(rescate.status) > 0) return rescate.ok ? { ...ligera(rescate), ...marca } : { ...rescate, ...marca }
      // Ni con el rescate: se informa del fallo del PROXY, que es el arreglable.
      return { ...soloProxy, reason: `proxy: ${soloProxy.reason}` }
    }

    return soloProxy.ok ? ligera(soloProxy) : soloProxy
  }

  const direct = await fetchHtml(url, { useProxy: false, profile })
  if (hasBlob(direct)) return direct

  const proxied = await fetchHtml(url, { useProxy: true, profile })
  if (hasBlob(proxied)) return proxied

  // Ninguna vía trajo el blob: la página es inservible por las dos. Se devuelve
  // como fallo (ver `ligera`) para que se reintente y, si persiste, se vea en el
  // panel — en vez de colarse como un barrido "completo" de 0 anuncios.
  if (proxied.ok) return ligera(proxied)
  if (direct.ok) return ligera(direct)
  return direct
}

/**
 * fetchHtml + reintentos con backoff exponencial + circuit-breaker por
 * dominio (plan Anuncios CL · H16, ver resilient-fetch.mjs). Aditivo: no
 * cambia el comportamiento de `fetchHtml` — pensado para el discovery
 * crawler/worker 24/7 de Chile (H1/H2), que corren sin supervisión y no
 * pueden quedarse reintentando a ciegas un dominio caído.
 *
 * @param {string} url
 * @param {{ useProxy?: boolean, profile?: string, retries?: number, baseBackoffMs?: number, failureThreshold?: number, cooldownMs?: number }} [options]
 */
export function fetchHtmlResilient(url, options = {}) {
  const { useProxy, profile, ...resilienceOptions } = options
  // Portal Inmobiliario, sin useProxy explícito: directo-primero con fallback a
  // Evomi (fetchHtmlPi). Es lo que hace que el barrido ingrese datos de forma
  // fiable en vez de depender de que el residencial devuelva la variante buena.
  if (profile === 'portalinmobiliario' && useProxy === undefined) {
    return withResilience(fetchHtmlPi, url, { ...resilienceOptions, fetchOpts: { profile } })
  }
  return withResilience(fetchHtml, url, { ...resilienceOptions, fetchOpts: { useProxy, profile } })
}
