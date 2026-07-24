'use client'

import { useState } from 'react'
import {
  Search, Phone, Loader2,
  AlertCircle, ExternalLink, Building2,
  ChevronDown, ChevronRight
} from 'lucide-react'
import { ResultCard, type LookupResult } from './DealerFicha'

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

function rutificadorUrl(nombre: string) {
  return `https://www.nombrerutyfirma.com/buscar?t=nombre&r=${encodeURIComponent(nombre)}`
}

function rutificadorCoUrl(nombre: string) {
  return `https://www.rutificador.co/?q=${encodeURIComponent(nombre)}`
}

export default function DuenoLookup() {
  // Nombre → rutificador (card plegada por defecto)
  const [nombre, setNombre] = useState('')
  const [nombreOpen, setNombreOpen] = useState(false)

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
    <div className="space-y-4">
      {/* Card 0: Buscador Múltiple — dirección/rol → candidatos a RUT */}
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 space-y-3">
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

      {/* Card 3: buscar por nombre en fuentes públicas — plegado por defecto
          para no hacer ruido; es un flujo secundario. */}
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)]">
        <button
          onClick={() => setNombreOpen(o => !o)}
          className="w-full flex items-center gap-2 p-4 text-left"
        >
          <Search size={14} className="text-amber-400" />
          <p className="text-sm font-semibold text-slate-200">Buscar RUT por nombre</p>
          <span className="text-[11px] text-slate-500 hidden sm:inline">fuentes públicas (NombreRutYFirma / Rutificador)</span>
          {nombreOpen
            ? <ChevronDown size={14} className="ml-auto text-slate-500" />
            : <ChevronRight size={14} className="ml-auto text-slate-500" />}
        </button>
        {nombreOpen && (
          <div className="px-4 pb-4 space-y-3">
            <p className="text-[11px] text-slate-500">
              Ingresa el nombre del propietario para obtener su RUT en fuentes públicas.
              El RUT resultante lo pegas arriba en &quot;Obtener datos del dueño&quot;.
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
            <div className="flex flex-col sm:flex-row gap-1.5">
              <a
                href={nombre.trim() ? rutificadorUrl(nombre) : '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { if (!nombre.trim()) e.preventDefault() }}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg border transition-colors ${nombre.trim() ? 'bg-amber-600/20 border-amber-700/50 text-amber-300 hover:bg-amber-600/30' : 'bg-slate-900/20 border-slate-800/30 text-slate-600 cursor-not-allowed'}`}
              >
                <ExternalLink size={12} />
                Buscar en NombreRutYFirma
              </a>
              <a
                href={nombre.trim() ? rutificadorCoUrl(nombre) : '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { if (!nombre.trim()) e.preventDefault() }}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg border transition-colors ${nombre.trim() ? 'bg-amber-600/20 border-amber-700/50 text-amber-300 hover:bg-amber-600/30' : 'bg-slate-900/20 border-slate-800/30 text-slate-600 cursor-not-allowed'}`}
              >
                <ExternalLink size={12} />
                Buscar en Rutificador.co
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
