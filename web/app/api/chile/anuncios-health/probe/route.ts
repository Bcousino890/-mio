import { NextResponse } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/anuncios-health/probe — sonda de red desde la VPS hacia Portal
// Inmobiliario. La app corre EN la VPS, así que este fetch usa la misma IP de
// egreso que el worker: dice exactamente qué variante de HTML ve la VPS.
//
// Portal Inmobiliario sirve dos variantes: la "buena" trae el blob
// `__NORDIC_RENDERING_CTX__` (precio/corredora/permalinks, la que el parser
// entiende); la "ligera" (o un bloqueo) no lo trae → el barrido saca 0. Esta
// sonda revela cuál recibe la VPS directo, para decidir si hace falta el proxy.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const PI_URL = 'https://www.portalinmobiliario.com/venta/casa/propiedades-usadas/las-condes-metropolitana'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-CL,es;q=0.9',
  'Upgrade-Insecure-Requests': '1',
}

export async function GET() {
  const started = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    let res: Response
    try {
      res = await fetch(PI_URL, { headers: HEADERS, redirect: 'follow', signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    const html = await res.text()
    const hasBlob = html.includes('__NORDIC_RENDERING_CTX__')
    const hasInitialState = html.includes('appProps') && html.includes('initialState')
    const polyCards = (html.match(/poly-card/g) || []).length
    const mlcIds = new Set(html.match(/MLC\d{10,}/g) || []).size
    // total declarado por el portal (solo aparece en la variante con blob)
    const totalMatch = html.match(/"total"\s*:\s*(\d+)/)

    return NextResponse.json({
      success: true,
      probe: {
        url: PI_URL,
        http_status: res.status,
        final_url: res.url,
        html_bytes: html.length,
        elapsed_ms: Date.now() - started,
        has_nordic_blob: hasBlob,
        has_initial_state: hasInitialState,
        poly_cards: polyCards,
        distinct_mlc_ids: mlcIds,
        portal_total: totalMatch ? Number(totalMatch[1]) : null,
        // Veredicto: si trae el blob, la VPS puede scrapear directo; si no,
        // recibe la variante ligera / bloqueo → hay que usar el proxy Evomi.
        verdict: hasBlob
          ? 'OK — la VPS recibe la variante con blob (puede scrapear directo)'
          : (res.status !== 200
              ? `BLOQUEO — HTTP ${res.status} desde la VPS`
              : 'VARIANTE LIGERA — 200 sin blob: la VPS necesita el proxy Evomi'),
      },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      probe: {
        url: PI_URL,
        elapsed_ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        verdict: 'ERROR de red desde la VPS hacia Portal Inmobiliario',
      },
    }, { status: 200 })
  }
}
