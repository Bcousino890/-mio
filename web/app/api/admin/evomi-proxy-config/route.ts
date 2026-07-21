import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))

  const host = typeof body.EVOMI_PROXY_HOST === 'string' ? body.EVOMI_PROXY_HOST.trim() : ''
  const port = body.EVOMI_PROXY_PORT ? String(body.EVOMI_PROXY_PORT).trim() : ''
  const user = typeof body.EVOMI_PROXY_USER === 'string' ? body.EVOMI_PROXY_USER.trim() : ''
  const pass = typeof body.EVOMI_PROXY_PASS === 'string' ? body.EVOMI_PROXY_PASS.trim() : ''

  if (!host || !port || !user || !pass) {
    return NextResponse.json(
      { success: false, error: 'Todos los campos son requeridos' },
      { status: 400 }
    )
  }

  try {
    const envPath = join(process.cwd(), '.env')
    let content = ''
    try {
      content = await fs.readFile(envPath, 'utf-8')
    } catch {
      // Si no existe, partir de vacío
      content = ''
    }

    // Actualizar o agregar cada variable
    const updates = {
      EVOMI_PROXY_HOST: host,
      EVOMI_PROXY_PORT: port,
      EVOMI_PROXY_USER: user,
      EVOMI_PROXY_PASS: pass,
    }

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
      message: 'Credenciales guardadas. Reinicia el contenedor para que se apliquen.',
    })
  } catch (error) {
    console.error('Error guardando Evomi proxy config:', error)
    return NextResponse.json(
      { success: false, error: 'Error al guardar las credenciales' },
      { status: 500 }
    )
  }
}
