// La galería de Portal Inmobiliario está DUPLICADA (web/ y scraper/), y este
// test es lo que impide que vuelva a pasar lo que pasó.
//
//   node --import tsx --test lib/__tests__/gallery-cl-paridad.test.ts
//
// QUÉ PASÓ: el bug "solo scrapea 5 fotos" se arregló cuatro veces —a088400,
// 493e3cc, 8ce2343, 0cb5e21— y las cuatro SOLO en scraper/lib. La copia de web/
// se quedó con la versión de julio, así que el worker 24/7 traía 20-30 fotos y
// todo lo que dispara la interfaz (el botón "Re-scrapear" de la ficha, captar
// desde una URL, buscar por código) seguía guardando 5. El síntoma volvía una y
// otra vez porque solo la mitad del sistema estaba arreglada.
//
// POR QUÉ 5 Y NO OTRO NÚMERO: el HTML de la ficha solo incrusta el
// `gallery_mosaic` del blob — `primary` (1) + `secondary` (4). El resto vive en
// un modal aparte. Traer una ficha completa son DOS peticiones.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  BLOB_PHOTO_CAP, aMaximaResolucion, esFotoDeAnuncio, fetchTodasLasFotos, incompleta,
} from '../fetch-portalinmobiliario-gallery'

const FUENTE_SCRAPER = readFileSync(
  fileURLToPath(new URL('../../../scraper/lib/parse-portalinmobiliario.mjs', import.meta.url)),
  'utf8',
)

// ── Los mecanismos que le faltaban a web/ y que el worker sí tenía ──────────

test('la copia del scraper sigue teniendo los tres mecanismos', () => {
  // Si alguno desaparece de allí, este test avisa antes de que las copias se
  // separen otra vez — esta vez en el otro sentido.
  assert.match(FUENTE_SCRAPER, /function incompleta\(/, 'falta el reintento por respuesta incompleta')
  assert.match(FUENTE_SCRAPER, /fetchGalleryByItemId/, 'falta el modal por item id')
  assert.match(FUENTE_SCRAPER, /forceProxy/, 'falta el reintento por proxy')
})

test('las dos copias usan el mismo tope del blob', () => {
  const m = FUENTE_SCRAPER.match(/BLOB_PHOTO_CAP\s*=\s*(\d+)/)
  assert.ok(m, 'BLOB_PHOTO_CAP no está en la copia del scraper')
  assert.equal(BLOB_PHOTO_CAP, Number(m[1]))
})

test('las dos copias construyen la misma URL del modal por item id', () => {
  assert.match(FUENTE_SCRAPER, /vis-modals\/gallery\//)
})

// ── incompleta(): cuándo merece la pena reintentar ──────────────────────────

test('sin fotos siempre se reintenta', () => {
  assert.equal(incompleta(0, null), true)
  assert.equal(incompleta(0, 20), true)
})

test('con menos de las declaradas también se reintenta', () => {
  // El caso que se daba por bueno: un bloqueo llega como 200 a medias y una
  // galería de 29 se guardaba con 17 para siempre.
  assert.equal(incompleta(17, 29), true)
  assert.equal(incompleta(5, 20), true)
})

test('completas o sin total declarado, no se reintenta', () => {
  assert.equal(incompleta(20, 20), false)
  assert.equal(incompleta(29, 20), false)
  // Sin total no hay contra qué comparar: reintentar sería pedir el modal en bucle.
  assert.equal(incompleta(5, null), false)
})

// ── Los filtros que evitaban basura y media resolución ─────────────────────

test('solo son fotos del anuncio las que llevan id de Mercado Libre', () => {
  assert.equal(esFotoDeAnuncio('https://http2.mlstatic.com/D_NQ_NP_692866-MLC110477947669-F.webp'), true)
  // Los placeholders de "aquí no hay nada" de la galería se colaban como fotos.
  assert.equal(esFotoDeAnuncio('https://http2.mlstatic.com/frontend-assets/vis-transactions-frontend/big-empty-state.webp'), false)
  assert.equal(esFotoDeAnuncio(''), false)
})

test('toda foto se pide en la variante de más resolución', () => {
  // El blob sirve en -F y el modal por item id en -O (menos de la mitad de
  // peso): sin normalizar, las primeras se veían bien y el resto peor.
  assert.equal(
    aMaximaResolucion('https://http2.mlstatic.com/D_NQ_NP_692866-MLC110477947669-O.webp'),
    'https://http2.mlstatic.com/D_NQ_NP_692866-MLC110477947669-F.webp',
  )
  assert.equal(
    aMaximaResolucion('https://http2.mlstatic.com/D_NQ_NP_2X_601011-MLC69497908626_052023-V.jpg'),
    'https://http2.mlstatic.com/D_NQ_NP_2X_601011-MLC69497908626_052023-F.jpg',
  )
})

test('una URL que no es del CDN no se toca', () => {
  assert.equal(aMaximaResolucion('https://ejemplo.cl/foto.jpg'), 'https://ejemplo.cl/foto.jpg')
})

// ── Ningún camino de web/ puede volver a quedarse con las 5 del mosaico ────

test('los caminos de web/ piden la galería completa por el punto único', () => {
  const caminos = [
    '../scrape-listing-cl.ts',          // buscar por código/URL
    '../captar-pipeline.ts',            // captar desde URL y desde el pin
    '../../app/api/chile/listings-cl/refetch/route.ts', // botón "Re-scrapear"
  ]
  for (const camino of caminos) {
    const fuente = readFileSync(fileURLToPath(new URL(camino, import.meta.url)), 'utf8')
    assert.match(
      fuente, /fetchTodasLasFotos/,
      `${camino} no usa fetchTodasLasFotos: se quedará con las 5 fotos del blob`,
    )
  }
})

// ── El arreglo, funcionando de verdad ───────────────────────────────────────
// Sin proxy configurado el fetch va directo, así que se puede simular el portal
// interceptando globalThis.fetch.

function portalFalso(respuestas: Record<string, string>) {
  const pedidas: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url)
    pedidas.push(u)
    const cuerpo = Object.entries(respuestas).find(([clave]) => u.includes(clave))?.[1]
    return cuerpo == null
      ? { ok: false, text: async () => '' }
      : { ok: true, text: async () => cuerpo }
  }) as typeof globalThis.fetch
  return { pedidas, restaurar: () => { globalThis.fetch = original } }
}

const fotoDelCdn = (n: number, tam = 'O') =>
  `https://http2.mlstatic.com/D_NQ_NP_69286${n}-MLC11047794766${n}-${tam}.webp`

test('con 5 del blob y SIN gallery_url, se pide el modal por item id', async (t) => {
  // Éste es el agujero que dejaba la ficha en 5 sin que fallara nada visible:
  // el blob no traía media_counters.url, así que no había segunda petición.
  const htmlModal = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `123456-MLC${n}00000000`).join(' ')
  const { pedidas, restaurar } = portalFalso({ '/vis-modals/gallery/': htmlModal })
  t.after(restaurar)

  const fotos = await fetchTodasLasFotos({
    delBlob: [1, 2, 3, 4, 5].map((n) => fotoDelCdn(n, 'F')),
    galleryUrl: null,
    externalId: 'MLC-1949785199',
    esperadas: null,
  })

  assert.ok(pedidas.some((u) => u.includes('/vis-modals/gallery/MLC1949785199')), 'no se pidió el modal por item id')
  assert.ok(fotos.length > BLOB_PHOTO_CAP, `se quedó en ${fotos.length} fotos`)
})

test('las fotos del modal salen a máxima resolución y sin gráficos de interfaz', async (t) => {
  const htmlModal = `
    <img data-zoom="${fotoDelCdn(7, 'O')}">
    <img src="https://http2.mlstatic.com/frontend-assets/vis-transactions-frontend/big-empty-state.webp">
  `
  const { restaurar } = portalFalso({ '/gallery-modal': htmlModal })
  t.after(restaurar)

  const fotos = await fetchTodasLasFotos({
    delBlob: [fotoDelCdn(1, 'F')],
    galleryUrl: 'https://www.portalinmobiliario.com/gallery-modal',
    externalId: null,
    esperadas: 2,
  })

  assert.ok(fotos.every((f) => f.includes('-F.webp')), `alguna no está a máxima resolución: ${fotos}`)
  assert.ok(!fotos.some((f) => f.includes('empty-state')), 'se coló un gráfico de la interfaz')
})

test('la misma foto en dos plantillas cuenta una sola vez', async (t) => {
  const { restaurar } = portalFalso({ '/gallery-modal': `<img data-zoom="${fotoDelCdn(1, 'O')}">` })
  t.after(restaurar)

  const fotos = await fetchTodasLasFotos({
    delBlob: [fotoDelCdn(1, 'F')],
    galleryUrl: 'https://www.portalinmobiliario.com/gallery-modal',
    externalId: null,
    esperadas: 1,
  })
  assert.equal(fotos.length, 1)
})
