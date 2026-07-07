import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'

function parseEnvVar(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return m?.[1]?.trim() ?? ''
}

export async function GET() {
  // Igual que /api/admin/openrouter-config: lee del .env en disco (refleja
  // guardados recientes sin reiniciar) con process.env como fallback para
  // credenciales inyectadas directamente vía Docker.
  let user = ''
  let pass = ''
  try {
    const content = await fs.readFile(join(process.cwd(), '.env'), 'utf-8')
    user = parseEnvVar(content, 'DEALERNET_USER')
    pass = parseEnvVar(content, 'DEALERNET_PASSWORD')
  } catch { /* archivo no existe aún */ }
  if (!user) user = process.env.DEALERNET_USER ?? ''
  if (!pass) pass = process.env.DEALERNET_PASSWORD ?? ''

  return NextResponse.json({
    configured: user.length > 0 && pass.length > 0,
    user,
  })
}

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
      message: 'Credenciales guardadas y activas — no hace falta reiniciar el contenedor.',
    })
  } catch (error) {
    console.error('Error guardando dealernet config:', error)
    return NextResponse.json(
      { success: false, error: 'Error al guardar las credenciales' },
      { status: 500 }
    )
  }
}
