'use client'

// Ficha de contacto DealerNet reutilizable.
//
// Antes ResultCard y sus helpers (useCopy, CopyButton, PhoneAvatar, ...) vivían
// dentro de DuenoLookup y no se podían reutilizar. Se extrajeron aquí para que
// tanto el flujo de consulta en vivo (DuenoLookup) como el Historial de
// consultas (DealerQueryHistory) muestren EXACTAMENTE la misma ficha completa,
// sin duplicar el layout.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Phone, Mail, MapPin, CheckCircle2, MessageCircle,
  Copy, Check, Users, UserRound, ChevronDown,
} from 'lucide-react'
// Misma definición de parentescos que usa el envío al CRM.
import { candidatosDeNombre, foldRelacion, splitRelaciones, edadAproximada } from '@/lib/smartbc/relaciones.mjs'

/**
 * Tooltip común de la edad estimada — misma frase donde sea que se muestre.
 * "Puede fallar por años" no es cautela de más: en la calibración contra
 * casos reales, 1 de 2 quedó a 10 años de la edad real (típico de alguien que
 * obtuvo su RUT ya adulto, donde el correlativo no refleja el año de
 * nacimiento). Sirve para distinguir a simple vista, no para confiar en el
 * número puntual.
 */
const EDAD_APROX_TITLE = 'Edad aproximada estimada por RUT — puede fallar por años (p. ej. en RUT tramitados en la adultez). No es un dato verificado.'

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

/** Una persona de la ficha (relacionado de DealerNet o titular del TGR). */
export interface PersonaOpcion {
  nombre: string
  relacion: string | null
  rut: string | null
  /** Edad aproximada estimada por RUT (ver `edadAproximada`). `null` en RUT de empresa o sin RUT. */
  edad: number | null
}

/**
 * Elegir, de la lista de relacionados, con qué nombre viaja un teléfono al CRM.
 *
 * DealerNet nunca dice de quién es un número: del teléfono solo se sabe el
 * parentesco ("Hijo") y los nombres viven en la tabla de Relacionados — donde
 * hay tres hijos. Escribirlo a mano obligaba a bajar hasta esa tabla, leerlo y
 * copiarlo sin equivocarse; acá se elige de esa misma lista, con los que calzan
 * con la relación del número arriba del todo (el primero es el que el pipeline
 * pone solo). Al elegir viaja también el RUT de esa persona, que es lo que la
 * identifica en el CRM.
 *
 * Sigue admitiendo texto libre: hay números de gente que no está en la tabla, y
 * hay nombres legales que el equipo prefiere escribir como los usa la persona.
 */
export function NamePicker({
  value, options, relacion, onChange, onOpenChange,
}: {
  value: string
  options: PersonaOpcion[]
  relacion?: string | null
  /** `opcion` viene solo cuando el nombre se eligió de la lista. */
  onChange: (nombre: string, opcion?: PersonaOpcion) => void
  onOpenChange?: (abierto: boolean) => void
}) {
  const [abierto, setAbierto] = useState(false)
  // `null` = no se está filtrando y el input muestra el nombre elegido.
  const [filtro, setFiltro] = useState<string | null>(null)
  const [activo, setActivo] = useState(-1)
  const cajaRef = useRef<HTMLDivElement>(null)

  const cerrar = useCallback(() => {
    setAbierto(false)
    setFiltro(null)
    setActivo(-1)
    onOpenChange?.(false)
  }, [onOpenChange])

  const abrir = useCallback(() => {
    setAbierto(true)
    onOpenChange?.(true)
  }, [onOpenChange])

  // Clic fuera: cerrar sin tocar lo escrito.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) cerrar()
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto, cerrar])

  const { sugeridos, otros } = candidatosDeNombre(relacion, options)
  const q = foldRelacion(filtro ?? '')
  const filtrar = (lista: PersonaOpcion[]) => (q
    ? lista.filter((o) => foldRelacion(`${o.nombre} ${o.relacion ?? ''} ${o.rut ?? ''}`).includes(q))
    : lista)
  const gSugeridos = filtrar(sugeridos)
  const gOtros = filtrar(otros)
  const planos = [...gSugeridos, ...gOtros]

  const elegida = options.find((o) => foldRelacion(o.nombre) === foldRelacion(value))
  const esElegida = (o: PersonaOpcion) => foldRelacion(o.nombre) === foldRelacion(value)

  const elegir = (o: PersonaOpcion) => {
    onChange(o.nombre, o)
    cerrar()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!abierto) abrir()
      setActivo((i) => Math.min(i + 1, planos.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActivo((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && abierto && planos[activo]) {
      e.preventDefault()
      elegir(planos[activo])
    } else if (e.key === 'Escape' && abierto) {
      // Frena el Escape del modal de la ficha: cierra la lista, no la captación.
      e.preventDefault()
      e.stopPropagation()
      cerrar()
    }
  }

  // Funciones que devuelven JSX, no componentes: declarar un componente dentro
  // del render le cambia la identidad en cada pasada y React desmonta el botón
  // entre el mousedown y el click — el clic sobre una opción se perdería.
  const opcion = (o: PersonaOpcion, i: number) => (
    <button
      key={o.rut ?? o.nombre}
      type="button"
      role="option"
      aria-selected={esElegida(o)}
      // Sin esto el input pierde el foco antes del clic y la lista se cierra sola.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => elegir(o)}
      onMouseEnter={() => setActivo(i)}
      className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors ${
        i === activo ? 'bg-[var(--c-hover)]' : ''
      }`}
    >
      <Check size={10} className={`shrink-0 ${esElegida(o) ? 'text-emerald-400' : 'text-transparent'}`} />
      <span className="text-[11px] text-slate-100 truncate flex-1">{o.nombre}</span>
      {o.relacion && <span className="text-[9px] text-amber-400/90 shrink-0">{o.relacion}</span>}
      {/* RUT + edad juntos: son el mismo dato de identidad, y es lo que
          distingue a los tres "Hijo" cuando el nombre solo no alcanza. */}
      {(o.rut || o.edad != null) && (
        <span className="text-[9px] font-mono text-slate-500 shrink-0" title={o.edad != null ? EDAD_APROX_TITLE : undefined}>
          {o.rut}{o.rut && o.edad != null ? ' · ' : ''}{o.edad != null ? `~${o.edad}a` : ''}
        </span>
      )}
    </button>
  )

  const encabezado = (texto: string) => (
    <p className="px-2 pt-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">{texto}</p>
  )

  return (
    <div ref={cajaRef} className="relative mt-1">
      <div className="flex items-center gap-1">
        <input
          value={filtro ?? value ?? ''}
          onChange={(e) => {
            setFiltro(e.target.value)
            setActivo(-1)
            if (!abierto) abrir()
            onChange(e.target.value)
          }}
          onFocus={abrir}
          onKeyDown={onKeyDown}
          placeholder="Elegir de relacionados o escribir el nombre"
          role="combobox"
          aria-expanded={abierto}
          aria-autocomplete="list"
          className="flex-1 min-w-0 bg-[var(--c-card)] border border-[var(--c-border-strong)] rounded px-1.5 py-0.5 text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (abierto ? cerrar() : abrir())}
          title="Ver los relacionados de la ficha"
          aria-label="Ver los relacionados de la ficha"
          className="shrink-0 p-0.5 rounded text-slate-500 hover:text-slate-200 hover:bg-[var(--c-hover)] transition-colors"
        >
          <ChevronDown size={12} className={abierto ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      </div>

      {/* Quién quedó elegido: el parentesco solo no basta para saber cuál de los
          tres hijos es, el RUT y la edad aproximada sí. */}
      {elegida && (elegida.relacion || elegida.rut || elegida.edad != null) && (
        <p className="text-[9px] text-slate-500 mt-0.5 truncate" title={elegida.edad != null ? EDAD_APROX_TITLE : undefined}>
          {[elegida.relacion, elegida.rut, elegida.edad != null ? `~${elegida.edad} años` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {abierto && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-card)] shadow-xl"
        >
          {planos.length === 0 ? (
            <p className="px-2 py-2 text-[10px] text-slate-500">
              Ningún relacionado coincide — el nombre que escribas viaja igual.
            </p>
          ) : (
            <>
              {gSugeridos.length > 0 && encabezado(`Calzan con «${splitRelaciones(relacion).join(', ')}»`)}
              {gSugeridos.map((o, i) => opcion(o, i))}
              {gOtros.length > 0 && encabezado(gSugeridos.length ? 'Resto de la ficha' : 'Relacionados')}
              {gOtros.map((o, i) => opcion(o, gSugeridos.length + i))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Fila de teléfono de la ficha Dealer: foto — número — relación — copiar.
// Reutilizada tal cual (misma foto/relación directa/badges) por la ficha de
// Captación, que antes mostraba los números como una simple grilla de píldoras
// sin foto ni relación con el titular.
/**
 * Fila de teléfono. La selección (`selected` / `onToggleSelect`) es OPCIONAL: la
 * ficha Dealer la usa solo para leer y copiar, mientras que la de Captación la
 * usa para elegir qué números viajan al CRM. Sin esas props la fila se comporta
 * exactamente igual que antes.
 *
 * El nombre es editable cuando la fila está seleccionada porque es el dato que
 * DealerNet no da: de un teléfono solo se sabe el parentesco ("Cuñada (Por
 * Conyuge)"), no a cuál de los 23 relacionados corresponde. Eso lo resuelve
 * quien mira la ficha, y es lo que acaba viendo quien llama desde el CRM.
 * Con `nameOptions` ese nombre se ELIGE de la lista de relacionados en vez de
 * escribirse a mano; sin ellas la fila queda con el campo libre de siempre.
 */
export function PhoneRow({
  phone: p, copied, onCopy, selected, onToggleSelect, name, onNameChange, nameOptions,
}: {
  phone: PhoneRowData
  copied: boolean
  onCopy: () => void
  selected?: boolean
  onToggleSelect?: () => void
  name?: string
  onNameChange?: (v: string, opcion?: PersonaOpcion) => void
  nameOptions?: PersonaOpcion[]
}) {
  const seleccionable = typeof onToggleSelect === 'function'
  // La lista de nombres se despliega SOBRE las filas de abajo: mientras está
  // abierta, esta fila tiene que pintarse por encima de las siguientes.
  const [listaAbierta, setListaAbierta] = useState(false)
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
      listaAbierta ? 'relative z-30 ' : ''
    }${
      seleccionable && selected
        ? 'border-emerald-600/70 bg-emerald-950/20'
        : 'border-[var(--c-border-strong)] bg-[var(--c-hover)]'
    }`}>
      {seleccionable && (
        <button
          onClick={onToggleSelect}
          title={selected ? 'Quitar del envío al CRM' : 'Incluir en el envío al CRM'}
          aria-pressed={selected}
          className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
            selected
              ? 'bg-emerald-600 border-emerald-600 text-white'
              : 'border-slate-600 text-transparent hover:border-emerald-500'
          }`}
        >
          <Check size={12} />
        </button>
      )}
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
        {seleccionable && selected && onNameChange && (
          nameOptions && nameOptions.length > 0 ? (
            <NamePicker
              value={name ?? ''}
              options={nameOptions}
              relacion={p.relacion}
              onChange={onNameChange}
              onOpenChange={setListaAbierta}
            />
          ) : (
            <input
              value={name ?? ''}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Nombre con el que viaja al CRM"
              className="mt-1 w-full bg-slate-900/60 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
            />
          )
        )}
      </div>
      <CopyButton copied={copied} onClick={onCopy} title="Copiar número" />
    </div>
  )
}

// Tabla "Relacionados" (RUT — Nombre — Relación) de la ficha Dealer: es lo que
// le pone NOMBRE a la "Relación directa con X" de cada teléfono, que por sí
// sola solo trae el tipo de relación (Cónyuge, Suegra, Empleador...), nunca el
// nombre de esa persona. Autónoma (useCopy propio) para reutilizarla igual en
// Captación y en Propiedades sin que el padre tenga que administrar sus keys
// de copiado.
export function RelacionadosTable({ relacionados, onLookupRut }: { relacionados: Relacionado[]; onLookupRut?: (rut: string) => void }) {
  const { copiedKey, copy } = useCopy()
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Users size={11} className="text-slate-500" />
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
          Relacionados <span className="text-slate-600">({relacionados.length})</span>
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--c-border-strong)]">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-left text-slate-500 bg-[var(--c-hover)]">
              <th className="px-2 py-1.5 font-semibold">RUT</th>
              <th className="px-2 py-1.5 font-semibold">Nombre</th>
              <th className="px-2 py-1.5 font-semibold">Relación</th>
              <th className="px-2 py-1.5 font-semibold" title={EDAD_APROX_TITLE}>Edad aprox.</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {relacionados.map((r, i) => {
              const rutStr = r.rut != null && r.dv ? `${r.rut}-${r.dv}` : null
              const edad = edadAproximada(r.rut)
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
                  <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{edad != null ? `~${edad}` : '—'}</td>
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
        <RelacionadosTable relacionados={result.relacionados} onLookupRut={onLookupRut} />
      )}

      {result.phones.length === 0 && result.emails.length === 0 && result.addresses.length === 0 && result.relacionados.length === 0 && (
        <p className="text-[11px] text-slate-500 text-center py-2">Sin datos de contacto para este RUT</p>
      )}
    </div>
  )
}
