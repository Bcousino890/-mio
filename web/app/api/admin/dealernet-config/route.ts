import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))

  const user = typeof body.DEALERNET_USER === 'string' ? body.DEALERNET_USER.trim() : ''
  const pass = typeof body.DEALERNET_PASSWORD === 'string' ? body.DEALERNET_PASSWORD.trim() : ''

  if (!user || !pass) {
    return NextResponse.json(
      { success: false, error: 'Usuario y contraseña son requeridos' },
      { status: 400 }
    )
  }

  try {
    const envPath = join(process.cwd(), '.env')
    let content = ''
    try {
      content = await fs.readFile(envPath, 'utf-8')
    } catch {
      content = ''
    }

    const updates = { DEALERNET_USER: user, DEALERNET_PASSWORD: pass }

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
    console.error('Error guardando dealernet config:', error)
    return NextResponse.json(
      { success: false, error: 'Error al guardar las credenciales' },
      { status: 500 }
    )
  }
}
