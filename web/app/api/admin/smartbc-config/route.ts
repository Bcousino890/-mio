// ─────────────────────────────────────────────────────────────────────────────
// Configuración de la integración con SmartBC (Configuración → SmartBC).
//
// Mismo mecanismo que el panel de OpenRouter: la clave se escribe en el `.env`
// del servidor y se refleja en `process.env` en caliente, para que el botón
// "Agregar a Smart" funcione sin reiniciar el contenedor.
//
// La clave NUNCA se devuelve entera: el GET solo dice si está configurada y
// muestra el prefijo. Una clave de SmartBC no se puede recuperar (si se pierde,
// se emite otra), así que enseñarla aquí no aportaría nada y sí sería una
// filtración más en el navegador.
//
// Guardar la comprueba contra `GET /api/v1/ping` antes de darla por buena. Una
// clave mal pegada guardada en silencio se descubriría más tarde, en el peor
// momento: cuando alguien pulsa "Agregar a Smart" con un cliente delante.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'
import { SmartbcClient, DEFAULTS } from '@/lib/smartbc/client.mjs'

export const runtime = 'nodejs'

function parseEnvVar(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m?.[1]?.trim() ?? ''
}

async function leerEnv() {
  let key = ''
  let baseUrl = ''
  try {
    const content = await fs.readFile(join(process.cwd(), '.env'), 'utf-8')
    key = parseEnvVar(content, 'SMARTBC_API_KEY')
    baseUrl = parseEnvVar(content, 'SMARTBC_BASE_URL')
  } catch { /* todavía no existe el archivo */ }
  // Respaldo: la variable puede venir inyectada por Docker sin pasar por .env
  if (!key) key = process.env.SMARTBC_API_KEY ?? ''
  if (!baseUrl) baseUrl = process.env.SMARTBC_BASE_URL ?? ''
  return { key, baseUrl: baseUrl || DEFAULTS.baseUrl }
}

/** Comprueba la clave contra la API. Devuelve a quién pertenece y qué permisos tiene. */
async function verificar(key: string, baseUrl: string) {
  const client = new SmartbcClient({ apiKey: key, baseUrl })
  const res = await client.ping()
  return {
    cliente: res.data?.client?.name ?? null,
    slug: res.data?.client?.slug ?? null,
    pais: res.data?.client?.country ?? null,
    scopes: res.data?.scopes ?? [],
    rate_limit: res.data?.rate_limit_per_minute ?? null,
  }
}

export async function GET() {
  const { key, baseUrl } = await leerEnv()
  return NextResponse.json({
    configured: key.length > 0,
    keyMasked: key.length > 0
      ? `${key.slice(0, 13)}${'•'.repeat(Math.min(Math.max(key.length - 13, 0), 24))}`
      : '',
    baseUrl,
    // Sin escritura no se puede dar de alta nada: el panel lo avisa.
    puedeEscribir: null as boolean | null,
  })
}

/** POST { probar: true } → solo comprueba la clave guardada, sin tocar nada. */
export async function PUT() {
  const { key, baseUrl } = await leerEnv()
  if (!key) {
    return NextResponse.json({ success: false, error: 'No hay clave configurada' }, { status: 400 })
  }
  try {
    const info = await verificar(key, baseUrl)
    return NextResponse.json({ success: true, data: info })
  } catch (error) {
    const err = error as { code?: string; message?: string; requestId?: string }
    return NextResponse.json(
      { success: false, error: err.message ?? 'La clave no responde', code: err.code ?? null },
      { status: 400 },
    )
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const apiKey = typeof body.SMARTBC_API_KEY === 'string' ? body.SMARTBC_API_KEY.trim() : ''
  const baseUrlIn = typeof body.SMARTBC_BASE_URL === 'string' ? body.SMARTBC_BASE_URL.trim() : ''
  const baseUrl = baseUrlIn || DEFAULTS.baseUrl

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'La clave es obligatoria' }, { status: 400 })
  }

  // Se valida ANTES de escribirla: guardar una clave que no funciona deja el
  // botón "Agregar a Smart" roto sin que nadie se entere hasta usarlo.
  let info
  try {
    info = await verificar(apiKey, baseUrl)
  } catch (error) {
    const err = error as { code?: string; message?: string }
    return NextResponse.json(
      {
        success: false,
        error: err.code === 'unauthorized'
          ? 'La clave no es válida o fue revocada (SmartBC respondió 401)'
          : `No se pudo verificar la clave: ${err.message ?? 'error desconocido'}`,
        code: err.code ?? null,
      },
      { status: 400 },
    )
  }

  if (!info.scopes.includes('captaciones:write')) {
    return NextResponse.json(
      {
        success: false,
        error: `La clave es válida pero no tiene permiso de escritura (scopes: ${info.scopes.join(', ') || 'ninguno'}). Pide a SmartBC una con captaciones:write.`,
      },
      { status: 400 },
    )
  }

  try {
    const envPath = join(process.cwd(), '.env')
    let content = ''
    try { content = await fs.readFile(envPath, 'utf-8') } catch { content = '' }

    for (const [key, value] of Object.entries({ SMARTBC_API_KEY: apiKey, SMARTBC_BASE_URL: baseUrl })) {
      const regex = new RegExp(`^${key}=.*$`, 'm')
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`)
      } else {
        if (content && !content.endsWith('\n')) content += '\n'
        content += `${key}=${value}\n`
      }
    }
    await fs.writeFile(envPath, content, 'utf-8')

    // En caliente: el botón de la ficha funciona sin reiniciar el contenedor.
    process.env.SMARTBC_API_KEY = apiKey
    process.env.SMARTBC_BASE_URL = baseUrl

    return NextResponse.json({ success: true, data: info })
  } catch (error) {
    console.error('Error guardando la configuración de SmartBC:', error)
    return NextResponse.json(
      { success: false, error: 'No se pudo escribir el .env del servidor' },
      { status: 500 },
    )
  }
}
