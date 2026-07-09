import { NextRequest } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

// Proxy de la foto de perfil (WhatsApp) que DealerNet asocia a cada teléfono
// vía `idimagen`. El web service SOAP solo entrega el id — la imagen la sirve
// el portal de DealerNet por HTTP, y esa URL no está en la doc versionada,
// así que se configura como plantilla con el placeholder {id}:
//
//   DEALERNET_IMAGE_URL_TEMPLATE=https://www.dealernet.cl/.../imagen?id={id}
//
// (se obtiene abriendo una ficha en el portal → clic derecho sobre la foto →
// "Copiar dirección de imagen" → reemplazar el id por {id}).
//
// Se proxea en vez de apuntar el <img> directo al portal para no filtrar la
// URL interna (con eventuales tokens) al navegador y poder cachear.

// Prioridad .env en disco > process.env — misma lógica (y motivo) que
// getDealernetCreds en web/lib/dealernet.ts: los guardados en caliente desde
// la UI de /dealer viven en el .env bind-mounteado.
function getImageUrlTemplate(): string | null {
  try {
    const content = readFileSync(join(process.cwd(), '.env'), 'utf-8')
    const fromFile = content.match(/^DEALERNET_IMAGE_URL_TEMPLATE=(.+)$/m)?.[1]?.trim()
    if (fromFile) return fromFile
  } catch { /* sin .env en disco */ }
  return process.env.DEALERNET_IMAGE_URL_TEMPLATE ?? null
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')?.trim()
  // El id se interpola en una URL externa: solo caracteres inofensivos.
  if (!id || !/^[\w.-]{1,128}$/.test(id)) {
    return new Response('id inválido', { status: 400 })
  }

  const template = getImageUrlTemplate()
  if (!template || !template.includes('{id}')) {
    // Sin plantilla configurada la UI simplemente no muestra avatar (el <img>
    // oculta con onError) — no es un error de servidor.
    return new Response('DEALERNET_IMAGE_URL_TEMPLATE no configurado', { status: 404 })
  }

  const url = template.replace('{id}', encodeURIComponent(id))
  try {
    const res = await fetch(url, { redirect: 'follow' })
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
