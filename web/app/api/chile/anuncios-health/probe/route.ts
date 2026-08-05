import { NextResponse } from 'next/server'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { clasificarHtmlPi, veredictoPi, PI_ANTIBOT, type TipoRespuestaPi } from '@/lib/pi-respuesta'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/anuncios-health/probe — sonda de red desde la VPS hacia Portal
// Inmobiliario, por las DOS vías: directa y a través del proxy residencial
// Evomi.
//
// Por qué las dos: el worker barre SIEMPRE por proxy (PI_SOLO_PROXY), así que
// una sonda que solo probaba el camino directo no medía lo que el worker hace de
// verdad — podía decir "OK" mientras el barrido llevaba un día parado porque el
// proxy rechazaba las credenciales. Probando las dos, el veredicto separa los
// problemas que se veían todos igual (`circuit_open` a secas) y que tienen
// arreglos distintos:
//   · el proxy no responde / rechaza credenciales → arreglar Evomi (Configuración)
//   · el portal bloquea la IP de la VPS (403)      → hace falta el proxy
//   · pantalla antibot de Mercado Libre con 200    → la IP está señalada: hay que
//     rotar la salida del residencial (no es ni el proxy ni el parser)
//   · 200 sin el blob `__NORDIC_RENDERING_CTX__`   → variante ligera: el parser
//     saca 0 aunque el HTTP diga 200 (el fallo mudo que dejaba barridos en 0)
//
// El veredicto lo decide clasificarHtmlPi, el MISMO criterio que usa el worker
// para dar una página por buena (web/lib/pi-respuesta.mjs). Antes esta sonda
// tenía su propia regla —"¿contiene __NORDIC_RENDERING_CTX__?"— y por eso mentía
// exactamente cuando más falta hacía: la pantalla antibot también trae ese
// marcador, así que el panel decía "OK — Evomi recibe la variante con blob (se
// puede scrapear)" mientras el barrido llevaba horas sin leer una sola página.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const PI_URL = 'https://www.portalinmobiliario.com/venta/casa/propiedades-usadas/las-condes-metropolitana'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-CL,es;q=0.9',
  'Upgrade-Insecure-Requests': '1',
}
const TIMEOUT_MS = 25000

type Via = {
  via: 'directo' | 'evomi'
  ok: boolean
  http_status?: number
  html_bytes?: number
  elapsed_ms: number
  has_nordic_blob?: boolean
  /** Qué llegó de verdad: página útil, pantalla antibot, variante ligera… */
  tipo_respuesta?: TipoRespuestaPi
  bloqueo_antibot?: boolean
  poly_cards?: number
  distinct_mlc_ids?: number
  portal_total?: number | null
  error?: string
  veredicto: string
}

function evomiProxyUrl(): string | null {
  const { EVOMI_PROXY_HOST, EVOMI_PROXY_PORT, EVOMI_PROXY_USER, EVOMI_PROXY_PASS } = process.env
  if (!EVOMI_PROXY_USER || !EVOMI_PROXY_HOST || !EVOMI_PROXY_PORT) return null
  return `http://${EVOMI_PROXY_USER}:${EVOMI_PROXY_PASS}@${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`
}

/**
 * Traduce el error de red a algo accionable. Lo que llega de undici es del estilo
 * "fetch failed" con la causa anidada, que en el panel no dice nada.
 */
function motivoDeError(e: unknown): string {
  const raw = e instanceof Error ? `${e.message} ${(e as { cause?: { message?: string; code?: string } }).cause?.message ?? ''} ${(e as { cause?: { code?: string } }).cause?.code ?? ''}` : String(e)
  const t = raw.toLowerCase()
  if (t.includes('407') || t.includes('proxy authentication')) return 'el proxy rechazó las credenciales (407)'
  if (t.includes('enotfound') || t.includes('eai_again')) return 'no se resuelve el host del proxy'
  if (t.includes('econnrefused')) return 'el proxy rechazó la conexión'
  if (t.includes('timeout') || t.includes('abort')) return `sin respuesta en ${TIMEOUT_MS / 1000}s`
  if (t.includes('econnreset')) return 'la conexión se cortó'
  return raw.trim() || 'error de red'
}

// ─── ¿Está rotando de IP el residencial? ─────────────────────────────────────
//
// La pregunta que decide qué hacer cuando el portal bloquea. El barrido se
// destraba reintentando PORQUE cada intento debería salir por otra IP; si el
// endpoint del proxy no rota (usuario/puerto de sesión pegajosa), reintentar es
// pedir lo mismo desde la misma IP y no sirve de nada. Los dos casos se ven
// idénticos desde fuera —"bloqueado"— y tienen arreglos opuestos: uno se
// resuelve cambiando una credencial (gratis), el otro cambiando de pool o de geo.
//
// Se piden varias salidas seguidas y se mira si son distintas. Es barato (una
// respuesta de ~15 bytes) y solo corre al pulsar "Diagnosticar red", nunca en el
// refresco automático del panel.
const IP_ECHO_URL = 'https://api.ipify.org'
const MUESTRAS_IP = 3

async function ipDeSalida(proxyUrl?: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await undiciFetch(IP_ECHO_URL, {
      signal: controller.signal,
      ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {}),
    })
    if (!res.ok) return null
    const ip = (await res.text()).trim()
    return /^[0-9a-f.:]{7,45}$/i.test(ip) ? ip : null
  } catch {
    // El eco de IP es un extra del diagnóstico: si falla, el resto del
    // diagnóstico sigue siendo válido y no se pierde.
    return null
  } finally {
    clearTimeout(timer)
  }
}

type Rotacion = { ips: string[]; distintas: number; rota: boolean | null; veredicto: string }

async function medirRotacion(proxyUrl?: string): Promise<Rotacion> {
  const ips: string[] = []
  for (let i = 0; i < MUESTRAS_IP; i++) {
    const ip = await ipDeSalida(proxyUrl)
    if (ip) ips.push(ip)
  }
  const distintas = new Set(ips).size
  if (ips.length < 2) {
    return { ips, distintas, rota: null, veredicto: 'no se pudo medir la rotación de IP (el eco no respondió)' }
  }
  if (distintas === 1) {
    return {
      ips, distintas, rota: false,
      veredicto: `NO ROTA — las ${ips.length} peticiones salieron por la MISMA IP (${ips[0]}). Reintentar no cambia de salida, así que un bloqueo por IP no se destraba solo: hay que quitar la sesión pegajosa del usuario/puerto de Evomi.`,
    }
  }
  return {
    ips, distintas, rota: true,
    veredicto: `rota IP (${distintas} salidas distintas en ${ips.length} peticiones), así que cada reintento del barrido sale por otra IP`,
  }
}

async function sondear(via: 'directo' | 'evomi', proxyUrl?: string): Promise<Via> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await undiciFetch(PI_URL, {
      headers: HEADERS,
      redirect: 'follow',
      signal: controller.signal,
      ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {}),
    })
    const html = await res.text()
    const { usable, tipo } = clasificarHtmlPi(html)
    const totalMatch = html.match(/"total"\s*:\s*(\d+)/)
    const etiqueta = via === 'directo' ? 'la VPS' : 'Evomi'
    return {
      via,
      ok: usable,
      http_status: res.status,
      html_bytes: html.length,
      elapsed_ms: Date.now() - started,
      has_nordic_blob: html.includes('__NORDIC_RENDERING_CTX__'),
      tipo_respuesta: tipo,
      bloqueo_antibot: tipo === PI_ANTIBOT,
      poly_cards: (html.match(/poly-card/g) || []).length,
      distinct_mlc_ids: new Set(html.match(/MLC\d{10,}/g) || []).size,
      portal_total: totalMatch ? Number(totalMatch[1]) : null,
      // Un HTTP distinto de 200 se cuenta antes que el contenido: ahí el código
      // ES el diagnóstico (403 = la IP vetada, 429 = demasiadas peticiones).
      veredicto: !usable && res.status !== 200
        ? `BLOQUEO — HTTP ${res.status} por ${etiqueta}`
        : veredictoPi(tipo, etiqueta),
    }
  } catch (e) {
    const motivo = motivoDeError(e)
    return {
      via, ok: false, elapsed_ms: Date.now() - started, error: motivo,
      veredicto: via === 'evomi' ? `PROXY CAÍDO — ${motivo}` : `ERROR de red desde la VPS — ${motivo}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function GET() {
  const proxyUrl = evomiProxyUrl()
  const [directo, evomi, rotacion, ipVps] = await Promise.all([
    sondear('directo'),
    proxyUrl
      ? sondear('evomi', proxyUrl)
      : Promise.resolve<Via>({
          via: 'evomi', ok: false, elapsed_ms: 0,
          error: 'sin credenciales',
          veredicto: 'SIN CONFIGURAR — no hay credenciales de Evomi en el .env del VPS',
        }),
    proxyUrl
      ? medirRotacion(proxyUrl)
      : Promise.resolve<Rotacion>({ ips: [], distintas: 0, rota: null, veredicto: 'sin proxy configurado' }),
    ipDeSalida(),
  ])

  // El worker barre por proxy, así que el estado del pipeline lo manda `evomi`;
  // `directo` sirve para saber si el problema es del proxy o del portal.
  //
  // El bloqueo antibot va en su propia rama y NO se mezcla con "el proxy no
  // sirve": son diagnósticos opuestos. Si Evomi conecta y el portal contesta con
  // la pantalla de verificación, el proxy está perfecto —credenciales, cuota y
  // host incluidos— y mandar al usuario a revisarlos es hacerle perder el rato.
  // Lo que falla es la REPUTACIÓN de la IP de salida.
  const veredicto = evomi.ok
    ? (directo.ok
        ? 'Todo en orden: el barrido puede pedir páginas por Evomi (y el directo también responde).'
        : 'El barrido funciona por Evomi. El acceso directo desde la VPS no sirve — por eso hace falta el proxy.')
    : evomi.bloqueo_antibot
      ? `Mercado Libre le está sirviendo a la IP que sale por Evomi su pantalla de verificación de "tráfico sospechoso": responde HTTP 200 pero sin un solo anuncio. NO es el proxy ni las credenciales — es la reputación de esa IP de salida${directo.bloqueo_antibot ? ', y la IP de la VPS recibe el mismo bloqueo' : ''}. ${
          // Con el bloqueo confirmado, lo que decide el siguiente paso es si el
          // proxy rota o no: reintentar solo destraba si cada intento sale por
          // otra IP. Sin este dato, "cambia de pool" era un consejo a ciegas que
          // podía costar dinero para arreglar algo que era una credencial.
          rotacion.rota === false
            ? `Y hay algo más importante: el proxy NO está rotando — las ${rotacion.ips.length} peticiones de prueba salieron todas por ${rotacion.ips[0]}. Así, los reintentos del barrido repiten la misma IP señalada y no se destraban nunca. Antes de cambiar de plan, quita la sesión pegajosa del usuario/puerto de Evomi en Configuración → Proxy (Evomi CL).`
            : rotacion.rota === true
              ? `El proxy sí rota (${rotacion.distintas} salidas distintas en ${rotacion.ips.length} pruebas), así que cada reintento sale por otra IP. Si aun así el bloqueo persiste en todas, el pool está quemado: toca cambiar de pool o de geo en Configuración → Proxy (Evomi CL).`
              : `No se pudo medir si el proxy rota de IP. El barrido reintenta solo; si el bloqueo persiste, hay que cambiar de pool o de geo en Configuración → Proxy (Evomi CL).`
        }`
      : directo.ok
        ? `El proxy Evomi NO sirve ahora mismo (${evomi.error ?? evomi.veredicto}), pero el portal SÍ responde directo desde la VPS. Revisa las credenciales/cuota en Configuración → Proxy (Evomi CL); mientras tanto el barrido usa el rescate directo.`
        : `Ni por Evomi ni directo se consigue una página útil. Evomi: ${evomi.error ?? evomi.veredicto}. Directo: ${directo.error ?? directo.veredicto}.`

  return NextResponse.json({
    success: true,
    url: PI_URL,
    proxy_configurado: Boolean(proxyUrl),
    // Nunca la contraseña: solo lo justo para reconocer qué cuenta está en uso.
    proxy_host: proxyUrl ? `${process.env.EVOMI_PROXY_HOST}:${process.env.EVOMI_PROXY_PORT}` : null,
    proxy_user: process.env.EVOMI_PROXY_USER ?? null,
    vias: [directo, evomi],
    // Por dónde sale cada vía de verdad, y si el residencial rota. Es lo que
    // distingue "el pool está quemado" (cambiar de plan) de "el proxy no rota"
    // (cambiar una credencial) cuando el portal bloquea.
    salida: {
      ip_vps: ipVps,
      ips_evomi: rotacion.ips,
      ips_distintas: rotacion.distintas,
      muestras: rotacion.ips.length,
      rota: rotacion.rota,
      veredicto: rotacion.veredicto,
    },
    veredicto,
    // Compatibilidad con la forma anterior de la respuesta (un solo `probe`
    // directo), por si algo externo la estuviera leyendo.
    probe: { url: PI_URL, ...directo, verdict: directo.veredicto },
  })
}
