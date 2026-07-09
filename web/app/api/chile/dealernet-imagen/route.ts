import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

// Proxy de la foto de perfil (WhatsApp) que DealerNet asocia a cada teléfono
// vía `idimagen`. El web service SOAP solo entrega el id — la imagen la sirve
// el portal web de DealerNet en (path confirmado inspeccionando el DOM del
// portal, donde `id_imagen` coincide con el `idimagen` del WS):
//
//   {portal}/tlfw/asp/system/tlfw.system.reziseImage.aspx?CODCOMP={id}|60|60|1
//
// Config en .env (editable desde la UI de /dealer):
// - DEALERNET_PORTAL_BASE_URL   https://<host del portal> (el dominio donde
//                               se abre DealerNet en el navegador)
// - DEALERNET_IMAGE_COOKIE     (opcional) header Cookie de una sesión del
//                               portal, por si el endpoint exige sesión
// - DEALERNET_IMAGE_URL_TEMPLATE (opcional) URL completa con {id} — pisa la
//                               construida con el base URL, por si el path
//                               cambia en una versión futura del portal
//
// Se proxea en vez de apuntar el <img> directo al portal para no filtrar la
// URL interna/cookie al navegador y poder cachear.

const PORTAL_IMAGE_PATH = '/tlfw/asp/system/tlfw.system.reziseImage.aspx?CODCOMP={id}%7C60%7C60%7C1'

// Prioridad .env en disco > process.env — misma lógica (y motivo) que
// getDealernetCreds en web/lib/dealernet.ts: los guardados en caliente desde
// la UI de /dealer viven en el .env bind-mounteado.
function readEnvKey(content: string | null, key: string): string | null {
  const fromFile = content?.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
  return fromFile || process.env[key] || null
}

function getImageConfig(): { url: string | null; cookie: string | null; referer: string | null } {
  let content: string | null = null
  try {
    content = readFileSync(join(process.cwd(), '.env'), 'utf-8')
  } catch { /* sin .env en disco */ }

  const template = readEnvKey(content, 'DEALERNET_IMAGE_URL_TEMPLATE')
  const base = readEnvKey(content, 'DEALERNET_PORTAL_BASE_URL')?.replace(/\/+$/, '') ?? null
  const cookie = readEnvKey(content, 'DEALERNET_IMAGE_COOKIE')

  const url = template && template.includes('{id}')
    ? template
    : base ? `${base}${PORTAL_IMAGE_PATH}` : null

  return { url, cookie, referer: base }
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')?.trim()
  // El id se interpola en una URL externa: solo caracteres inofensivos.
  if (!id || !/^[\w.-]{1,128}$/.test(id)) {
    return new Response('id inválido', { status: 400 })
  }

  const { url: template, cookie, referer } = getImageConfig()
  if (!template) {
    // Sin portal configurado la UI simplemente no muestra avatar (el <img>
    // esconde con onError) — no es un error de servidor.
    return new Response('DEALERNET_PORTAL_BASE_URL no configurado', { status: 404 })
  }

  const url = template.replace('{id}', encodeURIComponent(id))
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        // El portal es una app ASP clásica pensada para navegador — se envían
        // headers de navegador (y la cookie de sesión si está configurada)
        // para que no rechace la petición como bot.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        ...(referer ? { Referer: `${referer}/` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.startsWith('image/')) {
      return new Response('imagen no disponible', { status: 404 })
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // La foto de un idimagen dado no cambia — cache agresivo del lado del
        // navegador para no golpear el portal en cada render.
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  } catch {
    return new Response('error consultando la imagen', { status: 502 })
  }
}
