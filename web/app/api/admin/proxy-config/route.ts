import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))

  const host = typeof body.SMARTPROXY_CL_HOST === 'string' ? body.SMARTPROXY_CL_HOST.trim() : ''
  const port = body.SMARTPROXY_CL_PORT ? String(body.SMARTPROXY_CL_PORT).trim() : ''
  const user = typeof body.SMARTPROXY_CL_USER === 'string' ? body.SMARTPROXY_CL_USER.trim() : ''
  const pass = typeof body.SMARTPROXY_CL_PASS === 'string' ? body.SMARTPROXY_CL_PASS.trim() : ''

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
      SMARTPROXY_CL_HOST: host,
      SMARTPROXY_CL_PORT: port,
      SMARTPROXY_CL_USER: user,
      SMARTPROXY_CL_PASS: pass,
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
    console.error('Error guardando proxy config:', error)
    return NextResponse.json(
      { success: false, error: 'Error al guardar las credenciales' },
      { status: 500 }
    )
  }
}
