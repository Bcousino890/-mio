import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'

export async function GET() {
  const key = process.env.OPENROUTER_API_KEY ?? ''
  const model = process.env.OPENROUTER_CHAT_MODEL ?? ''
  return NextResponse.json({
    configured: key.length > 0,
    keyMasked: key.length > 0 ? `${key.slice(0, 6)}${'•'.repeat(Math.min(key.length - 6, 20))}` : '',
    model,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))

  const apiKey = typeof body.OPENROUTER_API_KEY === 'string' ? body.OPENROUTER_API_KEY.trim() : ''
  const model  = typeof body.OPENROUTER_CHAT_MODEL === 'string' ? body.OPENROUTER_CHAT_MODEL.trim() : ''

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'OPENROUTER_API_KEY es requerida' }, { status: 400 })
  }

  try {
    const envPath = join(process.cwd(), '.env')
    let content = ''
    try {
      content = await fs.readFile(envPath, 'utf-8')
    } catch {
      content = ''
    }

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

    return NextResponse.json({
      success: true,
      message: 'Guardado en .env. Reinicia el contenedor para que se aplique.',
    })
  } catch (error) {
    console.error('Error guardando openrouter config:', error)
    return NextResponse.json({ success: false, error: 'Error al guardar' }, { status: 500 })
  }
}
