'use client'

// Ficha de contacto DealerNet reutilizable.
//
// Antes ResultCard y sus helpers (useCopy, CopyButton, PhoneAvatar, ...) vivían
// dentro de DuenoLookup y no se podían reutilizar. Se extrajeron aquí para que
// tanto el flujo de consulta en vivo (DuenoLookup) como el Historial de
// consultas (DealerQueryHistory) muestren EXACTAMENTE la misma ficha completa,
// sin duplicar el layout.

import { useState } from 'react'
import {
  Phone, Mail, MapPin, CheckCircle2, MessageCircle,
  Copy, Check, Users, UserRound,
} from 'lucide-react'

export interface Phone {
  phone_e164: string
  phone_raw: string
  categoria: 'probable' | 'alternativo' | 'laboral'
  clasificacion: string | null
  ind_whatsapp: boolean | null
  idimagen: string | null
  relacion: string | null
  ranking: number | null
}

export interface Address {
  direccion: string
  ubicacion: string | null
  categoria: 'probable' | 'alternativo'
  ranking: number | null
}

export interface Email {
  email: string
  categoria: 'probable' | 'alternativo'
  ranking: number | null
}

export interface Relacionado {
  rut: number | null
  dv: string | null
  nombre: string | null
  relacion: string | null
}

export interface LookupResult {
  nombre_titular: string | null
  rut_num: number
  rut_dv: string
  phones: Phone[]
  addresses: Address[]
  emails: Email[]
  relacionados: Relacionado[]
}

// Copia al portapapeles con feedback (check verde ~1.5s). navigator.clipboard
// requiere contexto seguro — en http plano (VPS sin TLS en dev) se cae al
// truco del <textarea> + execCommand.
export function useCopy() {
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

export function CopyButton({ copied, onClick, title }: { copied: boolean; onClick: () => void; title: string }) {
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
// /api/chile/dealernet-imagen — si no hay imagen o falla, queda el ícono
// genérico. Clic en el avatar → lightbox con la foto en grande.
export function PhoneAvatar({ idimagen }: { idimagen: string | null }) {
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  if (!idimagen || failed) {
    return (
      <span className="w-8 h-8 rounded-full bg-[var(--c-card)] border border-[var(--c-border-strong)] flex items-center justify-center flex-shrink-0">
        <UserRound size={14} className="text-slate-600" />
      </span>
    )
  }
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Ver foto en grande"
        className="flex-shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/60"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/chile/dealernet-imagen?id=${encodeURIComponent(idimagen)}`}
          alt="Foto de perfil"
          onError={() => setFailed(true)}
          className="w-8 h-8 rounded-full object-cover border border-[var(--c-border-strong)] cursor-zoom-in hover:ring-2 hover:ring-blue-500/60 transition-shadow"
        />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center cursor-zoom-out p-6"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/chile/dealernet-imagen?id=${encodeURIComponent(idimagen)}&size=480`}
            alt="Foto de perfil"
            className="max-w-[85vw] max-h-[85vh] w-72 sm:w-96 rounded-2xl border border-slate-600 shadow-2xl object-contain"
          />
        </div>
      )}
    </>
  )
}

export const CATEGORIA_BADGE: Record<string, string> = {
  probable: 'bg-green-950/40 text-green-400 border border-green-900/40',
  alternativo: 'bg-slate-900/40 text-slate-400 border border-slate-800/50',
  laboral: 'bg-blue-950/40 text-blue-400 border border-blue-900/40',
}

export interface PhoneRowData {
  phone_e164: string
  categoria: string
  clasificacion: string | null
  ind_whatsapp: boolean | null
  idimagen: string | null
  relacion: string | null
}

// Fila de teléfono de la ficha Dealer: foto — número — relación — copiar.
// Reutilizada tal cual (misma foto/relación directa/badges) por la ficha de
// Captación, que antes mostraba los números como una simple grilla de píldoras
// sin foto ni relación con el titular.
export function PhoneRow({ phone: p, copied, onCopy }: { phone: PhoneRowData; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-hover)] px-2 py-1.5">
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
      <CopyButton copied={copied} onClick={onCopy} title="Copiar número" />
    </div>
  )
}

export function ResultCard({ result, onLookupRut }: { result: LookupResult; onLookupRut?: (rut: string) => void }) {
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
              <PhoneRow
                key={i}
                phone={p}
                copied={copiedKey === `phone-${i}`}
                onCopy={() => copy(`phone-${i}`, p.phone_e164)}
              />
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
                        {rutStr && onLookupRut && (
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
