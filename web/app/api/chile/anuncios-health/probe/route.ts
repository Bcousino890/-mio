import { NextResponse } from 'next/server'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/anuncios-health/probe — sonda de red desde la VPS hacia Portal
// Inmobiliario, por las DOS vías: directa y a través del proxy residencial
// Evomi.
//
// Por qué las dos: el worker barre SIEMPRE por proxy (PI_SOLO_PROXY), así que
// una sonda que solo probaba el camino directo no medía lo que el worker hace de
// verdad — podía decir "OK" mientras el barrido llevaba un día parado porque el
// proxy rechazaba las credenciales. Probando las dos, el veredicto separa los
// tres problemas que se veían todos igual (`circuit_open` a secas) y que tienen
// arreglos distintos:
//   · el proxy no responde / rechaza credenciales → arreglar Evomi (Configuración)
//   · el portal bloquea la IP de la VPS (403)      → hace falta el proxy
//   · 200 sin el blob `__NORDIC_RENDERING_CTX__`   → variante ligera: el parser
//     saca 0 aunque el HTTP diga 200 (el fallo mudo que dejaba barridos en 0)
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
    const hasBlob = html.includes('__NORDIC_RENDERING_CTX__')
    const totalMatch = html.match(/"total"\s*:\s*(\d+)/)
    const etiqueta = via === 'directo' ? 'la VPS' : 'Evomi'
    return {
      via,
      ok: hasBlob,
      http_status: res.status,
      html_bytes: html.length,
      elapsed_ms: Date.now() - started,
      has_nordic_blob: hasBlob,
      poly_cards: (html.match(/poly-card/g) || []).length,
      distinct_mlc_ids: new Set(html.match(/MLC\d{10,}/g) || []).size,
      portal_total: totalMatch ? Number(totalMatch[1]) : null,
      veredicto: hasBlob
        ? `OK — ${etiqueta} recibe la variante con blob (se puede scrapear)`
        : res.status !== 200
          ? `BLOQUEO — HTTP ${res.status} por ${etiqueta}`
          : `VARIANTE LIGERA — 200 sin blob por ${etiqueta}: el parser sacaría 0`,
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
  const [directo, evomi] = await Promise.all([
    sondear('directo'),
    proxyUrl
      ? sondear('evomi', proxyUrl)
      : Promise.resolve<Via>({
          via: 'evomi', ok: false, elapsed_ms: 0,
          error: 'sin credenciales',
          veredicto: 'SIN CONFIGURAR — no hay credenciales de Evomi en el .env del VPS',
        }),
  ])

  // El worker barre por proxy, así que el estado del pipeline lo manda `evomi`;
  // `directo` sirve para saber si el problema es del proxy o del portal.
  const veredicto = evomi.ok
    ? (directo.ok
        ? 'Todo en orden: el barrido puede pedir páginas por Evomi (y el directo también responde).'
        : 'El barrido funciona por Evomi. El acceso directo desde la VPS no sirve — por eso hace falta el proxy.')
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
    veredicto,
    // Compatibilidad con la forma anterior de la respuesta (un solo `probe`
    // directo), por si algo externo la estuviera leyendo.
    probe: { url: PI_URL, ...directo, verdict: directo.veredicto },
  })
}
