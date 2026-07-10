'use client'

import { useState } from 'react'
import {
  Search, Phone, Mail, MapPin, Loader2, CheckCircle2,
  AlertCircle, ExternalLink, MessageCircle, Building2,
  Copy, Check, Users, UserRound
} from 'lucide-react'

type Status = 'idle' | 'loading' | 'success' | 'error'

const PRODUCTS = [
  { code: '3410', label: 'Directorio Teléfonos', description: 'Solo números — más económico' },
  { code: '3407', label: 'Contactabilidad', description: 'Teléfonos + clasificación + calidad' },
  { code: '3408', label: 'Verificación Múltiple', description: 'Emails + direcciones' },
  { code: '3421', label: 'Relacionados (extra)', description: 'Normalmente ya vienen incluidos con Directorio Teléfonos — marcar solo si no aparecen' },
] as const

const TIPBUSQ_OPTIONS = [
  { value: 'direccion', label: 'Dirección', placeholder: 'ej. Av. Providencia 1234, Providencia' },
  { value: 'rol', label: 'Rol', placeholder: 'ej. 1234-5, Las Condes' },
  { value: 'nombre', label: 'Nombre', placeholder: 'ej. Juan Pedro González' },
  { value: 'empresa', label: 'Empresa', placeholder: 'ej. Inmobiliaria Los Robles Ltda' },
  { value: 'telefono', label: 'Teléfono', placeholder: 'ej. 912345678' },
  { value: 'patente', label: 'Patente', placeholder: 'ej. ABCD12' },
] as const

interface Candidato {
  rut: number | null
  dv: string | null
  clasif: string | null
  nombres: string | null
  apellidos: string | null
  razonSocial: string | null
  propietario: string | null
  similitud: number | null
  probabilidad: string | null
}

interface Phone {
  phone_e164: string
  phone_raw: string
  categoria: 'probable' | 'alternativo' | 'laboral'
  clasificacion: string | null
  ind_whatsapp: boolean | null
  idimagen: string | null
  relacion: string | null
  ranking: number | null
}

interface Address {
  direccion: string
  ubicacion: string | null
  categoria: 'probable' | 'alternativo'
  ranking: number | null
}

interface Email {
  email: string
  categoria: 'probable' | 'alternativo'
  ranking: number | null
}

interface Relacionado {
  rut: number | null
  dv: string | null
  nombre: string | null
  relacion: string | null
}

interface LookupResult {
  nombre_titular: string | null
  rut_num: number
  rut_dv: string
  phones: Phone[]
  addresses: Address[]
  emails: Email[]
  relacionados: Relacionado[]
}

function rutificadorUrl(nombre: string) {
  return `https://www.nombrerutyfirma.com/buscar?t=nombre&r=${encodeURIComponent(nombre)}`
}

function rutificadorCoUrl(nombre: string) {
  return `https://www.rutificador.co/?q=${encodeURIComponent(nombre)}`
}

export default function DuenoLookup() {
  // Nombre → rutificador
  const [nombre, setNombre] = useState('')

  // RUT → DealerNet
  const [rut, setRut] = useState('')
  const [portalUrl, setPortalUrl] = useState('')
  const [notes, setNotes] = useState('')
  // Default: solo directorio teléfonos (más barato)
  const [selectedProducts, setSelectedProducts] = useState<string[]>(['3410'])
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<LookupResult | null>(null)

  // Buscador Múltiple → candidatos a RUT por dirección/rol/nombre/etc.
  const [tipbusq, setTipbusq] = useState<(typeof TIPBUSQ_OPTIONS)[number]['value']>('direccion')
  const [busqArgs, setBusqArgs] = useState('')
  const [busqStatus, setBusqStatus] = useState<Status>('idle')
  const [busqError, setBusqError] = useState('')
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null)

  function toggleProduct(code: string) {
    setSelectedProducts(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  async function handleBuscarMultiple() {
    if (!busqArgs.trim()) return
    setBusqStatus('loading')
    setBusqError('')
    setCandidatos(null)
    try {
      const res = await fetch('/api/chile/dealernet-buscar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipbusq, args: busqArgs.trim() }),
      })
      const data = await res.json()
      if (!data.success) {
        setBusqStatus('error')
        setBusqError(data.error ?? 'Error al buscar')
        return
      }
      setCandidatos(data.candidatos ?? [])
      setBusqStatus('success')
    } catch (e) {
      setBusqStatus('error')
      setBusqError(e instanceof Error ? e.message : 'Error de red')
    }
  }

  // Al elegir un candidato no basta con copiar el RUT al formulario: el flujo
  // completo es candidato → RUT → solicitud de teléfonos/contactos de una vez.
  function usarCandidato(c: Candidato) {
    if (c.rut == null || !c.dv) return
    const rutStr = `${c.rut}-${c.dv}`
    setRut(rutStr)
    void handleLookup(rutStr)
  }

  async function handleLookup(rutOverride?: string) {
    const rutValue = (rutOverride ?? rut).trim()
    if (!rutValue || selectedProducts.length === 0) return
    setStatus('loading')
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/chile/dealernet-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rut: rutValue,
          product_codes: selectedProducts,
          portal_url: portalUrl.trim() || null,
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setStatus('error')
        setError(data.error ?? 'Error al obtener datos')
        return
      }
      setResult({
        nombre_titular: data.nombre_titular,
        rut_num: data.rut_num,
        rut_dv: data.rut_dv,
        phones: data.phones ?? [],
        addresses: data.addresses ?? [],
        emails: data.emails ?? [],
        relacionados: data.relacionados ?? [],
      })
      setStatus('success')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Error de red')
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Card 0: Buscador Múltiple — dirección/rol → candidatos a RUT */}
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 space-y-3 lg:col-span-2">
        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-purple-400" />
          <p className="text-sm font-semibold text-slate-200">Buscar dueño por dirección / rol</p>
        </div>
        <p className="text-[11px] text-slate-500">
          Buscador Múltiple (DealerNet, producto 3460). Devuelve candidatos con nivel de similitud —
          elige uno para completar el RUT y traer sus datos de contacto.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={tipbusq}
            onChange={(e) => setTipbusq(e.target.value as typeof tipbusq)}
            className="bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-2 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            {TIPBUSQ_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder={TIPBUSQ_OPTIONS.find(o => o.value === tipbusq)?.placeholder}
            value={busqArgs}
            onChange={(e) => setBusqArgs(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBuscarMultiple() }}
            className="flex-1 bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <button
            onClick={handleBuscarMultiple}
            disabled={busqStatus === 'loading' || !busqArgs.trim()}
            className="flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium py-2 px-4 rounded-lg transition-colors whitespace-nowrap"
          >
            {busqStatus === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            Buscar
          </button>
        </div>

        {busqError && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/50 rounded-lg p-2 text-[11px] text-red-300">
            <AlertCircle size={12} className="flex-shrink-0" />
            {busqError}
          </div>
        )}

        {candidatos && (
          candidatos.length === 0 ? (
            <p className="text-[11px] text-slate-500 text-center py-2">Sin candidatos para esta búsqueda</p>
          ) : (
            <div className="space-y-1.5">
              {candidatos.map((c, i) => (
                <button
                  key={i}
                  onClick={() => usarCandidato(c)}
                  disabled={c.rut == null || !c.dv}
                  className="w-full flex items-center gap-2 text-left rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-hover)] hover:border-purple-700/60 hover:bg-purple-950/20 px-3 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-200 font-medium truncate">
                      {c.razonSocial || `${c.nombres ?? ''} ${c.apellidos ?? ''}`.trim() || 'Sin nombre'}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {c.rut != null ? `RUT ${c.rut.toLocaleString('es-CL')}${c.dv ? `-${c.dv}` : ''}` : 'Sin RUT'}
                      {c.propietario ? ` · ${c.propietario}` : ''}
                      {c.rut != null && c.dv ? ' · clic para pedir teléfonos' : ''}
                    </p>
                  </div>
                  {c.probabilidad && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${c.probabilidad === 'Alta' ? 'bg-green-950/40 text-green-400 border border-green-900/40' : c.probabilidad === 'Media' ? 'bg-amber-950/40 text-amber-400 border border-amber-900/40' : 'bg-slate-900/40 text-slate-500 border border-slate-800/50'}`}>
                      {c.probabilidad}{c.similitud != null ? ` ${c.similitud}%` : ''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* Card 1: buscar por nombre */}
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-amber-400" />
          <p className="text-sm font-semibold text-slate-200">Buscar por nombre</p>
        </div>
        <p className="text-[11px] text-slate-500">
          Ingresa el nombre del propietario para obtener su RUT en fuentes públicas.
          El RUT resultante lo usas en el buscador de la derecha.
        </p>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Nombre completo</label>
          <input
            type="text"
            placeholder="ej. Juan Pedro González"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nombre.trim()) window.open(rutificadorUrl(nombre), '_blank')
            }}
            className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <a
            href={nombre.trim() ? rutificadorUrl(nombre) : '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { if (!nombre.trim()) e.preventDefault() }}
            className={`flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg border transition-colors ${nombre.trim() ? 'bg-amber-600/20 border-amber-700/50 text-amber-300 hover:bg-amber-600/30' : 'bg-slate-900/20 border-slate-800/30 text-slate-600 cursor-not-allowed'}`}
          >
            <ExternalLink size={12} />
            Buscar en NombreRutYFirma
          </a>
          <a
            href={nombre.trim() ? rutificadorCoUrl(nombre) : '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { if (!nombre.trim()) e.preventDefault() }}
            className={`flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg border transition-colors ${nombre.trim() ? 'bg-amber-600/20 border-amber-700/50 text-amber-300 hover:bg-amber-600/30' : 'bg-slate-900/20 border-slate-800/30 text-slate-600 cursor-not-allowed'}`}
          >
            <ExternalLink size={12} />
            Buscar en Rutificador.co
          </a>
        </div>
      </div>

      {/* Card 2: RUT → contactos */}
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Phone size={14} className="text-blue-400" />
          <p className="text-sm font-semibold text-slate-200">Obtener datos del dueño</p>
        </div>
        <p className="text-[11px] text-slate-500">
          Ingresa el RUT para obtener teléfonos, direcciones y correos. Los datos se guardan en la base.
        </p>

        <div className="space-y-2">
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">RUT</label>
            <input
              type="text"
              placeholder="12.345.678-9"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLookup() }}
              className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">URL del portal (opcional)</label>
            <input
              type="url"
              placeholder="https://www.portalinmobiliario.com/..."
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">Notas (opcional)</label>
            <input
              type="text"
              placeholder="ej. propiedad en Las Condes, contactar tarde"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-[var(--c-hover)] border border-[var(--c-border-strong)] rounded-lg text-xs px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1.5">Servicios a consultar</label>
          <div className="space-y-1.5">
            {PRODUCTS.map(({ code, label, description }) => (
              <label key={code} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${selectedProducts.includes(code) ? 'border-blue-700/60 bg-blue-950/20' : 'border-[var(--c-border-strong)] bg-[var(--c-hover)]'}`}>
                <input
                  type="checkbox"
                  checked={selectedProducts.includes(code)}
                  onChange={() => toggleProduct(code)}
                  className="mt-0.5 accent-blue-500"
                />
                <div>
                  <p className="text-[11px] text-slate-200 font-medium">{label}</p>
                  <p className="text-[10px] text-slate-500">{description}</p>
                </div>
              </label>
            ))}
          </div>
          {selectedProducts.length === 0 && (
            <p className="text-[10px] text-amber-400 mt-1">Selecciona al menos un servicio</p>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/50 rounded-lg p-2 text-[11px] text-red-300">
            <AlertCircle size={12} className="flex-shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={() => handleLookup()}
          disabled={status === 'loading' || !rut.trim() || selectedProducts.length === 0}
          className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium py-2 rounded-lg transition-colors"
        >
          {status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <Phone size={12} />}
          {status === 'loading' ? 'Obteniendo...' : 'Obtener dueño'}
        </button>

        {result && (
          <ResultCard
            result={result}
            onLookupRut={(r) => { setRut(r); void handleLookup(r) }}
          />
        )}
      </div>
    </div>
  )
}

// Copia al portapapeles con feedback (check verde ~1.5s). navigator.clipboard
// requiere contexto seguro — en http plano (VPS sin TLS en dev) se cae al
// truco del <textarea> + execCommand.
function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  async function copy(key: string, text: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1500)
    } catch { /* portapapeles no disponible */ }
  }

  return { copiedKey, copy }
}

function CopyButton({ copied, onClick, title }: { copied: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-[var(--c-hover)] transition-colors flex-shrink-0"
    >
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  )
}

// Foto de perfil (WhatsApp) asociada al número. La sirve el proxy
// /api/chile/dealernet-imagen — si no hay plantilla configurada o la imagen
// no existe, el onError esconde el <img> y queda el ícono genérico.
function PhoneAvatar({ idimagen }: { idimagen: string | null }) {
  const [failed, setFailed] = useState(false)
  if (!idimagen || failed) {
    return (
      <span className="w-8 h-8 rounded-full bg-[var(--c-card)] border border-[var(--c-border-strong)] flex items-center justify-center flex-shrink-0">
        <UserRound size={14} className="text-slate-600" />
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/chile/dealernet-imagen?id=${encodeURIComponent(idimagen)}`}
      alt="Foto de perfil"
      onError={() => setFailed(true)}
      className="w-8 h-8 rounded-full object-cover border border-[var(--c-border-strong)] flex-shrink-0"
    />
  )
}

const CATEGORIA_BADGE: Record<string, string> = {
  probable: 'bg-green-950/40 text-green-400 border border-green-900/40',
  alternativo: 'bg-slate-900/40 text-slate-400 border border-slate-800/50',
  laboral: 'bg-blue-950/40 text-blue-400 border border-blue-900/40',
}

function ResultCard({ result, onLookupRut }: { result: LookupResult; onLookupRut: (rut: string) => void }) {
  const rutFormatted = `${result.rut_num.toLocaleString('es-CL')}-${result.rut_dv}`
  const rutPlano = `${result.rut_num}-${result.rut_dv}`
  const { copiedKey, copy } = useCopy()

  return (
    <div className="space-y-3 pt-2 border-t border-[var(--c-border-card)]">
      {/* Titular: nombre y RUT, ambos copiables */}
      <div className="flex items-center gap-2 rounded-lg bg-[var(--c-hover)] border border-[var(--c-border-strong)] px-2.5 py-2">
        <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {result.nombre_titular && (
            <div className="flex items-center gap-1">
              <p className="text-xs text-slate-100 font-semibold truncate">{result.nombre_titular}</p>
              <CopyButton
                copied={copiedKey === 'titular-nombre'}
                onClick={() => copy('titular-nombre', result.nombre_titular!)}
                title="Copiar nombre"
              />
            </div>
          )}
          <div className="flex items-center gap-1">
            <p className="text-[11px] font-mono text-slate-400">{rutFormatted}</p>
            <CopyButton
              copied={copiedKey === 'titular-rut'}
              onClick={() => copy('titular-rut', rutPlano)}
              title="Copiar RUT"
            />
          </div>
        </div>
      </div>

      {result.phones.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              Teléfonos <span className="text-slate-600">({result.phones.length})</span>
            </p>
            <button
              onClick={() => copy('all-phones', result.phones.map(p => p.phone_e164).join('\n'))}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded border border-[var(--c-border-strong)] hover:bg-[var(--c-hover)] transition-colors"
            >
              {copiedKey === 'all-phones' ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
              Copiar todos
            </button>
          </div>
          <div className="space-y-1">
            {result.phones.map((p, i) => (
              /* foto — número — relación — copiar */
              <div key={i} className="flex items-center gap-2 rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-hover)] px-2 py-1.5">
                <PhoneAvatar idimagen={p.idimagen} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-xs text-slate-100">{p.phone_e164}</span>
                    {p.ind_whatsapp && (
                      <a
                        href={`https://wa.me/${p.phone_e164.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir WhatsApp"
                        className="text-green-500 hover:text-green-400"
                      >
                        <MessageCircle size={11} />
                      </a>
                    )}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${CATEGORIA_BADGE[p.categoria] ?? CATEGORIA_BADGE.alternativo}`}>
                      {p.categoria}
                    </span>
                    {p.clasificacion && (
                      <span className="text-[9px] text-slate-500">
                        {p.clasificacion === 'C' ? 'celular' : p.clasificacion === 'F' ? 'fijo' : p.clasificacion}
                      </span>
                    )}
                  </div>
                  {p.relacion && (
                    <p className="text-[10px] text-amber-400/90 truncate">
                      {/^relaci/i.test(p.relacion) ? p.relacion : `Relación directa con ${p.relacion}`}
                    </p>
                  )}
                </div>
                <CopyButton
                  copied={copiedKey === `phone-${i}`}
                  onClick={() => copy(`phone-${i}`, p.phone_e164)}
                  title="Copiar número"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {result.emails.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Correos <span className="text-slate-600">({result.emails.length})</span>
          </p>
          {result.emails.map((e, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <Mail size={10} className="text-slate-500 flex-shrink-0" />
              <span className="text-slate-200">{e.email}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${CATEGORIA_BADGE[e.categoria] ?? CATEGORIA_BADGE.alternativo}`}>
                {e.categoria}
              </span>
              <div className="ml-auto">
                <CopyButton
                  copied={copiedKey === `email-${i}`}
                  onClick={() => copy(`email-${i}`, e.email)}
                  title="Copiar correo"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {result.addresses.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Direcciones <span className="text-slate-600">({result.addresses.length})</span>
          </p>
          {result.addresses.map((a, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px]">
              <MapPin size={10} className="text-slate-500 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-200">{a.direccion}</span>
                {a.ubicacion && <p className="text-[10px] text-slate-500">{a.ubicacion}</p>}
              </div>
              <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${CATEGORIA_BADGE[a.categoria] ?? CATEGORIA_BADGE.alternativo}`}>
                {a.categoria}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Relacionados: siempre al final, como en el impreso de DealerNet */}
      {result.relacionados.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Users size={11} className="text-slate-500" />
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              Relacionados <span className="text-slate-600">({result.relacionados.length})</span>
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[var(--c-border-strong)]">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-left text-slate-500 bg-[var(--c-hover)]">
                  <th className="px-2 py-1.5 font-semibold">RUT</th>
                  <th className="px-2 py-1.5 font-semibold">Nombre</th>
                  <th className="px-2 py-1.5 font-semibold">Relación</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {result.relacionados.map((r, i) => {
                  const rutStr = r.rut != null && r.dv ? `${r.rut}-${r.dv}` : null
                  return (
                    <tr key={i} className="border-t border-[var(--c-border-strong)] hover:bg-[var(--c-hover)] transition-colors">
                      <td className="px-2 py-1.5 font-mono text-slate-300 whitespace-nowrap">
                        <span className="inline-flex items-center gap-0.5">
                          {r.rut != null ? `${r.rut.toLocaleString('es-CL')}${r.dv ? `-${r.dv}` : ''}` : '—'}
                          {rutStr && (
                            <CopyButton
                              copied={copiedKey === `rel-rut-${i}`}
                              onClick={() => copy(`rel-rut-${i}`, rutStr)}
                              title="Copiar RUT"
                            />
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-200">
                        <span className="inline-flex items-center gap-0.5">
                          {r.nombre ?? '—'}
                          {r.nombre && (
                            <CopyButton
                              copied={copiedKey === `rel-nombre-${i}`}
                              onClick={() => copy(`rel-nombre-${i}`, r.nombre!)}
                              title="Copiar nombre"
                            />
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-amber-400/90 whitespace-nowrap">{r.relacion ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {rutStr && (
                          <button
                            onClick={() => onLookupRut(rutStr)}
                            title={`Pedir teléfonos de ${r.nombre ?? rutStr}`}
                            className="text-[9px] text-blue-400 hover:text-blue-300 border border-blue-900/50 hover:bg-blue-950/30 rounded px-1.5 py-0.5 transition-colors"
                          >
                            Pedir teléfonos
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.phones.length === 0 && result.emails.length === 0 && result.addresses.length === 0 && result.relacionados.length === 0 && (
        <p className="text-[11px] text-slate-500 text-center py-2">Sin datos de contacto para este RUT</p>
      )}
    </div>
  )
}
