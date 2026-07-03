import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'

function parseEnvVar(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return m?.[1]?.trim() ?? ''
}

export async function GET() {
  // Lee del .env en disco para reflejar el estado tras guardar sin necesidad de reiniciar
  let key = ''
  let model = ''
  try {
    const content = await fs.readFile(join(process.cwd(), '.env'), 'utf-8')
    key   = parseEnvVar(content, 'OPENROUTER_API_KEY')
    model = parseEnvVar(content, 'OPENROUTER_CHAT_MODEL')
  } catch { /* archivo no existe aún */ }

  // Fallback a process.env (cuando se inyectó vía Docker env directamente)
  if (!key)   key   = process.env.OPENROUTER_API_KEY   ?? ''
  if (!model) model = process.env.OPENROUTER_CHAT_MODEL ?? ''

  return NextResponse.json({
    configured: key.length > 0,
    keyMasked: key.length > 0
      ? `${key.slice(0, 8)}${'•'.repeat(Math.min(key.length - 8, 24))}`
      : '',
    model,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))

  const apiKey = typeof body.OPENROUTER_API_KEY   === 'string' ? body.OPENROUTER_API_KEY.trim()   : ''
  const model  = typeof body.OPENROUTER_CHAT_MODEL === 'string' ? body.OPENROUTER_CHAT_MODEL.trim() : ''

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'OPENROUTER_API_KEY es requerida' }, { status: 400 })
  }

  try {
    const envPath = join(process.cwd(), '.env')
    let content = ''
    try { content = await fs.readFile(envPath, 'utf-8') } catch { content = '' }

    const updates: Record<string, string> = { OPENROUTER_API_KEY: apiKey }
    if (model) updates.OPENROUTER_CHAT_MODEL = model

    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm')
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`)
      } else {
        if (content && !content.endsWith('\n')) content += '\n'
        content += `${key}=${value}\n`
      }
    }

    await fs.writeFile(envPath, content, 'utf-8')

    // Actualizar process.env en vivo para que la verificación visual funcione
    // inmediatamente sin reiniciar el contenedor
    process.env.OPENROUTER_API_KEY = apiKey
    if (model) process.env.OPENROUTER_CHAT_MODEL = model

    return NextResponse.json({ success: true, message: 'Guardado y activo.' })
  } catch (error) {
    console.error('Error guardando openrouter config:', error)
    return NextResponse.json({ success: false, error: 'Error al guardar' }, { status: 500 })
  }
}
