// ─────────────────────────────────────────────────────────────────────────────
// google-drive-download.ts — descarga server-side de archivos públicos de
// Google Drive sin pasar por el navegador del usuario. Compartido entre los
// distintos endpoints "from-url" (CSV nacional de catastral.cl, Parquet
// enriquecido) para no duplicar el manejo de la página de confirmación.
// ─────────────────────────────────────────────────────────────────────────────
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Acepta tanto el link de compartir ("/file/d/<id>/view") como el de
// descarga directa ("?id=<id>").
export function extractDriveFileId(url: string): string | null {
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/]
  for (const re of patterns) {
    const match = url.match(re)
    if (match) return match[1]
  }
  return null
}

// Descarga un archivo público de Google Drive al disco local. Para archivos
// >25MB, Drive intercala una página de confirmación ("no se puede analizar
// por virus") en vez del archivo — se intenta primero el endpoint moderno
// que la evita directamente, y si igual llega HTML se cae al flujo clásico
// de cookie + token `confirm=`.
export async function downloadFromDrive(fileId: string, destPath: string): Promise<void> {
  const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
  let res = await fetch(directUrl, { redirect: 'follow' })
  let contentType = res.headers.get('content-type') ?? ''

  if (!res.ok || contentType.includes('text/html')) {
    const firstUrl = `https://drive.google.com/uc?export=download&id=${fileId}`
    const first = await fetch(firstUrl, { redirect: 'follow' })
    const cookie = first.headers.get('set-cookie') ?? ''
    const firstBody = await first.text()
    const confirmMatch = firstBody.match(/confirm=([0-9A-Za-z_-]+)/)
    if (!confirmMatch) {
      throw new Error('No se pudo obtener el token de confirmación de Google Drive (¿el enlace es privado o no existe?)')
    }
    const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`
    res = await fetch(confirmUrl, { headers: cookie ? { cookie } : undefined, redirect: 'follow' })
    contentType = res.headers.get('content-type') ?? ''
    if (!res.ok) throw new Error(`Error descargando desde Google Drive (${res.status})`)
    if (contentType.includes('text/html')) {
      throw new Error('Google Drive devolvió una página HTML en vez del archivo (revisa que el enlace sea público)')
    }
  }

  if (!res.body) throw new Error('Respuesta de Google Drive sin cuerpo')
  await pipeline(
    Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>),
    createWriteStream(destPath)
  )
}
