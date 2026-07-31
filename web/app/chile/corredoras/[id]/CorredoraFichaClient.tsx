'use client'

import PropertyModal, { type Property } from '@/components/chile/PropertyClModal'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Globe, Phone, ExternalLink, Package, History, Timer, ShieldCheck, GitCompareArrows, ImageOff, Mail, MapPin, MessageCircle, Users, Copy, Check } from 'lucide-react'

type InventoryItem = {
  property_cl_id: string
  operation: string | null
  property_type: string | null
  canonical_price: number | null
  square_meters: number | null
  bedrooms: number | null
  bathrooms: number | null
  location_confidence: string
  comuna_name: string | null
  shared_corredora_count: number
  shared: boolean
  own_price: number | null
  own_external_id: string | null
  own_source_url: string | null
  own_is_active: boolean
  seller_reference: string | null
  own_cover_photo: string | null
}

// Persona publicada por la corredora en su propia web (migración 0088).
type Persona = {
  full_name: string
  role_raw: string | null
  role_kind: 'jefatura' | 'ejecutivo' | 'desconocido'
  email: string | null
  phone: string | null
  source_url: string | null
  last_seen_at: string | null
}

type Ficha = {
  id: string
  advertiser_id: string | null
  name: string | null
  logo_url: string | null
  phones: string[] | null
  // Ficha de empresa: sale de la web propia, no del portal (el portal no
  // publica teléfonos). `contact_status` explica por qué falta cuando falta.
  contact_phones: string[] | null
  contact_whatsapp: string[] | null
  contact_emails: string[] | null
  contact_address: string | null
  contact_socials: Record<string, string> | null
  contact_source_urls: string[] | null
  contact_status: 'pending' | 'ok' | 'empty' | 'no_web' | 'error' | null
  contact_updated_at: string | null
  personas: Persona[] | null
  web_propia_url: string | null
  crm_platform: string
  active_listings_count: number
  total_listings_seen: number
  comunas_operated: string[] | null
  avg_days_on_market: number | null
  exclusivity_ratio: number | null
  inventory: InventoryItem[]
  inventory_count: number
  active_count: number
  shared_count: number
  // Una corredora opera con VARIAS cuentas de vendedor en el portal (Property
  // Partners tiene 3): la ficha las agrupa siempre.
  advertiser_ids: string[] | null
  accounts: number
}

const CRM_LABELS: Record<string, string> = { convecta: 'Convecta', ofinet: 'Ofinet', other: 'Otro CRM', unknown: 'Sin detectar' }
const CRM_COLORS: Record<string, string> = {
  convecta: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  ofinet: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  other: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  unknown: 'bg-slate-700/40 text-slate-500 border-slate-700/40',
}

function clp(v: number | null): string {
  return v == null ? '—' : v.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}
function pct(v: number | null): string { return v == null ? '—' : `${Math.round(v * 100)}%` }
function days(v: number | null): string { return v == null ? '—' : `${Math.round(v)} días` }

const AVATAR_COLORS = ['bg-purple-600', 'bg-cyan-600', 'bg-amber-600', 'bg-emerald-600', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600']
function initials(name: string | null): string {
  if (!name) return '?'
  const p = name.trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}
function avatarColor(name: string | null): string {
  const s = name ?? ''; let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/** Logo del portal si existe (y carga bien); si no, avatar de iniciales. */
function Avatar({ name, logoUrl, size = 56 }: { name: string | null; logoUrl: string | null; size?: number }) {
  const [errored, setErrored] = useState(false)
  if (logoUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name ?? 'Corredora'}
        onError={() => setErrored(true)}
        style={{ width: size, height: size }}
        className="rounded-2xl object-cover shrink-0 bg-slate-700 border border-slate-600"
      />
    )
  }
  return (
    <div style={{ width: size, height: size }} className={`rounded-2xl ${avatarColor(name)} flex items-center justify-center font-bold text-white shrink-0`}>
      <span style={{ fontSize: size * 0.35 }}>{initials(name)}</span>
    </div>
  )
}

// Miniatura de portada del anuncio (fallback si no hay foto o falla la carga).
function InvThumb({ src }: { src: string | null }) {
  const [err, setErr] = useState(false)
  if (!src || err) {
    return <div className="w-full h-full flex items-center justify-center text-slate-600"><ImageOff size={24} /></div>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onError={() => setErr(true)} loading="lazy" className="w-full h-full object-cover" />
}

/** Teléfono en E.164 → "+56 9 9537 7271" (como se lee en Chile). */
function fmtPhone(e164: string): string {
  const m = e164.match(/^\+56(9)(\d{4})(\d{4})$/)
  if (m) return `+56 ${m[1]} ${m[2]} ${m[3]}`
  const f = e164.match(/^\+56(\d{1,2})(\d{4})(\d{4})$/)
  return f ? `+56 ${f[1]} ${f[2]} ${f[3]}` : e164
}

/** Botón de copiar al portapapeles: en captación se copia el número, no se teclea. */
function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200) }}
      title="Copiar"
      className="text-slate-600 hover:text-slate-300 shrink-0"
    >
      {done ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  )
}

const CONTACT_EMPTY_MSG: Record<string, string> = {
  no_web: 'Sin web propia registrada. El portal no publica teléfonos, así que no hay de dónde sacarlo: registra su dominio para poder enriquecerla.',
  empty: 'Su web no publica teléfono ni email de contacto.',
  error: 'La última lectura de su web falló. Se reintenta en la próxima pasada.',
  pending: 'Todavía sin enriquecer.',
}

const ROLE_STYLE: Record<Persona['role_kind'], string> = {
  jefatura: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  ejecutivo: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  desconocido: 'bg-slate-700/40 text-slate-400 border-slate-700',
}

/**
 * Ficha de empresa: cómo contactar a la corredora y a quién. Todo viene de lo
 * que ella misma publica en su web (ver docs/CONTACTO-CORREDORAS-CL.md); por eso
 * cada bloque enlaza a la URL de origen y se muestra la fecha de la lectura.
 */
function ContactoCard({ ficha }: { ficha: Ficha }) {
  const phones = ficha.contact_phones ?? []
  const whatsapp = new Set(ficha.contact_whatsapp ?? [])
  const emails = ficha.contact_emails ?? []
  const personas = ficha.personas ?? []
  const socials = Object.entries(ficha.contact_socials ?? {})
  const status = ficha.contact_status ?? 'pending'
  const hasContacto = phones.length > 0 || emails.length > 0 || !!ficha.contact_address || socials.length > 0

  if (!hasContacto && personas.length === 0) {
    return (
      <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl px-4 py-3 mb-6 text-xs text-slate-500">
        <span className="text-slate-400 font-medium">Ficha de empresa · </span>
        {CONTACT_EMPTY_MSG[status] ?? CONTACT_EMPTY_MSG.pending}
      </div>
    )
  }

  const jefaturas = personas.filter(p => p.role_kind === 'jefatura')
  const resto = personas.filter(p => p.role_kind !== 'jefatura')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
      {/* Contacto de la empresa */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3">
        <h3 className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Contacto</h3>
        <div className="space-y-1.5">
          {phones.map(p => (
            <div key={p} className="flex items-center gap-2 text-sm">
              {whatsapp.has(p)
                ? <MessageCircle size={13} className="text-emerald-400 shrink-0" />
                : <Phone size={13} className="text-slate-500 shrink-0" />}
              <a href={`tel:${p}`} className="text-slate-200 hover:text-amber-400">{fmtPhone(p)}</a>
              {whatsapp.has(p) && (
                <a href={`https://wa.me/${p.replace('+', '')}`} target="_blank" rel="noopener noreferrer"
                   className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  WhatsApp
                </a>
              )}
              <CopyBtn value={p} />
            </div>
          ))}
          {emails.map(e => (
            <div key={e} className="flex items-center gap-2 text-sm min-w-0">
              <Mail size={13} className="text-slate-500 shrink-0" />
              <a href={`mailto:${e}`} className="text-slate-200 hover:text-amber-400 truncate">{e}</a>
              <CopyBtn value={e} />
            </div>
          ))}
          {ficha.contact_address && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin size={13} className="text-slate-500 shrink-0 mt-0.5" />
              <span className="text-slate-300">{ficha.contact_address}</span>
            </div>
          )}
          {socials.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {socials.map(([net, url]) => (
                <a key={net} href={url} target="_blank" rel="noopener noreferrer"
                   className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/50 border border-slate-600 text-slate-300 hover:text-amber-400 capitalize">
                  {net}
                </a>
              ))}
            </div>
          )}
          {!hasContacto && (
            <div className="text-xs text-slate-500">{CONTACT_EMPTY_MSG[status] ?? CONTACT_EMPTY_MSG.pending}</div>
          )}
        </div>
        {ficha.contact_updated_at && (
          <div className="text-[10px] text-slate-600 mt-2 pt-2 border-t border-slate-700/60">
            Leído de su web el {new Date(ficha.contact_updated_at).toLocaleDateString('es-CL')}
            {(ficha.contact_source_urls ?? []).length > 0 && (
              <> · <a href={ficha.contact_source_urls![0]} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400 underline">ver origen</a></>
            )}
          </div>
        )}
      </div>

      {/* Equipo */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3">
        <h3 className="text-[11px] uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">
          <Users size={12} /> Equipo
          {personas.length > 0 && <span className="text-slate-600">({personas.length})</span>}
        </h3>
        {personas.length === 0 ? (
          <div className="text-xs text-slate-500">Su web no publica nombres del equipo.</div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {[...jefaturas, ...resto].map(p => (
              <div key={p.full_name} className="flex items-start gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-slate-200">{p.full_name}</span>
                    {p.role_raw && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border capitalize ${ROLE_STYLE[p.role_kind]}`}>
                        {p.role_raw}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    {p.phone && <a href={`tel:${p.phone}`} className="hover:text-amber-400">{fmtPhone(p.phone)}</a>}
                    {p.email && <a href={`mailto:${p.email}`} className="hover:text-amber-400 truncate">{p.email}</a>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={`p-1.5 rounded-md ${accent}`}>{icon}</span>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

type InvFilter = 'all' | 'shared' | 'exclusive'

export default function CorredoraFichaClient({ id }: { id: string }) {
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Ficha del inmueble: se abre al pinchar una tarjeta del inventario. Se pide
  // por property_cl_id (la tarjeta ya lo trae), así se reutiliza el mismo modal
  // que /chile/propiedades en vez de duplicar la vista.
  const [selected, setSelected] = useState<Property | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loadingFicha, setLoadingFicha] = useState<string | null>(null)
  const abrirFicha = async (propertyClId: string) => {
    setLoadingFicha(propertyClId)
    try {
      const r = await fetch(`/api/chile/property-cl?id=${encodeURIComponent(propertyClId)}`).then(x => x.json())
      if (r.success && r.data) setSelected(r.data)
    } finally {
      setLoadingFicha(null)
    }
  }

  const [invFilter, setInvFilter] = useState<InvFilter>('all')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/chile/corredoras/${id}`)
      .then(r => r.json())
      .then(data => { if (data.success) setFicha(data.data); else setError(data.error || 'No encontrada') })
      .catch(e => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }, [id, reloadKey])

  const inventory = useMemo(() => {
    if (!ficha) return []
    if (invFilter === 'shared') return ficha.inventory.filter(i => i.shared)
    if (invFilter === 'exclusive') return ficha.inventory.filter(i => !i.shared)
    return ficha.inventory
  }, [ficha, invFilter])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 lg:p-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/chile/corredoras" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-400 mb-4">
          <ArrowLeft size={14} /> Volver a corredoras
        </Link>

        {loading && <div className="text-slate-400 p-8 text-center">Cargando…</div>}
        {error && <div className="text-red-300 bg-red-900/20 border border-red-700/50 rounded-lg p-4 text-sm">{error}</div>}

        {ficha && (
          <>
            {/* Header */}
            <div className="flex items-start gap-4 mb-5">
              <Avatar name={ficha.name} logoUrl={ficha.logo_url} size={56} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-slate-100 capitalize">{ficha.name || '(sin nombre)'}</h1>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CRM_COLORS[ficha.crm_platform] ?? CRM_COLORS.unknown}`}>
                    {CRM_LABELS[ficha.crm_platform] ?? ficha.crm_platform}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-400">
                  {(ficha.advertiser_ids ?? []).length > 0 && (
                    <span title={ficha.accounts > 1
                      ? `Esta corredora publica con ${ficha.accounts} cuentas de vendedor distintas en el portal; la ficha las suma todas.`
                      : undefined}>
                      ML seller{ficha.accounts > 1 ? 's' : ''}:{' '}
                      {(ficha.advertiser_ids ?? []).map(a => (
                        <code key={a} className="bg-slate-800 px-1 rounded mr-1">{a}</code>
                      ))}
                    </span>
                  )}
                  {ficha.web_propia_url && (
                    <a href={ficha.web_propia_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
                      <Globe size={12} /> {ficha.web_propia_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  )}
                  {(ficha.phones ?? []).map(p => (
                    <a key={p} href={`tel:${p}`} className="inline-flex items-center gap-1 hover:text-slate-200"><Phone size={11} /> {p}</a>
                  ))}
                </div>
                {(ficha.comunas_operated ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(ficha.comunas_operated ?? []).map(cm => (
                      <span key={cm} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400">{cm}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Métricas */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Stat icon={<Package size={14} />} label="Stock activo" value={String(ficha.active_count ?? ficha.active_listings_count)} hint="publicados ahora" accent="bg-blue-500/15 text-blue-400" />
              <Stat icon={<History size={14} />} label="Histórico" value={String(ficha.total_listings_seen)} hint="anuncios vistos" accent="bg-slate-600/40 text-slate-300" />
              <Stat icon={<Timer size={14} />} label="Rotación" value={days(ficha.avg_days_on_market)} hint="promedio en mercado" accent="bg-teal-500/15 text-teal-400" />
              <Stat icon={<ShieldCheck size={14} />} label="Exclusividad" value={pct(ficha.exclusivity_ratio)} hint="solo ella publica" accent="bg-emerald-500/15 text-emerald-400" />
              <Stat icon={<GitCompareArrows size={14} />} label="En canje" value={String(ficha.shared_count)} hint="comparte con otra" accent="bg-amber-500/15 text-amber-400" />
            </div>

            {/* Ficha de empresa: contacto + equipo (migración 0088) */}
            <ContactoCard ficha={ficha} />

            {/* Inventario */}
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-slate-300">
                Inventario · {ficha.inventory_count} {ficha.inventory_count === 1 ? 'propiedad' : 'propiedades'}
                {ficha.inventory_count > (ficha.active_count ?? 0) && (
                  <span className="ml-1 font-normal text-slate-500">
                    ({ficha.active_count} publicadas ahora · {ficha.inventory_count - (ficha.active_count ?? 0)} dadas de baja)
                  </span>
                )}
              </h2>
              <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-0.5">
                {([['all', 'Todas'], ['shared', 'En canje'], ['exclusive', 'Exclusivas']] as [InvFilter, string][]).map(([k, lbl]) => (
                  <button key={k} onClick={() => setInvFilter(k)}
                    className={`text-xs px-2.5 py-1 rounded-md transition-colors ${invFilter === k ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {inventory.length === 0 ? (
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-10 text-center text-slate-500">
                Sin propiedades en esta vista
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {inventory.map(it => (
                  <div key={it.property_cl_id}
                    role="button" tabIndex={0}
                    onClick={() => abrirFicha(it.property_cl_id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirFicha(it.property_cl_id) } }}
                    title="Abrir la ficha del inmueble"
                    className={`bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden hover:border-amber-500/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30 transition-all cursor-pointer flex flex-col ${loadingFicha === it.property_cl_id ? 'opacity-60' : ''}`}>
                    <div className="relative aspect-[16/10] bg-slate-900">
                      <InvThumb src={it.own_cover_photo} />
                      <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-slate-200 backdrop-blur-sm capitalize">
                        {it.operation === 'rent' ? 'Arriendo' : 'Venta'}
                      </span>
                      <span className="absolute top-2 right-2">
                        {it.shared ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/90 text-white backdrop-blur-sm">
                            <GitCompareArrows size={10} /> en canje ({it.shared_corredora_count})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/90 text-white backdrop-blur-sm">
                            <ShieldCheck size={10} /> exclusiva
                          </span>
                        )}
                      </span>
                      {!it.own_is_active && (
                        <span className="absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/70 text-slate-300 backdrop-blur-sm">dada de baja</span>
                      )}
                    </div>
                    <div className="p-3 flex-1 flex flex-col">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-lg font-bold text-slate-100">{clp(it.own_price)}</div>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                        {it.bedrooms != null && <span>{it.bedrooms} dorm</span>}
                        {it.bathrooms != null && <span>{it.bathrooms} baños</span>}
                        {it.square_meters != null && <span>{it.square_meters} m²</span>}
                        <span className="capitalize">{it.property_type ?? 'casa'}</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{it.comuna_name || '—'}</div>
                      <div className="mt-auto pt-2.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500 font-mono truncate">{it.seller_reference ? `ref. ${it.seller_reference}` : '—'}</span>
                        {it.own_source_url && (
                          <a href={it.own_source_url} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 shrink-0" title="Ver anuncio original en el portal">
                            Ver aviso <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Ficha del inmueble — el mismo modal que /chile/propiedades */}
      {selected && (
        <PropertyModal
          p={selected}
          onClose={() => setSelected(null)}
          onRefetched={setSelected}
          // Separar un aviso cambia el inventario de la corredora: se recarga.
          onSplit={() => { setSelected(null); setReloadKey(k => k + 1) }}
        />
      )}
    </div>
  )
}
