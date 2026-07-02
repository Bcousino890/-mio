// Verificación visual V4: compara las FOTOS del anuncio con el RECORTE
// SATELITAL de cada parcela candidata usando un modelo de visión vía
// OpenRouter (piscina y su forma/posición, tipo de techo — teja mediterránea,
// plano, gris —, entorno: árboles, cancha, acceso).
//
// Filosofía de costos del proyecto (docs/PLAN-MAESTRO.md): la IA es fallback,
// no camino principal. Esto solo corre cuando el match determinista queda en
// needs_review (<92%) o el usuario lo pide, con un modelo de visión barato y
// máximo ~4 fotos + topN recortes por llamada.
import type { ScoredCandidate } from '@/lib/captar-pipeline'

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
const VISION_MODEL = process.env.AI_MODEL_WORKHORSE || 'google/gemini-2.5-flash-lite'
const ESRI_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

export interface VisualVerdict {
  rol: string
  score: number // -1 (contradice) .. 1 (coincide fuerte)
  reasons: string
}

function tileXY(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x, y }
}

/** Descarga el tile satelital (Esri World Imagery) que contiene el punto. */
export async function fetchSatelliteTile(lat: number, lng: number, zoom = 19): Promise<string | null> {
  try {
    const { x, y } = tileXY(lat, lng, zoom)
    const res = await fetch(`${ESRI_TILE}/${zoom}/${y}/${x}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

export function visualVerificationAvailable(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

/**
 * Puntúa visualmente los topN candidatos contra las fotos del anuncio.
 * Devuelve un veredicto por rol; los roles sin coordenadas se omiten.
 * @param selectedPhotoUrls Fotos seleccionadas por el usuario (opcionalmente). Si se proporciona, se usan en lugar de las primeras 4.
 */
export async function verifyCandidatesVisually(
  photos: string[],
  candidates: ScoredCandidate[],
  context: { title?: string | null; description?: string | null; has_pool?: boolean; property_type?: string | null },
  topN = 4,
  selectedPhotoUrls?: string[],
): Promise<VisualVerdict[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY no configurada — la verificación visual requiere IA')

  // Si hay fotos seleccionadas por el usuario, úsalas; sino, fallback a 4 primeras
  const usablePhotos = selectedPhotoUrls && selectedPhotoUrls.length > 0
    ? selectedPhotoUrls.slice(0, 25)
    : photos.slice(0, 4)
  if (usablePhotos.length === 0) throw new Error('El anuncio no tiene fotos para comparar')

  const top = candidates.filter((c) => c.lat != null && c.lng != null).slice(0, topN)
  if (top.length === 0) throw new Error('Ningún candidato tiene coordenadas para obtener el satélite')

  const tiles = await Promise.all(top.map((c) => fetchSatelliteTile(Number(c.lat), Number(c.lng))))

  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text:
        `Eres un verificador catastral. Te doy (A) fotos de un anuncio inmobiliario en Chile y (B) recortes satelitales de ${top.length} parcelas candidatas.\n` +
        `Anuncio: ${context.title ?? ''} · tipo: ${context.property_type ?? 'desconocido'}${context.has_pool ? ' · el anuncio menciona PISCINA' : ''}\n` +
        `Para CADA candidata evalúa la coherencia visual con las fotos: piscina (existe/forma/posición), techo (color y material: teja roja mediterránea, plano, zinc gris...), tamaño y forma de la construcción, entorno (árboles, quincho, cancha).\n` +
        `Responde SOLO JSON válido: [{"rol": "...", "score": -1..1, "reasons": "breve, en español"}] — score 1 = las fotos claramente corresponden a esa parcela, 0 = no se puede saber, -1 = claramente contradice (ej: fotos con piscina y la parcela no tiene).`,
    },
    { type: 'text', text: '(A) FOTOS DEL ANUNCIO:' },
    ...usablePhotos.map((url) => ({ type: 'image_url', image_url: { url } })),
  ]
  top.forEach((c, i) => {
    content.push({ type: 'text', text: `(B${i + 1}) SATÉLITE candidata rol ${c.rol} (${c.direccion ?? 'sin dirección'}):` })
    if (tiles[i]) content.push({ type: 'image_url', image_url: { url: tiles[i] } })
    else content.push({ type: 'text', text: '(sin imagen satelital disponible)' })
  })

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: 'user', content }],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`OpenRouter respondió ${res.status}`)
  const data = await res.json()
  const raw: string = data?.choices?.[0]?.message?.content ?? ''

  // El modelo puede envolver el JSON en ```json ... ```
  const jsonText = raw.match(/\[[\s\S]*\]/)?.[0]
  if (!jsonText) throw new Error('La IA no devolvió un JSON interpretable')
  const parsed = JSON.parse(jsonText) as Array<{ rol?: string; score?: number; reasons?: string }>

  return parsed
    .filter((v) => typeof v.rol === 'string')
    .map((v) => ({
      rol: String(v.rol),
      score: Math.max(-1, Math.min(1, Number(v.score) || 0)),
      reasons: String(v.reasons ?? '').slice(0, 300),
    }))
}
