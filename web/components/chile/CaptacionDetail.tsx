'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  MapPin, Layers, ExternalLink, AlertCircle, CheckCircle2,
  RefreshCw, Phone, User, FileCheck2, Landmark, ShieldCheck, Copy,
  ChevronRight, Clock, ChevronLeft, Sparkles, Waves,
  Building, Compass, Calendar, Car, Archive, Home, Check, Plus,
  X, Search, FileText, Store, Images, Tag,
} from 'lucide-react'

import type { ParcelPick } from '@/components/map/ListingMatchMap'
import { PhoneRow, RelacionadosTable, useCopy } from '@/components/chile/DealerFicha'
// Misma lógica de parentesco que usa el envío al CRM: una sola definición.
import { duenoDeTelefono } from '@/lib/smartbc/relaciones.mjs'
import { DuenosRolPicker } from '@/components/chile/DuenosRolPicker'

const ListingMatchMap = dynamic(() => import('@/components/map/ListingMatchMap'), { ssr: false })

// ─────────────────────────────────────────────────────────────────────────────
// Panel de detalle de UNA captación — el trabajo manual real del pipeline
// (elegir el rol correcto entre candidatos, reintentar TGR, desambiguar el RUT
// en DealerNet, lanzar la verificación visual con IA).
//
// Vive acá y no dentro de /chile/captar-url porque ese flujo solo alcanza a la
// captación que acabas de crear pegando una URL: una vez persistida, la fila
// quedaba solo en la tabla de /chile/captacion sin ninguna forma de retomar el
// trabajo pendiente. Ambas páginas montan este mismo componente.
// ─────────────────────────────────────────────────────────────────────────────

export const DESTINO_LABELS: Record<string, string> = {
  H: 'Habitacional', C: 'Comercio', O: 'Oficina', I: 'Industria',
  W: 'Sitio Eriazo', Z: 'Estacionamiento',
}

export type StepState = 'pending' | 'running' | 'done' | 'review' | 'error'

/** Máximo de fotos que se envían al modelo de visión (espejo de MAX_VISUAL_PHOTOS del backend). */
export const MAX_IA_PHOTOS = 25

export interface VisualUsageInfo {
  photos_used: number
  prompt_tokens: number | null
  completion_tokens: number | null
  cost_usd: number | null
}

export interface Captacion {
  id: string
  source_url: string
  title: string | null
  operation: string | null
  property_type: string | null
  price_raw: number | null
  currency: string | null
  sqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  address: string | null
  comuna_label: string | null
  sii_comuna_code: string | null
  latitude: number | null
  longitude: number | null
  photos: string[] | null
  selected_photo_urls: string[] | null
  raw_extracted: Record<string, unknown> | null
  sii_rol: string | null
  sii_direccion: string | null
  match_score: number | null
  match_confidence: string | null
  match_verified: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candidates: any[] | null
  tgr_status: string
  owner_name: string | null
  tgr_direccion: string | null
  tgr_error: string | null
  dealernet_status: string
  owner_rut: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  owner_rut_candidates: any[] | null
  phones: Array<{
    numero: string; tipo?: string | null; whatsapp?: boolean | null; fuente?: string; calidad?: number | null
    categoria?: string; idimagen?: string | null; relacion?: string | null; ranking?: number | null
  }> | null
  emails: Array<{ email: string }> | null
  relacionados: Array<{ rut: number | null; dv: string | null; nombre: string | null; relacion: string | null }> | null
  // Selección manual de qué contactos viajan al CRM (migración 0092). NULL =
  // nadie ha elegido todavía y la sincronización automática decide sola.
  smartbc_contactos?: Array<{ phone: string; name?: string | null }> | null
  smartbc_contactos_at?: string | null
  dealernet_error: string | null
  stage: string
  needs_review: boolean
  review_reason: string | null
}

export function fmtCLP(n: number | null) {
  if (!n) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`
  return `$${n.toLocaleString('es-CL')}`
}

/** Etiquetas legibles del payload del parser (`raw_extracted`). Las claves que
 *  no estén acá se muestran tal cual: es preferible enseñar un campo nuevo con
 *  su nombre técnico a esconderlo. */
const FIELD_LABELS: Record<string, string> = {
  title: 'Título', operation: 'Operación', property_type: 'Tipo',
  price_raw: 'Precio', currency: 'Moneda', sqm: 'Superficie útil (m²)',
  sqm_terreno: 'Terreno (m²)', sqm_construida: 'Construida (m²)',
  bedrooms: 'Dormitorios', bathrooms: 'Baños', floors: 'Pisos',
  year_built: 'Año de construcción', orientation: 'Orientación',
  parking: 'Estacionamientos', storage: 'Bodegas', has_pool: 'Piscina',
  is_condo: 'Condominio', address: 'Dirección', address_full: 'Dirección completa',
  comuna_detected: 'Comuna detectada', comuna_label: 'Comuna', comuna_slug: 'Comuna (slug)',
  sii_code: 'Código comuna SII', lat: 'Latitud', lng: 'Longitud',
  advertiser_name: 'Anunciante', advertiser_type: 'Tipo de anunciante',
  photos_total_count: 'Fotos en el portal', photos_from_html: 'Fotos del HTML',
  photos_from_gallery: 'Fotos de la galería', gallery_error: 'Error de galería',
  fetch_error: 'Error de descarga', raw_slug: 'Slug de la URL',
}

/** Claves que ya tienen su propia sección en la ficha (o que son ruido). */
const HIDDEN_FIELDS = new Set(['photos', 'description'])

/** Campos numéricos que NO son cantidades: agruparlos por miles o redondear
 *  sus decimales los falsea (un año "1.985", una coordenada -33,405 en vez de
 *  -33.4045). Se muestran crudos. */
const VERBATIM_NUMBERS = /^(lat|lng|latitude|longitude|year_built|sii_code|.*_id)$/

function formatFieldValue(key: string, v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'number') {
    return VERBATIM_NUMBERS.test(key) || !Number.isInteger(v) ? String(v) : v.toLocaleString('es-CL')
  }
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(', ') : null
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function probColor(p: number | null | undefined): string {
  const pct = (p ?? 0) * 100
  if (pct >= 92) return 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400'
  if (pct >= 80) return 'bg-green-950/40 border-green-900/50 text-green-400'
  if (pct >= 65) return 'bg-amber-950/40 border-amber-900/50 text-amber-400'
  return 'bg-red-950/40 border-red-900/50 text-red-400'
}

export function Step({ n, label, state, detail }: { n: number; label: string; state: StepState; detail?: string | null }) {
  const icon = state === 'done' ? <CheckCircle2 size={14} className="text-emerald-400" />
    : state === 'running' ? <RefreshCw size={14} className="animate-spin text-blue-400" />
    : state === 'review' ? <AlertCircle size={14} className="text-amber-400" />
    : state === 'error' ? <AlertCircle size={14} className="text-red-400" />
    : <Clock size={14} className="text-slate-600" />
  const border = state === 'done' ? 'border-emerald-900/50' : state === 'running' ? 'border-blue-800/60'
    : state === 'review' ? 'border-amber-900/50' : state === 'error' ? 'border-red-900/50' : 'border-[var(--c-border-card)]'
  return (
    <div className={`flex-1 flex items-start gap-2.5 p-3 rounded-xl border bg-[var(--c-card)] ${border}`}>
      <div className="w-6 h-6 rounded-full bg-slate-900/60 border border-slate-700/50 flex items-center justify-center text-[10px] font-bold text-slate-400 flex-shrink-0">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-semibold text-slate-300">{label}</span>
        </div>
        {detail && <p className="text-[11px] text-slate-600 mt-1 leading-snug">{detail}</p>}
      </div>
    </div>
  )
}

function TechChip({ icon: Icon, label, highlight }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; highlight?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border ${
      highlight ? 'border-cyan-900/50 bg-cyan-950/20 text-cyan-300' : 'border-[var(--c-border-card)] bg-slate-900/30 text-slate-400'
    }`}>
      <Icon size={10} />
      {label}
    </span>
  )
}

/** Detección determinista de piscina en el tile satelital del candidato,
 *  en el navegador (canvas + umbral de color cian). Es el respaldo sin IA:
 *  señal orientativa, no entra al scoring. */
function PoolBadge({ lat, lng }: { lat: number | string | null; lng: number | string | null }) {
  const [pool, setPool] = useState<boolean | null>(null)
  useEffect(() => {
    if (lat == null || lng == null) return
    const zoom = 19
    const n = 2 ** zoom
    const x = Math.floor(((Number(lng) + 180) / 360) * n)
    const latRad = (Number(lat) * Math.PI) / 180
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const cv = document.createElement('canvas')
        cv.width = img.width
        cv.height = img.height
        const ctx = cv.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0)
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data
        let cyan = 0
        for (let i = 0; i < d.length; i += 16) {
          const r = d[i], g = d[i + 1], b = d[i + 2]
          if (b > 120 && g > 100 && b > r + 30 && g > r + 10) cyan++
        }
        setPool(cyan > 40)
      } catch {
        setPool(null) // canvas "tainted" si el CDN no manda CORS — sin señal
      }
    }
    img.onerror = () => setPool(null)
    img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`
  }, [lat, lng])
  if (!pool) return null
  return (
    <span className="text-[10px] text-cyan-300 bg-cyan-950/30 border border-cyan-900/40 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
      <Waves size={9} /> posible piscina (satélite)
    </span>
  )
}

interface Props {
  captacion: Captacion
  onChange: (c: Captacion) => void
  /** Encadena TGR (+DealerNet) automáticamente al montar si el rol ya está
   *  confirmado y aún no hay dueño. Solo lo usa /chile/captar-url, donde el
   *  usuario acaba de pedir explícitamente el pipeline completo — abrir una
   *  ficha desde la lista NO debe disparar consultas que cuestan tiempo/plata. */
  autoAdvance?: boolean
  /** Oculta el stepper (la página padre ya muestra el suyo). */
  hideStepper?: boolean
}

export default function CaptacionDetail({ captacion, onChange, autoAdvance = false, hideStepper = false }: Props) {
  const [tgrRunning, setTgrRunning] = useState(false)
  const [dnRunning, setDnRunning] = useState(false)
  // RUT que se está consultando desde la lista de dueños del rol.
  const [pidiendoRut, setPidiendoRut] = useState<string | null>(null)
  const [selectedRol, setSelectedRol] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const { copiedKey: copiedPhoneKey, copy: copyPhone } = useCopy()
  const [photoIdx, setPhotoIdx] = useState(0)
  const [visualRunning, setVisualRunning] = useState(false)
  const [visualError, setVisualError] = useState<string | null>(null)
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([])
  const [visualUsage, setVisualUsage] = useState<VisualUsageInfo | null>(null)
  // Parcela del catastro clicada en el mapa (puede no estar entre los candidatos).
  const [pickedParcel, setPickedParcel] = useState<ParcelPick | null>(null)
  const [rolInput, setRolInput] = useState('')
  const [applyingRol, setApplyingRol] = useState<string | null>(null)
  const [rolError, setRolError] = useState<string | null>(null)
  const [refetching, setRefetching] = useState(false)
  const [refetchMsg, setRefetchMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showDescription, setShowDescription] = useState(false)

  // Al cargar una captación nueva, restaurar la selección de fotos guardada en DB
  useEffect(() => {
    setSelectedPhotos(Array.isArray(captacion?.selected_photo_urls) ? captacion.selected_photo_urls : [])
    setVisualUsage(null)
    setPhotoIdx(0)
    setSelectedRol(null)
    setPickedParcel(null)
    setRolInput('')
    setRolError(null)
    setRefetchMsg(null)
    setShowDescription(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captacion?.id])

  const togglePhoto = (photoUrl: string) => {
    setSelectedPhotos((prev) => {
      if (prev.includes(photoUrl)) return prev.filter((p) => p !== photoUrl)
      if (prev.length >= MAX_IA_PHOTOS) return prev
      return [...prev, photoUrl]
    })
  }

  // ── Etapa 4 ───────────────────────────────────────────────────────────────
  const runDealernet = useCallback(async (id: string) => {
    setDnRunning(true)
    try {
      const res = await fetch(`/api/chile/captar/${id}/dealernet`, { method: 'POST' })
      const data = await res.json()
      if (data.captacion) onChange(data.captacion)
    } catch {
      // el estado queda registrado en la captación; reintentable
    } finally {
      setDnRunning(false)
    }
  }, [onChange])

  // ── Etapa 3 (encadena 4 si hay dueño) ─────────────────────────────────────
  const runTgr = useCallback(async (id: string) => {
    setTgrRunning(true)
    try {
      const res = await fetch(`/api/chile/captar/${id}/tgr`, { method: 'POST' })
      const data = await res.json()
      if (data.captacion) onChange(data.captacion)
      // Encadenar DealerNet solo si TGR entregó dueño y el match no cayó a revisión
      if (data.captacion?.owner_name && !data.captacion?.needs_review) {
        await runDealernet(id)
      }
    } catch {
      // reintentable desde el botón
    } finally {
      setTgrRunning(false)
    }
  }, [runDealernet, onChange])

  // Auto-encadenado tras extraer desde URL. El ref evita re-disparar la
  // consulta (Chromium + red) si el componente se re-monta con la misma ficha.
  const autoRanRef = useRef<string | null>(null)
  useEffect(() => {
    if (!autoAdvance) return
    if (autoRanRef.current === captacion.id) return
    if (captacion.sii_rol && !captacion.needs_review && !captacion.owner_name) {
      autoRanRef.current = captacion.id
      runTgr(captacion.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, captacion.id, captacion.sii_rol, captacion.needs_review, captacion.owner_name])

  /**
   * Fija el rol de la captación y encadena TGR. Sirve para las tres vías:
   * candidato de la lista, parcela clicada en el mapa (aunque no sea candidata)
   * y rol tecleado a mano. El error del backend ya no se traga en silencio —
   * antes, si el rol no pasaba la validación, no ocurría nada visible.
   */
  const applyRol = async (rol: string, siiComunaCode?: string | null) => {
    setSelectedRol(rol)
    setApplyingRol(rol)
    setRolError(null)
    try {
      const res = await fetch(`/api/chile/captar/${captacion.id}/select-rol`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rol, sii_comuna_code: siiComunaCode ?? undefined }),
      })
      const data = await res.json()
      if (data.success && data.captacion) {
        setPickedParcel(null)
        setRolInput('')
        onChange(data.captacion)
        await runTgr(data.captacion.id)
      } else {
        setRolError(data.error ?? 'No se pudo fijar el rol')
      }
    } catch {
      setRolError('Error de red al fijar el rol')
    } finally {
      setApplyingRol(null)
    }
  }

  const handleSelectRol = (rol: string) => applyRol(rol)

  /** Vuelve a extraer el anuncio para completar la ficha (fotos de la galería,
   *  descripción, ficha técnica) cuando la primera pasada quedó corta. */
  const refetchListing = async () => {
    setRefetching(true)
    setRefetchMsg(null)
    try {
      const res = await fetch(`/api/chile/captar/${captacion.id}/refetch`, { method: 'POST' })
      const data = await res.json()
      if (data.success && data.captacion) {
        onChange(data.captacion)
        const added = (data.photos_after ?? 0) - (data.photos_before ?? 0)
        setRefetchMsg(
          data.fetch_error
            ? { ok: false, text: `El portal no dejó recargar la ficha: ${data.fetch_error}` }
            : { ok: true, text: added > 0 ? `Ficha recargada · +${added} fotos` : 'Ficha recargada · sin fotos nuevas' },
        )
      } else {
        setRefetchMsg({ ok: false, text: data.error ?? 'No se pudo recargar la ficha' })
      }
    } catch {
      setRefetchMsg({ ok: false, text: 'Error de red al recargar la ficha' })
    } finally {
      setRefetching(false)
    }
  }

  const handleSelectRut = async (rut: string) => {
    setDnRunning(true)
    setPidiendoRut(rut)
    try {
      const res = await fetch(`/api/chile/captar/${captacion.id}/dealernet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut }),
      })
      const data = await res.json()
      if (data.captacion) onChange(data.captacion)
    } finally {
      setDnRunning(false)
      setPidiendoRut(null)
    }
  }

  const copyText = (text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }

  // ── Verificación visual con IA (fotos ↔ satélite) ─────────────────────────
  const runVisual = async () => {
    setVisualRunning(true)
    setVisualError(null)
    try {
      const res = await fetch(`/api/chile/captar/${captacion.id}/visual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrls: selectedPhotos }),
      })
      const data = await res.json()
      if (data.success && data.captacion) {
        onChange(data.captacion)
        if (data.visual_usage) setVisualUsage(data.visual_usage)
        // Si la verificación visual auto-confirmó el rol, continuar el pipeline
        if (data.captacion.sii_rol && !data.captacion.needs_review && !data.captacion.owner_name) {
          await runTgr(data.captacion.id)
        }
      } else {
        setVisualError(data.error ?? 'Error en la verificación visual')
      }
    } catch {
      setVisualError('Error de red')
    } finally {
      setVisualRunning(false)
    }
  }

  // ── Estados del stepper ────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = (captacion.raw_extracted ?? {}) as Record<string, any>
  const candidates = captacion.candidates ?? []
  const matchPct = captacion.match_score != null ? Math.round(Number(captacion.match_score) * 100) : null

  // Todo el payload del parser, listo para pintar (sin nulos ni duplicados de
  // secciones propias).
  const dataRows = Object.entries(ext)
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([k, v]) => [k, formatFieldValue(k, v)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] != null)

  // Fotos: cuántas tenemos vs. cuántas declara el portal. La diferencia es la
  // señal de que la galería quedó a medias y hay que recargar.
  const photoCount = captacion.photos?.length ?? 0
  const photosTotal = Number.isFinite(Number(ext.photos_total_count)) ? Number(ext.photos_total_count) : null
  const photosIncomplete = photosTotal != null && photosTotal > photoCount

  const s2: StepState = captacion.sii_rol ? 'done'
    : captacion.needs_review ? 'review'
    : captacion.match_confidence === 'none' ? 'error'
    : 'pending'
  const s3: StepState = tgrRunning ? 'running'
    : captacion.owner_name ? 'done'
    : captacion.tgr_status === 'cooldown' ? 'review'
    : captacion.tgr_status === 'error' ? 'error'
    : 'pending'
  const s4: StepState = dnRunning ? 'running'
    : captacion.dealernet_status === 'ok' ? 'done'
    : captacion.dealernet_status === 'ambiguous' ? 'review'
    : captacion.dealernet_status === 'error' || captacion.dealernet_status === 'not_found' ? 'error'
    : 'pending'

  const phones = captacion.phones ?? []
  const rutCandidates = captacion.owner_rut_candidates ?? []

  // ── Selección de contactos para el CRM ─────────────────────────────────────
  // DealerNet devuelve hasta 12 teléfonos y 23 relacionados. Volcarlos todos al
  // CRM le entrega a quien va a llamar una lista donde no distingue al dueño de
  // la cuñada del cónyuge. Aquí sí se distingue —está el parentesco y la
  // categoría delante—, así que la elección se hace aquí y se guarda: la
  // sincronización automática la respeta y no vuelve a meter los 12.
  // De qui\u00e9n es este tel\u00e9fono. DealerNet entrega las dos mitades por separado:
  // en el n\u00famero solo pone el parentesco y los nombres viven en la lista de
  // relacionados. Adem\u00e1s un mismo n\u00famero puede ser de varias personas
  // ("Conyuge, Hija, Suegra"); la primera es la m\u00e1s directa, as\u00ed que es la que
  // manda. Sin parentesco, el n\u00famero es del titular.
  const duenoDelTelefono = useCallback(
    (relacion: string | null | undefined) => duenoDeTelefono(relacion, {
      ownerName: captacion.owner_name,
      relacionados: captacion.relacionados ?? [],
    }),
    [captacion.owner_name, captacion.relacionados],
  )

  const [seleccion, setSeleccion] = useState<Record<string, { name: string }>>(() => {
    const guardada = captacion.smartbc_contactos
    if (Array.isArray(guardada) && guardada.length) {
      return Object.fromEntries(guardada.map((c) => [c.phone, { name: c.name ?? '' }]))
    }
    return {}
  })
  const [enviando, setEnviando] = useState(false)
  const [envio, setEnvio] = useState<{ ok: boolean; msg: string; url?: string | null } | null>(null)
  // Solo para fichas que ya se sincronizaron con el texto viejo (mencionaba
  // "DealerNet"/"casafari-mio" en notas y contacto): sobrescribe esos dos
  // campos aunque el equipo ya tenga algo escrito ahí en SmartBC. Apagado por
  // defecto — es la excepción, no la regla.
  const [forzarNotas, setForzarNotas] = useState(false)

  const toggleTelefono = useCallback((numero: string, relacion: string | null | undefined) => {
    setSeleccion((prev) => {
      if (prev[numero]) {
        const { [numero]: _quitado, ...resto } = prev
        return resto
      }
      return { ...prev, [numero]: { name: duenoDelTelefono(relacion).name } }
    })
  }, [duenoDelTelefono])

  const enviarASmart = useCallback(async () => {
    setEnviando(true)
    setEnvio(null)
    try {
      const contactos = phones
        .filter((p) => seleccion[p.numero])
        .map((p) => ({
          phone: p.numero,
          name: seleccion[p.numero].name || null,
          // La relación concreta de esa persona, no la cadena entera: al CRM
          // viaja "Conyuge", no "Conyuge, Hija, Suegra".
          relationship: duenoDelTelefono(p.relacion).relationship,
          has_whatsapp: p.whatsapp ?? null,
          label: p.tipo ?? p.categoria ?? null,
          // Sin parentesco, el número es del titular: así los clasifica DealerNet.
          is_owner: !p.relacion,
          rut: !p.relacion ? captacion.owner_rut ?? null : null,
        }))
      const res = await fetch('/api/chile/smartbc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: captacion.id,
          contactos,
          ...(forzarNotas ? { force_fields: ['notes', 'owner.contact'] } : {}),
        }),
      })
      const data = await res.json()
      if (data.success) {
        const accion = data.data.action === 'created' ? 'creada en el CRM' : 'actualizada en el CRM'
        // Si SmartBC igual protegió notes/owner.contact (p. ej. el equipo lo
        // marcó como no-forzable de su lado), que se note en vez de sonar a éxito total.
        const protegidos = forzarNotas
          ? (data.data.protected_fields ?? []).filter((f: string) => f === 'notes' || f === 'owner.contact')
          : []
        setEnvio({
          ok: true,
          msg: `${accion} · ${data.data.contactos_enviados} contacto(s) enviados`
            + (forzarNotas ? (protegidos.length ? ` · SmartBC protegió: ${protegidos.join(', ')}` : ' · notas y contacto forzados') : ''),
          url: data.data.admin_url,
        })
        if (forzarNotas) setForzarNotas(false)
      } else {
        // El motivo exacto importa: "arregla el dato" (validation_error) no es
        // lo mismo que "vuelve a intentarlo" (rate_limited, 503).
        const detalle = Array.isArray(data.details) && data.details.length
          ? ` (${data.details.map((d: { field: string; message: string }) => `${d.field}: ${d.message}`).join(' · ')})`
          : ''
        setEnvio({ ok: false, msg: `${data.error}${detalle}` })
      }
    } catch {
      setEnvio({ ok: false, msg: 'Error de red al enviar al CRM' })
    } finally {
      setEnviando(false)
    }
  }, [phones, seleccion, captacion.id, captacion.owner_rut, duenoDelTelefono, forzarNotas])

  const nSeleccionados = Object.keys(seleccion).length

  // Reanudar manualmente desde la lista: el rol ya está pero falta el dueño.
  const canRunTgr = Boolean(captacion.sii_rol) && !captacion.owner_name && !tgrRunning
  const canRunDealernet = Boolean(captacion.owner_name) && captacion.dealernet_status !== 'ok' && !dnRunning

  return (
    <div className="space-y-6">
      {!hideStepper && (
        <div className="flex gap-2 flex-wrap">
          <Step n={1} label="Extraer anuncio" state="done" detail={captacion.title ?? captacion.source_url} />
          <Step n={2} label="Rol + dirección exacta" state={s2}
            detail={captacion.sii_rol
              ? `${captacion.sii_rol} · ${matchPct}%${captacion.match_verified ? ' · verificado TGR' : ''}`
              : captacion.review_reason ?? null} />
          <Step n={3} label="Dueño (TGR)" state={s3}
            detail={captacion.owner_name ?? captacion.tgr_error ?? null} />
          <Step n={4} label="Teléfonos (DealerNet)" state={s4}
            detail={captacion.dealernet_status === 'ok' ? `${phones.length} teléfono${phones.length !== 1 ? 's' : ''}` : captacion.dealernet_error ?? null} />
        </div>
      )}

      {/* ── Acciones de pipeline pendientes ── */}
      {(canRunTgr || canRunDealernet) && (
        <div className="flex items-center gap-2 flex-wrap">
          {canRunTgr && (
            <button
              onClick={() => runTgr(captacion.id)}
              className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors"
            >
              <Landmark size={13} />
              {captacion.tgr_status === 'pending' ? 'Buscar dueño (TGR)' : 'Reintentar TGR'}
            </button>
          )}
          {canRunDealernet && (
            <button
              onClick={() => runDealernet(captacion.id)}
              className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors"
            >
              <Phone size={13} />
              {captacion.dealernet_status === 'pending' ? 'Buscar teléfonos (DealerNet)' : 'Reintentar DealerNet'}
            </button>
          )}
          {(tgrRunning || dnRunning) && (
            <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <RefreshCw size={11} className="animate-spin" /> Consultando…
            </span>
          )}
        </div>
      )}

      {/* ── Panel CONTACTAR (resultado final) ── */}
      {(captacion.owner_name || captacion.owner_rut) && (
        <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/10 p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck size={16} className="text-emerald-400" />
            <p className="text-sm font-semibold text-emerald-300">Dueño identificado{captacion.match_verified ? ' · dirección verificada con TGR' : ''}</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div>
              <p className="text-[10px] text-slate-600 mb-0.5">Nombre (certificado TGR)</p>
              <p className="text-sm font-semibold text-slate-100">{captacion.owner_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600 mb-0.5">RUT</p>
              <p className="text-sm font-mono text-slate-100 flex items-center gap-1.5">
                {captacion.owner_rut ?? '—'}
                {captacion.owner_rut && (
                  <button onClick={() => copyText(captacion.owner_rut!)} className="text-slate-600 hover:text-slate-300">
                    <Copy size={11} />
                  </button>
                )}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600 mb-0.5">Dirección exacta (SII)</p>
              <p className="text-sm text-slate-100">{captacion.sii_direccion ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600 mb-0.5">Rol · deuda contribuciones</p>
              <p className="text-sm text-slate-100 font-mono">
                {captacion.sii_rol}
                <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-sans font-semibold ${captacion.tgr_status === 'sin_deuda' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-amber-900/40 text-amber-300'}`}>
                  {captacion.tgr_status === 'sin_deuda' ? 'Sin deuda' : captacion.tgr_status === 'ok' ? 'Con deuda' : captacion.tgr_status}
                </span>
              </p>
            </div>
          </div>

          {phones.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                  Teléfonos <span className="text-slate-600">({phones.length})</span>
                </p>
                <button
                  onClick={() => copyPhone('all-phones', phones.map((p) => p.numero).join('\n'))}
                  className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded border border-[var(--c-border-strong)] hover:bg-[var(--c-hover)] transition-colors"
                >
                  {copiedPhoneKey === 'all-phones' ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                  Copiar todos
                </button>
              </div>
              <div className="space-y-1">
                {phones.map((p, i) => (
                  <PhoneRow
                    key={`${p.numero}-${i}`}
                    phone={{
                      phone_e164: p.numero,
                      categoria: p.categoria ?? 'alternativo',
                      clasificacion: p.tipo ?? null,
                      ind_whatsapp: p.whatsapp ?? null,
                      idimagen: p.idimagen ?? null,
                      relacion: p.relacion ?? null,
                    }}
                    copied={copiedPhoneKey === `phone-${i}`}
                    onCopy={() => copyPhone(`phone-${i}`, p.numero)}
                    selected={Boolean(seleccion[p.numero])}
                    onToggleSelect={() => toggleTelefono(p.numero, p.relacion)}
                    name={seleccion[p.numero]?.name}
                    onNameChange={(v) => setSeleccion((prev) => ({ ...prev, [p.numero]: { name: v } }))}
                  />
                ))}
              </div>

              {/* Envío al CRM. El botón manda la ficha completa —con dueño,
                  dirección real del SII, avisos de corredoras y fotos— y solo
                  los teléfonos marcados. La selección se guarda con el envío,
                  así que la sincronización automática posterior no vuelve a
                  meter los que se descartaron aquí. */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--c-border-strong)] mt-2">
                <button
                  onClick={enviarASmart}
                  disabled={enviando || nSeleccionados === 0}
                  title={nSeleccionados === 0
                    ? 'Marca al menos un teléfono para enviar'
                    : `Enviar la ficha al CRM con ${nSeleccionados} teléfono(s)`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {enviando ? 'Enviando…' : `Agregar a Smart (${nSeleccionados})`}
                </button>
                {captacion.smartbc_contactos_at && (
                  <span className="text-[10px] text-slate-500">
                    selección guardada {new Date(captacion.smartbc_contactos_at).toLocaleDateString('es-CL')}
                  </span>
                )}
                {/* Excepción explícita a "SmartBC solo escribe campos vacíos": para
                    fichas que ya se sincronizaron con el texto viejo (mencionaba
                    "DealerNet"/"casafari-mio"), esta casilla pisa notes y
                    owner.contact con el texto limpio actual. Apagada por defecto
                    y se apaga sola después de un envío exitoso. */}
                <label
                  className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer select-none"
                  title="Sobrescribe las notas y el campo de contacto en SmartBC con el texto actual, aunque ya haya algo escrito ahí. Úsalo solo para limpiar fichas viejas que aún mencionan DealerNet o casafari-mio."
                >
                  <input
                    type="checkbox"
                    checked={forzarNotas}
                    onChange={(e) => setForzarNotas(e.target.checked)}
                    className="accent-amber-500"
                  />
                  Forzar notas y contacto (sobrescribe lo ya escrito en SmartBC)
                </label>
                {envio && (
                  <span className={`text-[11px] ${envio.ok ? 'text-emerald-400' : 'text-rose-300'}`}>
                    {envio.ok ? '✓ ' : '✗ '}{envio.msg}
                    {envio.url && (
                      <a href={envio.url} target="_blank" rel="noopener noreferrer"
                        className="ml-1.5 underline hover:text-emerald-300">ver ficha</a>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}
          {captacion.dealernet_status === 'ok' && phones.length === 0 && (
            <p className="text-xs text-slate-500">DealerNet no devolvió teléfonos para este RUT.</p>
          )}
          {(captacion.relacionados?.length ?? 0) > 0 && (
            <div className="mt-3">
              <RelacionadosTable relacionados={captacion.relacionados!} />
            </div>
          )}
        </div>
      )}

      {/* ── Dueños del rol: elegir a quién consultar ──
          Se muestra siempre que haya candidatos, no solo cuando quedó
          ambiguo: aunque el actual ya esté resuelto, el equipo puede querer
          los teléfonos de un histórico o de la persona detrás de la sociedad
          dueña. Cada consulta se paga, así que ninguna sale sin un clic. */}
      {rutCandidates.length > 0 && (
        <div className={`rounded-xl border p-4 ${captacion.dealernet_status === 'ambiguous'
          ? 'border-amber-900/50 bg-amber-950/10' : 'border-[var(--c-border-card)] bg-[var(--c-card)]'}`}>
          {captacion.dealernet_status === 'ambiguous' && (
            <p className="text-xs font-semibold text-amber-300 mb-3 flex items-center gap-1.5">
              <AlertCircle size={13} /> {captacion.review_reason ?? 'Varios RUT candidatos en DealerNet: elegir manualmente'}
            </p>
          )}
          <DuenosRolPicker
            candidatos={rutCandidates}
            ownerRut={captacion.owner_rut}
            busyRut={dnRunning ? (pidiendoRut ?? '') : null}
            onPedirTelefonos={handleSelectRut}
          />
        </div>
      )}

      {/* ── TGR en cooldown / error ── */}
      {captacion.sii_rol && !captacion.owner_name && !tgrRunning && (captacion.tgr_status === 'cooldown' || captacion.tgr_status === 'error') && (
        <div className="flex items-center gap-2 p-4 rounded-xl border border-amber-900/40 bg-amber-950/10">
          <p className="text-xs text-amber-300 flex items-center gap-1.5">
            <Landmark size={13} /> {captacion.tgr_error ?? 'Consulta TGR pendiente'}
          </p>
        </div>
      )}

      {/* ── Ficha del anuncio ── */}
      <div className="rounded-2xl overflow-hidden ring-1 ring-white/5 bg-[var(--c-card)]">
        <div className="relative h-[480px] bg-[var(--c-card)] overflow-hidden">
          {captacion.latitude && captacion.longitude ? (
            <ListingMatchMap
              listingLat={Number(captacion.latitude)}
              listingLng={Number(captacion.longitude)}
              candidates={candidates}
              selectedRol={selectedRol ?? captacion.sii_rol}
              onSelectCandidate={(rol: string) => setSelectedRol(rol)}
              comunaCode={captacion.sii_comuna_code}
              onSelectParcel={(p) => { setPickedParcel(p); setRolError(null) }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-700 text-sm bg-gradient-to-br from-slate-900 to-slate-800">
              Sin coordenadas — no se pudo ubicar el anuncio en el mapa
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none" />
          <a
            href={captacion.source_url}
            target="_blank" rel="noopener noreferrer"
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white/70 flex items-center justify-center hover:bg-black/70 hover:text-white transition-all"
          >
            <ExternalLink size={14} />
          </a>
          <div className="absolute bottom-3 left-4">
            <div className="text-white font-bold text-lg leading-none">
              {captacion.price_raw ? Number(captacion.price_raw).toLocaleString('es-CL') : '—'} {captacion.currency ?? ''}
            </div>
          </div>
          {captacion.operation && (
            <div className="absolute bottom-3 right-4">
              <span className={`text-[11px] font-semibold px-2 py-1 rounded ${captacion.operation === 'rent' ? 'bg-violet-600/80 text-white' : 'bg-blue-600/80 text-white'}`}>
                {captacion.operation === 'rent' ? 'ARRIENDO' : 'VENTA'}
              </span>
            </div>
          )}
        </div>

        {/* Parcela elegida en el mapa — la salida cuando la recomendación
            automática está equivocada: el rol no tiene por qué estar entre los
            candidatos scoreados. */}
        {pickedParcel && (
          <div className="px-4 pt-3">
            <div className={`flex items-center gap-3 flex-wrap p-3 rounded-xl border ${
              pickedParcel.rol === captacion.sii_rol
                ? 'border-emerald-800/60 bg-emerald-950/20'
                : 'border-cyan-800/60 bg-cyan-950/20'
            }`}>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-200 flex items-center gap-1.5 flex-wrap">
                  <Layers size={12} className="text-cyan-400 flex-shrink-0" />
                  <span className="font-mono text-cyan-300">{pickedParcel.rol}</span>
                  {pickedParcel.comuna_name && <span className="text-slate-500">· {pickedParcel.comuna_name}</span>}
                  {pickedParcel.is_candidate
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-400">candidato #{candidates.findIndex((c) => c.rol === pickedParcel.rol) + 1}</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">fuera de los candidatos</span>}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {pickedParcel.superficie_terreno_m2 != null && `Terreno ${Number(pickedParcel.superficie_terreno_m2).toLocaleString('es-CL')} m²`}
                  {pickedParcel.avaluo_fiscal_total != null && ` · Avalúo ${fmtCLP(Number(pickedParcel.avaluo_fiscal_total))}`}
                </p>
              </div>
              {pickedParcel.rol === captacion.sii_rol ? (
                <span className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> Ya es el rol de esta captación
                </span>
              ) : (
                <button
                  onClick={() => applyRol(pickedParcel.rol, pickedParcel.sii_comuna_code)}
                  disabled={applyingRol != null}
                  className="flex items-center gap-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                >
                  {applyingRol === pickedParcel.rol ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                  Usar este rol
                </button>
              )}
              <button
                onClick={() => setPickedParcel(null)}
                className="text-slate-500 hover:text-slate-300 flex-shrink-0"
                title="Descartar"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="px-4 py-4 space-y-3">
          {captacion.comuna_label && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-950/30 border border-emerald-900/50 rounded-lg w-fit">
              <MapPin size={11} className="text-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">{captacion.comuna_label}</span>
            </div>
          )}
          <h2 className="text-slate-200 text-base font-semibold leading-snug line-clamp-2">
            {captacion.title || `Propiedad en ${captacion.comuna_label ?? 'Chile'}`}
          </h2>
          <p className="text-slate-500 text-xs">
            {captacion.sqm && `${captacion.sqm} m²`}
            {captacion.bedrooms != null && ` · ${captacion.bedrooms} dorm.`}
            {captacion.bathrooms != null && ` · ${captacion.bathrooms} baño${captacion.bathrooms !== 1 ? 's' : ''}`}
            {captacion.property_type && ` · ${captacion.property_type}`}
          </p>
          {captacion.address && (
            <p className="text-slate-400 text-xs flex items-center gap-2">
              <MapPin size={12} className="text-slate-600 flex-shrink-0" />
              <span className="truncate">{captacion.address}</span>
            </p>
          )}
          {ext.fetch_error && (
            <p className="text-[11px] text-slate-700 flex items-center gap-1.5">
              <AlertCircle size={11} className="text-amber-700" />
              No se pudo cargar la página del anuncio ({String(ext.fetch_error)}) — datos derivados de la URL.
            </p>
          )}

          {/* Ficha técnica V4 */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {ext.sqm_terreno != null && <TechChip icon={MapPin} label={`Terreno ${Number(ext.sqm_terreno).toLocaleString('es-CL')} m²`} />}
            {ext.sqm_construida != null && <TechChip icon={Home} label={`Construida ${Number(ext.sqm_construida).toLocaleString('es-CL')} m²`} />}
            {ext.floors != null && <TechChip icon={Building} label={`${ext.floors} piso${Number(ext.floors) !== 1 ? 's' : ''}`} />}
            {ext.year_built != null && <TechChip icon={Calendar} label={`Construcción ~${ext.year_built}`} />}
            {ext.orientation && <TechChip icon={Compass} label={`Orientación ${String(ext.orientation)}`} />}
            {ext.parking != null && <TechChip icon={Car} label={`${ext.parking} estac.`} />}
            {ext.storage != null && <TechChip icon={Archive} label={`${ext.storage} bodega${Number(ext.storage) !== 1 ? 's' : ''}`} />}
            {ext.has_pool === true && <TechChip icon={Waves} label="Piscina" highlight />}
            {ext.is_condo === true && <TechChip icon={Building} label="Condominio" />}
          </div>

          {/* Quién publica — antes solo vivía en raw_extracted */}
          {(ext.advertiser_name || ext.advertiser_type) && (
            <p className="text-xs text-slate-400 flex items-center gap-2 pt-1">
              <Store size={12} className="text-slate-600 flex-shrink-0" />
              <span className="truncate">{String(ext.advertiser_name ?? 'Anunciante')}</span>
              {ext.advertiser_type && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  ext.advertiser_type === 'particular' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-slate-800/70 text-slate-400'
                }`}>
                  {ext.advertiser_type === 'particular' ? 'Particular' : ext.advertiser_type === 'professional' ? 'Corredora' : String(ext.advertiser_type)}
                </span>
              )}
            </p>
          )}

          {/* Descripción completa del anuncio */}
          {typeof ext.description === 'string' && ext.description.trim().length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowDescription((v) => !v)}
                className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1.5"
              >
                <FileText size={11} />
                {showDescription ? 'Ocultar descripción' : 'Ver descripción del anuncio'}
                <ChevronRight size={11} className={`transition-transform ${showDescription ? 'rotate-90' : ''}`} />
              </button>
              {showDescription && (
                <p className="mt-2 text-xs text-slate-400 leading-relaxed whitespace-pre-line max-h-64 overflow-y-auto pr-1">
                  {String(ext.description)}
                </p>
              )}
            </div>
          )}

          {/* Todos los datos extraídos, sin recortar: la ficha es la fuente de
              verdad del anuncio y hasta ahora escondía la mitad del payload. */}
          {dataRows.length > 0 && (
            <details className="pt-1 group">
              <summary className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer list-none flex items-center gap-1.5">
                <Tag size={11} />
                Ver todos los datos extraídos ({dataRows.length})
                <ChevronRight size={11} className="transition-transform group-open:rotate-90" />
              </summary>
              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {dataRows.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 py-1 border-b border-[var(--c-border)]">
                    <dt className="text-[10px] text-slate-600 flex-shrink-0">{FIELD_LABELS[k] ?? k}</dt>
                    <dd className="text-[11px] text-slate-300 text-right break-words min-w-0">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      </div>

      {/* ── Estado de la extracción: fotos que faltan y recarga de la ficha ──
          La primera pasada puede quedarse con las 5 fotos del HTML estático si
          el portal bloquea el modal de galería; sin este aviso la ficha decía
          "Fotos del anuncio (5)" de una publicación con 20 y no había forma de
          reintentarlo. */}
      <div className={`flex items-center gap-3 flex-wrap p-3 rounded-xl border ${
        photosIncomplete || ext.gallery_error || ext.fetch_error
          ? 'border-amber-900/50 bg-amber-950/10'
          : 'border-[var(--c-border-card)] bg-[var(--c-card)]'
      }`}>
        <Images size={13} className={photosIncomplete ? 'text-amber-400' : 'text-slate-500'} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-300">
            {photosTotal != null
              ? `${photoCount} de ${photosTotal} fotos publicadas en el portal`
              : `${photoCount} foto${photoCount !== 1 ? 's' : ''} extraída${photoCount !== 1 ? 's' : ''}`}
          </p>
          {(photosIncomplete || ext.gallery_error) && (
            <p className="text-[11px] text-amber-400/90 mt-0.5">
              {String(ext.gallery_error ?? 'Faltan fotos de la galería del anuncio')} — recarga la ficha para completarla.
            </p>
          )}
          {refetchMsg && (
            <p className={`text-[11px] mt-0.5 ${refetchMsg.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{refetchMsg.text}</p>
          )}
        </div>
        <button
          onClick={refetchListing}
          disabled={refetching}
          title="Vuelve a leer el anuncio en el portal: fotos, descripción y ficha técnica. No toca el rol ni las etapas TGR/DealerNet."
          className="flex items-center gap-1.5 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <RefreshCw size={11} className={refetching ? 'animate-spin' : ''} />
          {refetching ? 'Recargando…' : 'Recargar ficha del anuncio'}
        </button>
      </div>

      {/* ── Galería de fotos del anuncio + selector para IA ── */}
      {(captacion.photos?.length ?? 0) > 0 && (() => {
        const currentPhoto = captacion.photos![Math.min(photoIdx, captacion.photos!.length - 1)]
        const currentSelected = selectedPhotos.includes(currentPhoto)
        return (
        <div>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold">
              Fotos del anuncio ({captacion.photos!.length}{photosTotal != null ? ` de ${photosTotal}` : ''}) — marca las que mejor identifican la propiedad desde el aire
            </p>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] px-2 py-1 rounded-lg border ${
                selectedPhotos.length > 0
                  ? 'border-violet-800/60 bg-violet-950/30 text-violet-300'
                  : 'border-[var(--c-border-card)] bg-slate-900/30 text-slate-500'
              }`}>
                {selectedPhotos.length > 0
                  ? `${selectedPhotos.length}/${MAX_IA_PHOTOS} para IA`
                  : 'sin selección → IA usa las 4 primeras'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedPhotos(captacion.photos!.slice(0, MAX_IA_PHOTOS))}
                className="text-[11px] text-slate-400 hover:text-slate-200 border border-[var(--c-border-card)] hover:border-slate-600 px-2 py-1 rounded-lg transition-colors"
              >
                Primeras {Math.min(MAX_IA_PHOTOS, captacion.photos!.length)}
              </button>
              <button
                type="button"
                onClick={() => setSelectedPhotos([])}
                disabled={selectedPhotos.length === 0}
                className="text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40 border border-[var(--c-border-card)] hover:border-slate-600 px-2 py-1 rounded-lg transition-colors"
              >
                Ninguna
              </button>
            </div>
          </div>
          <div className="rounded-2xl overflow-hidden ring-1 ring-white/5 bg-black relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentPhoto}
              alt={`Foto ${photoIdx + 1}`}
              className="w-full h-80 object-contain bg-black"
            />
            <button
              type="button"
              onClick={() => togglePhoto(currentPhoto)}
              className={`absolute top-3 left-3 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg backdrop-blur-sm transition-colors ${
                currentSelected
                  ? 'bg-violet-600/90 text-white hover:bg-violet-500'
                  : 'bg-black/50 text-white/80 hover:bg-black/70 hover:text-white'
              }`}
            >
              {currentSelected ? <Check size={12} /> : <Plus size={12} />}
              {currentSelected ? 'Incluida en análisis IA' : 'Incluir en análisis IA'}
            </button>
            {captacion.photos!.length > 1 && (
              <>
                <button
                  onClick={() => setPhotoIdx((p) => (p - 1 + captacion.photos!.length) % captacion.photos!.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white/80 hover:bg-black/80 flex items-center justify-center"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPhotoIdx((p) => (p + 1) % captacion.photos!.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white/80 hover:bg-black/80 flex items-center justify-center"
                >
                  <ChevronRight size={16} />
                </button>
                <span className="absolute bottom-2 right-3 text-[10px] text-white/70 bg-black/50 px-1.5 py-0.5 rounded">
                  {photoIdx + 1}/{captacion.photos!.length}
                </span>
              </>
            )}
          </div>
          {captacion.photos!.length > 1 && (
            <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
              {captacion.photos!.map((p, i) => {
                const isSel = selectedPhotos.includes(p)
                return (
                  <div key={p} className="relative flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p}
                      alt=""
                      onClick={() => setPhotoIdx(i)}
                      className={`h-14 w-20 object-cover rounded-lg cursor-pointer border-2 transition-all ${
                        i === photoIdx ? 'border-blue-500'
                        : isSel ? 'border-violet-500 opacity-90'
                        : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); togglePhoto(p) }}
                      title={isSel ? 'Quitar del análisis IA' : 'Incluir en análisis IA'}
                      className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                        isSel
                          ? 'bg-violet-600 text-white hover:bg-violet-500'
                          : 'bg-black/60 text-white/70 hover:bg-black/80 hover:text-white'
                      }`}
                    >
                      {isSel ? <Check size={11} /> : <Plus size={11} />}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )
      })()}

      {/* ── Candidatos SII ── */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3">
          <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold flex items-center gap-2">
            <FileCheck2 size={12} />
            {captacion.sii_rol && !captacion.needs_review
              ? 'Rol confirmado'
              : `Roles SII candidatos ${candidates.length > 0 ? `(${candidates.length})` : ''}`}
          </p>
          <div className="flex items-center gap-2">
            {captacion.needs_review && captacion.review_reason && (
              <span className="text-[11px] text-amber-400">{captacion.review_reason}</span>
            )}
            {candidates.length > 0 && (
              <button
                onClick={runVisual}
                disabled={visualRunning}
                className="flex items-center gap-1.5 text-[11px] font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0"
                title="Compara las fotos del anuncio con el satélite de cada candidato (piscina, techo, entorno) usando IA. Marca fotos en la galería para elegir cuáles se envían."
              >
                {visualRunning ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {visualRunning
                  ? 'Comparando fotos ↔ satélite…'
                  : `${captacion.sii_rol ? 'Re-verificar' : 'Verificación visual'} IA (${selectedPhotos.length > 0 ? `${selectedPhotos.length} fotos` : '4 fotos auto'})`}
              </button>
            )}
          </div>
        </div>
        {visualError && (
          <p className="text-[11px] text-red-400 mb-2 flex items-center gap-1.5"><AlertCircle size={11} /> {visualError}</p>
        )}
        {rolError && (
          <p className="text-[11px] text-red-400 mb-2 flex items-center gap-1.5"><AlertCircle size={11} /> {rolError}</p>
        )}

        {/* Rol fuera de la lista: cuando la recomendación automática está mal
            (el rol correcto ni siquiera aparece entre los candidatos), se fija
            a mano — señalando la parcela en el mapa o tecleando el rol. */}
        {captacion.sii_comuna_code && (
          <form
            onSubmit={(e) => { e.preventDefault(); const r = rolInput.trim(); if (r) applyRol(r) }}
            className="flex items-center gap-2 mb-3 flex-wrap"
          >
            <div className="relative flex-1 min-w-[200px]">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                value={rolInput}
                onChange={(e) => setRolInput(e.target.value)}
                placeholder="¿Ninguno es el correcto? Escribe el rol (ej. 2922-31) o haz clic en su parcela en el mapa"
                className="w-full text-xs bg-[var(--c-card)] border border-[var(--c-border-card)] focus:border-cyan-700 outline-none rounded-lg pl-7 pr-2.5 py-2 text-slate-200 placeholder:text-slate-600"
              />
            </div>
            <button
              type="submit"
              disabled={!rolInput.trim() || applyingRol != null}
              className="flex items-center gap-1.5 text-[11px] font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white px-2.5 py-2 rounded-lg transition-colors"
            >
              {applyingRol === rolInput.trim() ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}
              Fijar este rol
            </button>
          </form>
        )}
        {visualUsage && !visualError && (
          <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-1.5">
            <Sparkles size={11} className="text-violet-400" />
            Último análisis: {visualUsage.photos_used} foto{visualUsage.photos_used !== 1 ? 's' : ''} del anuncio
            {visualUsage.prompt_tokens != null && ` · ${(visualUsage.prompt_tokens + (visualUsage.completion_tokens ?? 0)).toLocaleString('es-CL')} tokens`}
            {visualUsage.cost_usd != null && ` · $${visualUsage.cost_usd.toFixed(4)} USD`}
          </p>
        )}

        {!captacion.sii_comuna_code ? (
          <div className="p-4 rounded-xl border border-amber-900/40 bg-amber-950/20 text-amber-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} />
            No se detectó una comuna con datos SII disponibles.
          </div>
        ) : candidates.length === 0 ? (
          <div className="p-4 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] text-slate-600 text-sm">
            Sin coincidencias en el catastro SII para {captacion.comuna_label}.
          </div>
        ) : (
          <div className="space-y-2">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {candidates.map((rol: any, i: number) => {
              const pct = Math.round((rol.match_score ?? 0) * 100)
              const isChosen = captacion.sii_rol === rol.rol
              const isSelected = (selectedRol ?? captacion.sii_rol) === rol.rol
              const explanation = rol.match_result_v3?.explanation
              return (
                <button
                  key={rol.rol}
                  type="button"
                  onClick={() => handleSelectRol(rol.rol)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors group ${
                    isChosen ? 'border-emerald-700 bg-emerald-950/20'
                    : isSelected ? 'border-blue-600 bg-blue-950/30'
                    : 'border-[var(--c-border-card)] bg-[var(--c-card)] hover:border-blue-700/50 hover:bg-blue-950/20'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-blue-950 border border-blue-800/50 flex items-center justify-center text-[10px] font-bold text-blue-400 flex-shrink-0">
                    {isChosen ? <CheckCircle2 size={12} className="text-emerald-400" /> : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-sm text-blue-400">{rol.rol}</span>
                      {rol.rol_padre && <Layers size={11} className="text-purple-400" aria-label="Unidad de edificio" />}
                      {rol.codigo_destino_principal && (
                        <span className="text-[10px] text-slate-600">
                          {DESTINO_LABELS[rol.codigo_destino_principal] ?? rol.codigo_destino_principal}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate">{rol.direccion ?? '—'}</p>
                    {explanation && (
                      <p className="text-[10px] text-slate-600 mt-1 truncate">{explanation}</p>
                    )}
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      {rol.superficie_terreno_m2 && (
                        <span className="text-[10px] text-slate-500 bg-slate-900/30 px-1.5 py-0.5 rounded">
                          Terreno: {rol.superficie_terreno_m2}m²
                        </span>
                      )}
                      {rol.superficie_construida_m2 && (
                        <span className="text-[10px] text-slate-500 bg-slate-900/30 px-1.5 py-0.5 rounded">
                          Construida: {rol.superficie_construida_m2}m²
                        </span>
                      )}
                      {rol.numero_pisos != null && (
                        <span className="text-[10px] text-slate-500 bg-slate-900/30 px-1.5 py-0.5 rounded">
                          {rol.numero_pisos} piso{rol.numero_pisos !== 1 ? 's' : ''}
                        </span>
                      )}
                      {rol.anio_construccion != null && (
                        <span className="text-[10px] text-slate-500 bg-slate-900/30 px-1.5 py-0.5 rounded">
                          Año {rol.anio_construccion}
                        </span>
                      )}
                      {rol.distance_m != null && (
                        <span className="text-[10px] text-slate-500 bg-slate-900/30 px-1.5 py-0.5 rounded">
                          {Math.round(rol.distance_m)} m del pin
                        </span>
                      )}
                      <PoolBadge lat={rol.lat} lng={rol.lng} />
                    </div>
                    {rol.visual_reasons && (
                      <p className={`text-[10px] mt-1.5 flex items-start gap-1 ${Number(rol.visual_score) > 0.3 ? 'text-emerald-400' : Number(rol.visual_score) < -0.3 ? 'text-red-400' : 'text-slate-500'}`}>
                        <Sparkles size={9} className="mt-0.5 flex-shrink-0" />
                        <span>IA visual: {rol.visual_reasons}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <div className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${probColor(rol.match_score)}`}>
                      {pct}%
                    </div>
                    <p className="text-sm font-semibold text-slate-200">{fmtCLP(rol.avaluo_fiscal_total)}</p>
                  </div>
                </button>
              )
            })}
            <p className="text-[11px] text-slate-600 flex items-center gap-1.5 px-1">
              <User size={11} />
              {captacion.needs_review
                ? 'Haz clic en el candidato correcto para confirmarlo manualmente y continuar con TGR + DealerNet. Si el correcto no está en la lista, señala su parcela en el mapa o escribe su rol arriba.'
                : 'Rol confirmado automáticamente. Si no es el correcto, elige otro candidato, señala la parcela en el mapa o escribe su rol arriba.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
