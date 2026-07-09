import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'

function parseEnvVar(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return m?.[1]?.trim() ?? ''
}

// Claves editables desde la UI de /dealer. Además de las credenciales SOAP,
// la config del portal web para las fotos de perfil por teléfono (ver
// web/app/api/chile/dealernet-imagen/route.ts).
const EDITABLE_KEYS = [
  'DEALERNET_USER',
  'DEALERNET_PASSWORD',
  'DEALERNET_PORTAL_BASE_URL',
  'DEALERNET_IMAGE_COOKIE',
] as const

export async function GET() {
  // Igual que /api/admin/openrouter-config: lee del .env en disco (refleja
  // guardados recientes sin reiniciar) con process.env como fallback para
  // credenciales inyectadas directamente vía Docker.
  const values: Record<string, string> = {}
  let content = ''
  try {
    content = await fs.readFile(join(process.cwd(), '.env'), 'utf-8')
  } catch { /* archivo no existe aún */ }
  for (const key of EDITABLE_KEYS) {
    values[key] = parseEnvVar(content, key) || process.env[key] || ''
  }

  return NextResponse.json({
    configured: values.DEALERNET_USER.length > 0 && values.DEALERNET_PASSWORD.length > 0,
    user: values.DEALERNET_USER,
    portal_base_url: values.DEALERNET_PORTAL_BASE_URL,
    // La cookie es una credencial — solo se expone si está o no configurada.
    image_cookie_configured: values.DEALERNET_IMAGE_COOKIE.length > 0,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))

  // Guardado parcial: solo se tocan las claves presentes y no vacías, para
  // poder configurar el portal de fotos sin re-tipear usuario/contraseña.
  const updates: Record<string, string> = {}
  for (const key of EDITABLE_KEYS) {
    if (typeof body[key] === 'string' && body[key].trim()) {
      updates[key] = body[key].trim()
    }
  }

  // Usuario y contraseña van juntos — guardar solo uno deja credenciales
  // inconsistentes (mismo comportamiento que la versión anterior del panel).
  const hasUser = 'DEALERNET_USER' in updates
  const hasPass = 'DEALERNET_PASSWORD' in updates
  if (hasUser !== hasPass) {
    return NextResponse.json(
      { success: false, error: 'Usuario y contraseña deben guardarse juntos' },
      { status: 400 }
    )
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { success: false, error: 'Nada que guardar' },
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
      message: 'Configuración guardada y activa — no hace falta reiniciar el contenedor.',
    })
  } catch (error) {
    console.error('Error guardando dealernet config:', error)
    return NextResponse.json(
      { success: false, error: 'Error al guardar la configuración' },
      { status: 500 }
    )
  }
}
