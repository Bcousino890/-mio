// Consulta on-demand del Certificado de Deuda TGR para UN solo rol — pensado
// para el botón "Consultar TGR ahora" de la ficha de un predio en
// /chile/catastro. Es la contraparte "un rol, ya" del scraper masivo por
// lotes en scraper/tgr/tgr_scraper.py (que procesa toda la Región
// Metropolitana en background, vía GitHub Actions + VPS, y tarda horas).
//
// Puerto fiel de la lógica ya calibrada en tgr_scraper.py (selectores, regex
// de parseo del PDF embebido, detección de WAF) pero con Playwright en vez
// de Selenium, para poder correr dentro del proceso de Next.js sin depender
// de chromedriver/venv de Python.
//
// IMPORTANTE — mismo sitio, mismo riesgo de bloqueo: tesoreria.cl bloquea por
// WAF (F5 BIG-IP ASM) la IP entera del servidor si detecta tráfico tipo bot,
// no por RUT/rol. Eso ya tumbó el scraper masivo varias veces (ver historial
// en scraper/tgr/.launch-tgr). Por eso este módulo serializa las consultas
// (una a la vez, nunca en paralelo) y respeta un cooldown largo apenas
// detecta el bloqueo, en vez de reintentar en loop.

import { chromium, type Browser, type Page } from 'playwright-core'
import { existsSync } from 'fs'
import { PDFParse } from 'pdf-parse'

const URL_TRAMITE = 'https://www.tesoreria.cl/CertDeudasRolCutAixWeb/Controller.jpf?RUT=0&DV=0&EMAIL='
const REGION_METROPOLITANA_VALUE = '13'
const FORM_TIMEOUT_MS = 25_000
const WAF_COOLDOWN_MS = 5 * 60_000

export interface TgrCertificado {
  rol: string
  comuna: string
  nombre: string | null
  direccion: string | null
  totalDeudaNoVencida: number | null
  totalDeudaMorosa: number | null
  totalAcogidoArt196197: number | null
  tieneDeuda: boolean | null
  fechaEmisionCertificado: string | null
  liquidadaAl: string | null
  emitidoALas: string | null
  codigoVerificacion: string | null
  estado: 'exitosa' | 'sin_deuda' | 'error' | 'bloqueado'
  error: string | null
}

// ─── estado compartido: cooldown de WAF + serialización de requests ───────

let wafCooldownUntil = 0
let requestChain: Promise<unknown> = Promise.resolve()

export function tgrCooldownRemainingMs(): number {
  return Math.max(0, wafCooldownUntil - Date.now())
}

function markWafBlocked() {
  wafCooldownUntil = Date.now() + WAF_COOLDOWN_MS
}

// Encola la ejecución para que nunca haya dos consultas TGR corriendo Chrome
// en simultáneo — igual que el aprendizaje documentado en tgr_scraper.py
// (varios workers en paralelo aceleran el bloqueo del WAF, no el throughput).
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestChain.then(fn, fn)
  requestChain = run.catch(() => {})
  return run
}

// ─── parseo del certificado (puerto de parsear_resultado en tgr_scraper.py) ─

function parseClp(texto: string | null | undefined): number | null {
  if (texto == null) return null
  const limpio = texto.trim().replace(/[.,]/g, '')
  if (!/^\d+$/.test(limpio)) return null
  return Number(limpio)
}

async function extraerTextoPdfDeHtml(html: string): Promise<string | null> {
  const m = html.match(/data:application\/pdf;base64,([A-Za-z0-9+/=]+)/)
  if (!m) return null
  try {
    const buffer = Buffer.from(m[1], 'base64')
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    return result.text
  } catch {
    return null
  }
}

export async function parsearResultadoTgr(html: string, rol: string, comuna: string): Promise<TgrCertificado> {
  const base: TgrCertificado = {
    rol, comuna, nombre: null, direccion: null,
    totalDeudaNoVencida: null, totalDeudaMorosa: null, totalAcogidoArt196197: null,
    tieneDeuda: null, fechaEmisionCertificado: null, liquidadaAl: null, emitidoALas: null,
    codigoVerificacion: null, estado: 'error', error: null,
  }

  const textoPdf = await extraerTextoPdfDeHtml(html)

  if (textoPdf == null) {
    const textoPlano = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    if (/no\s+(registra|presenta)\s+deuda/i.test(textoPlano) || /no\s+se\s+encontr/i.test(textoPlano)) {
      return { ...base, tieneDeuda: false, estado: 'sin_deuda' }
    }
    return { ...base, estado: 'error', error: 'No se encontró PDF embebido en el resultado (revisar selectores/flujo)' }
  }

  const texto = textoPdf.replace(/[ \t]+/g, ' ')
  const textoUnaLinea = textoPdf.replace(/\s+/g, ' ')

  const nombre = texto.match(/NOMBRE\s+(.+?)\s*\n/)?.[1]?.trim() ?? null
  const direccion = textoUnaLinea.match(/DIRECCION\s+(.+?)\s+COMUNA\b/i)?.[1]?.trim() ?? null

  const mNoVencida = textoUnaLinea.match(/Total\s+Deuda\s+No\s+Vencida\s*\(CLP\)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i)
  const mMorosa = textoUnaLinea.match(/Total\s+Deuda\s+Morosa\s*\(CLP\)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i)
  const mAcogido = textoUnaLinea.match(/Total\s+Acogid[oa]s?\s+ART\s+196\s+y\s+197\s*\(CLP\)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i)

  const totalDeudaNoVencida = mNoVencida ? parseClp(mNoVencida[5]) : null
  const totalDeudaMorosa = mMorosa ? parseClp(mMorosa[5]) : null
  const totalAcogidoArt196197 = mAcogido ? parseClp(mAcogido[5]) : null

  if (totalDeudaNoVencida == null && totalDeudaMorosa == null && totalAcogidoArt196197 == null &&
      /no\s+(registra|presenta)\s+deuda/i.test(textoUnaLinea)) {
    return { ...base, tieneDeuda: false, estado: 'sin_deuda' }
  }

  const fechaEmisionCertificado = texto.match(/Fecha\s+de\s+Emisi[oó]n\s+del\s+Certificado:\s*([\d\-A-Za-z]+)/i)?.[1]?.trim() ?? null
  const liquidadaAl = texto.match(/Liquidada\s+al:\s*([\d-]+)/i)?.[1]?.trim() ?? null
  const emitidoALas = texto.match(/Emitido\s+a\s+las:?\s*(\d{1,2}:\d{2})/i)?.[1]?.trim() ?? null
  const codigoVerificacion = texto.match(/\b(\d{3}[A-Z]{2}\d{10,})\b/)?.[1] ?? null

  const tieneDeuda = [totalDeudaNoVencida, totalDeudaMorosa, totalAcogidoArt196197].some(t => t && t > 0)

  if (!nombre) {
    return { ...base, estado: 'error', error: 'No se pudo extraer NOMBRE del resultado (revisar parser/selectores)' }
  }

  return {
    ...base,
    nombre, direccion,
    totalDeudaNoVencida, totalDeudaMorosa, totalAcogidoArt196197,
    tieneDeuda, fechaEmisionCertificado, liquidadaAl, emitidoALas, codigoVerificacion,
    estado: tieneDeuda ? 'exitosa' : 'sin_deuda',
    error: null,
  }
}

// ─── automatización del formulario (puerto de WorkerTGR.consultar_una_vez) ─

function findChromeBinary(): string {
  const candidates = [
    process.env.CHROME_BINARY,
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter((p): p is string => !!p)
  const found = candidates.find(p => existsSync(p))
  if (!found) {
    throw new Error(
      'No se encontró un binario de Chrome/Chromium para la consulta TGR. ' +
      'Configura la variable de entorno CHROME_BINARY (mismo binario que usa scraper/tgr/run-tgr.sh).'
    )
  }
  return found
}

async function llenarFormularioYBuscar(page: Page, manzana: string, predio: string, comunaNombre: string): Promise<string> {
  await page.goto(URL_TRAMITE, { waitUntil: 'domcontentloaded', timeout: FORM_TIMEOUT_MS })
  await page.waitForSelector('#region', { timeout: FORM_TIMEOUT_MS })

  await page.selectOption('#region', REGION_METROPOLITANA_VALUE)

  // El onchange="recargar()" del <select> de región dispara una recarga
  // completa de la página (no AJAX), que repuebla el <select> de comuna.
  await page.waitForFunction(() => {
    const el = document.querySelector('#comuna') as HTMLSelectElement | null
    return !!el && el.options.length > 1
  }, { timeout: FORM_TIMEOUT_MS })

  const comunaUpper = comunaNombre.trim().toUpperCase()
  const opciones = await page.$$eval('#comuna option', (opts) => opts.map(o => (o as HTMLOptionElement).textContent?.trim() ?? ''))
  const opcionEncontrada = opciones.find(o => o.toUpperCase().startsWith(comunaUpper))
  if (!opcionEncontrada) {
    throw new Error(`No se encontró la comuna "${comunaNombre}" en el formulario de TGR`)
  }
  await page.selectOption('#comuna', { label: opcionEncontrada })

  await page.fill('#rol', manzana)
  await page.fill('#subRol', predio)
  await page.click('#buscar')

  await page.waitForSelector('#mail', { timeout: FORM_TIMEOUT_MS })
  return page.content()
}

async function consultarTgrInterno(manzana: string, predio: string, comunaNombre: string, rolCompleto: string): Promise<TgrCertificado> {
  let browser: Browser | null = null
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: findChromeBinary(),
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900},
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    // Imágenes/CSS/fuentes no aportan datos y solo multiplican el tráfico —
    // mismo criterio que --blink-settings=imagesEnabled=false en el scraper Python.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (type === 'image' || type === 'font' || type === 'stylesheet') return route.abort()
      return route.continue()
    })

    const html = await llenarFormularioYBuscar(page, manzana, predio, comunaNombre)
    return await parsearResultadoTgr(html, rolCompleto, comunaNombre)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // El WAF F5 BIG-IP ASM de tesoreria.cl responde con una página "Request
    // Rejected" con un "support ID" en vez de timeout de red — si el error
    // vino de un timeout, es la señal más común de bloqueo activo.
    if (/Request Rejected|support ID is/i.test(message)) {
      markWafBlocked()
      return {
        rol: rolCompleto, comuna: comunaNombre, nombre: null, direccion: null,
        totalDeudaNoVencida: null, totalDeudaMorosa: null, totalAcogidoArt196197: null,
        tieneDeuda: null, fechaEmisionCertificado: null, liquidadaAl: null, emitidoALas: null,
        codigoVerificacion: null, estado: 'bloqueado',
        error: 'Tesorería bloqueó la conexión (WAF). Intenta de nuevo en unos minutos.',
      }
    }
    return {
      rol: rolCompleto, comuna: comunaNombre, nombre: null, direccion: null,
      totalDeudaNoVencida: null, totalDeudaMorosa: null, totalAcogidoArt196197: null,
      tieneDeuda: null, fechaEmisionCertificado: null, liquidadaAl: null, emitidoALas: null,
      codigoVerificacion: null, estado: 'error', error: message,
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

// Punto de entrada público: consulta UN rol (manzana-predio) en una comuna,
// serializado contra cualquier otra consulta TGR en curso y respetando el
// cooldown si el WAF bloqueó recientemente.
export async function consultarTgrRol(manzana: string, predio: string, comunaNombre: string, rolCompleto: string): Promise<TgrCertificado> {
  const remaining = tgrCooldownRemainingMs()
  if (remaining > 0) {
    return {
      rol: rolCompleto, comuna: comunaNombre, nombre: null, direccion: null,
      totalDeudaNoVencida: null, totalDeudaMorosa: null, totalAcogidoArt196197: null,
      tieneDeuda: null, fechaEmisionCertificado: null, liquidadaAl: null, emitidoALas: null,
      codigoVerificacion: null, estado: 'bloqueado',
      error: `Tesorería bloqueó la última consulta — espera ${Math.ceil(remaining / 1000)}s antes de reintentar.`,
    }
  }
  return serialize(() => consultarTgrInterno(manzana, predio, comunaNombre, rolCompleto))
}
