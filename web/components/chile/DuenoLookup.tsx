'use client'

import { useState } from 'react'
import {
  Search, Phone, Mail, MapPin, Loader2, CheckCircle2,
  AlertCircle, ExternalLink, MessageCircle, Building2
} from 'lucide-react'

type Status = 'idle' | 'loading' | 'success' | 'error'

const PRODUCTS = [
  { code: '3410', label: 'Directorio Teléfonos', description: 'Solo números — más económico' },
  { code: '3407', label: 'Contactabilidad', description: 'Teléfonos + clasificación + calidad' },
  { code: '3408', label: 'Verificación Múltiple', description: 'Emails + direcciones' },
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
  categoria: 'probable' | 'alternativo'
  clasificacion: string | null
  ind_whatsapp: boolean | null
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

interface LookupResult {
  nombre_titular: string | null
  rut_num: number
  rut_dv: string
  phones: Phone[]
  addresses: Address[]
  emails: Email[]
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

  function usarCandidato(c: Candidato) {
    if (c.rut == null || !c.dv) return
    setRut(`${c.rut}-${c.dv}`)
  }

  async function handleLookup() {
    if (!rut.trim() || selectedProducts.length === 0) return
    setStatus('loading')
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/chile/dealernet-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rut: rut.trim(),
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
                      {c.rut != null ? `RUT ${c.rut.toLocaleString('es-CL')}-${c.dv}` : 'Sin RUT'}
                      {c.propietario ? ` · ${c.propietario}` : ''}
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
          onClick={handleLookup}
          disabled={status === 'loading' || !rut.trim() || selectedProducts.length === 0}
          className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium py-2 rounded-lg transition-colors"
        >
          {status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <Phone size={12} />}
          {status === 'loading' ? 'Obteniendo...' : 'Obtener dueño'}
        </button>

        {result && <ResultCard result={result} />}
      </div>
    </div>
  )
}

function ResultCard({ result }: { result: LookupResult }) {
  const rutFormatted = `${result.rut_num.toLocaleString('es-CL')}-${result.rut_dv}`

  return (
    <div className="space-y-3 pt-1 border-t border-[var(--c-border-card)]">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
        <div>
          {result.nombre_titular && (
            <p className="text-[11px] text-slate-200 font-semibold">{result.nombre_titular}</p>
          )}
          <p className="text-[10px] text-slate-500">RUT {rutFormatted}</p>
        </div>
      </div>

      {result.phones.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Teléfonos</p>
          {result.phones.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <Phone size={10} className="text-slate-500 flex-shrink-0" />
              <span className="font-mono text-slate-200">{p.phone_e164}</span>
              {p.ind_whatsapp && <MessageCircle size={10} className="text-green-500" aria-label="WhatsApp" />}
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${p.categoria === 'probable' ? 'bg-green-950/40 text-green-400 border border-green-900/40' : 'bg-slate-900/40 text-slate-500 border border-slate-800/50'}`}>
                {p.categoria}
              </span>
              {p.clasificacion && (
                <span className="text-[9px] text-slate-600">
                  {p.clasificacion === 'C' ? 'celular' : p.clasificacion === 'F' ? 'fijo' : p.clasificacion}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {result.emails.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Correos</p>
          {result.emails.map((e, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <Mail size={10} className="text-slate-500 flex-shrink-0" />
              <span className="text-slate-200">{e.email}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${e.categoria === 'probable' ? 'bg-green-950/40 text-green-400 border border-green-900/40' : 'bg-slate-900/40 text-slate-500 border border-slate-800/50'}`}>
                {e.categoria}
              </span>
            </div>
          ))}
        </div>
      )}

      {result.addresses.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Direcciones</p>
          {result.addresses.map((a, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px]">
              <MapPin size={10} className="text-slate-500 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-slate-200">{a.direccion}</span>
                {a.ubicacion && <p className="text-[10px] text-slate-500">{a.ubicacion}</p>}
              </div>
              <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${a.categoria === 'probable' ? 'bg-green-950/40 text-green-400 border border-green-900/40' : 'bg-slate-900/40 text-slate-500 border border-slate-800/50'}`}>
                {a.categoria}
              </span>
            </div>
          ))}
        </div>
      )}

      {result.phones.length === 0 && result.emails.length === 0 && result.addresses.length === 0 && (
        <p className="text-[11px] text-slate-500 text-center py-2">Sin datos de contacto para este RUT</p>
      )}
    </div>
  )
}
