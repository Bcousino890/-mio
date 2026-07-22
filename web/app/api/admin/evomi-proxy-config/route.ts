import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { join } from 'path'

function parseEnvVar(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m?.[1]?.trim() ?? ''
}

// GET: refleja lo que hay REALMENTE guardado en el .env del VPS, para que el
// panel no dependa de adivinar a partir del placeholder gris del formulario
// (el formulario se limpia tras guardar, ver EvomiProxyConfigPanel.tsx — sin
// este endpoint no había forma de confirmar visualmente qué quedó guardado).
// La password NUNCA se revela (ni parcialmente): solo se informa si existe.
export async function GET() {
  let host = '', port = '', user = '', pass = ''
  try {
    const content = await fs.readFile(join(process.cwd(), '.env'), 'utf-8')
    host = parseEnvVar(content, 'EVOMI_PROXY_HOST')
    port = parseEnvVar(content, 'EVOMI_PROXY_PORT')
    user = parseEnvVar(content, 'EVOMI_PROXY_USER')
    pass = parseEnvVar(content, 'EVOMI_PROXY_PASS')
  } catch { /* .env no existe aún */ }

  if (!host) host = process.env.EVOMI_PROXY_HOST ?? ''
  if (!port) port = process.env.EVOMI_PROXY_PORT ?? ''
  if (!user) user = process.env.EVOMI_PROXY_USER ?? ''
  if (!pass) pass = process.env.EVOMI_PROXY_PASS ?? ''

  return NextResponse.json({
    configured: host.length > 0 && user.length > 0 && pass.length > 0,
    host,
    port,
    user,
    hasPassword: pass.length > 0,
  })
}

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

    // Actualizar process.env en vivo: fetch.mjs (el scraper) lee el .env del
    // volumen montado directamente, pero esto permite que el GET de arriba
    // (y cualquier otra parte de la app Next.js que use este proxy) refleje
    // el cambio de inmediato, sin esperar a reiniciar el contenedor.
    process.env.EVOMI_PROXY_HOST = host
    process.env.EVOMI_PROXY_PORT = port
    process.env.EVOMI_PROXY_USER = user
    process.env.EVOMI_PROXY_PASS = pass

    return NextResponse.json({
      success: true,
      message: 'Credenciales guardadas y activas.',
    })
  } catch (error) {
    console.error('Error guardando Evomi proxy config:', error)
    return NextResponse.json(
      { success: false, error: 'Error al guardar las credenciales' },
      { status: 500 }
    )
  }
}
