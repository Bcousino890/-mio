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
  Copy, Check, Users, UserRound, ChevronDown, RefreshCw, Loader2,
} from 'lucide-react'
// Misma definición de parentescos que usa el envío al CRM.
import { candidatosDeNombre, foldRelacion, splitRelaciones, edadAproximada } from '@/lib/smartbc/relaciones.mjs'
// Verificación en vivo de WhatsApp (migración 0095): confirma contra WhatsApp
// si el número sigue activo y trae su foto ACTUAL. El dato de DealerNet
// (`ind_whatsapp`, `idimagen`) es de su base y no tiene fecha.
import { useVerificacionWhatsapp, verificarLote } from '@/lib/whatsapp-verificacion-client'

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

// Foto de perfil del número. Hay DOS fuentes posibles y no valen lo mismo:
//
//   · la verificada en vivo (/api/chile/whatsapp-foto) — la foto que el número
//     tiene HOY en WhatsApp, con fecha, la trae el worker de verificación;
//   · la de DealerNet (/api/chile/dealernet-imagen) — la copia que DealerNet
//     capturó en su día, sin fecha, que es lo único que había hasta ahora.
//
// Se prefiere siempre la verificada y se cae a la de DealerNet si no hay (o si
// falla la descarga). Si no hay ninguna, queda el ícono genérico. Clic en el
// avatar → lightbox con la foto en grande.
export function PhoneAvatar({ idimagen, phone }: { idimagen: string | null; phone?: string }) {
  const { verificacion } = useVerificacionWhatsapp(phone)
  const [waFallo, setWaFallo] = useState(false)
  const [dealerFallo, setDealerFallo] = useState(false)
  const [open, setOpen] = useState(false)

  const hayVerificada = Boolean(phone && verificacion?.tiene_foto && !waFallo)
  const hayDealer = Boolean(idimagen && !dealerFallo)

  if (!hayVerificada && !hayDealer) {
    return (
      <span className="w-8 h-8 rounded-full bg-[var(--c-card)] border border-[var(--c-border-strong)] flex items-center justify-center flex-shrink-0">
        <UserRound size={14} className="text-slate-600" />
      </span>
    )
  }

  // `v=` invalida el cache del navegador cuando el worker vuelve a verificar:
  // la URL es la misma pero la foto pudo cambiar, que es justo lo que interesa.
  const src = (size: number) =>
    hayVerificada
      ? `/api/chile/whatsapp-foto?phone=${encodeURIComponent(phone!)}&v=${encodeURIComponent(verificacion?.verificado_at ?? '')}`
      : `/api/chile/dealernet-imagen?id=${encodeURIComponent(idimagen!)}&size=${size}`
  const onError = () => (hayVerificada ? setWaFallo(true) : setDealerFallo(true))

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={hayVerificada
          ? `Foto verificada en WhatsApp${verificacion?.verificado_at ? ` el ${new Date(verificacion.verificado_at).toLocaleDateString('es-CL')}` : ''}`
          : 'Foto de la base de DealerNet (sin fecha) — ver en grande'}
        className="flex-shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/60"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src(120)}
          alt="Foto de perfil"
          onError={onError}
          className={`w-8 h-8 rounded-full object-cover border cursor-zoom-in hover:ring-2 hover:ring-blue-500/60 transition-shadow ${
            // Anillo verde = la foto es la de WhatsApp de hoy, no la de la base.
            hayVerificada ? 'border-green-600/70 ring-1 ring-green-700/40' : 'border-[var(--c-border-strong)]'
          }`}
        />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center cursor-zoom-out p-6"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src(480)}
            alt="Foto de perfil"
            className="max-w-[85vw] max-h-[85vh] w-72 sm:w-96 rounded-2xl border border-slate-600 shadow-2xl object-contain"
          />
        </div>
      )}
    </>
  )
}

/**
 * Badge de WhatsApp de la fila. Muestra lo VERIFICADO cuando existe y cae al
 * `ind_whatsapp` de DealerNet cuando no, siempre diciendo cuál de los dos es:
 * "tiene WhatsApp según la base de DealerNet, quizá de hace años" y "estaba en
 * WhatsApp el martes" son cosas distintas para quien va a llamar.
 */
export function WhatsappBadge({ phone, indWhatsapp }: { phone: string; indWhatsapp: boolean | null }) {
  const { verificacion, verificador, disponible } = useVerificacionWhatsapp(phone)
  const waLink = `https://wa.me/${phone.replace(/\D/g, '')}`
  const verificado = verificacion?.estado === 'ok' && verificacion.tiene_whatsapp != null
  const fecha = verificacion?.verificado_at
    ? new Date(verificacion.verificado_at).toLocaleDateString('es-CL')
    : null

  if (verificado && verificacion!.tiene_whatsapp) {
    return (
      <a
        href={waLink}
        target="_blank"
        rel="noopener noreferrer"
        title={`Verificado en WhatsApp el ${fecha}${verificacion!.foto_cambiada_at ? ` · foto actualizada el ${new Date(verificacion!.foto_cambiada_at).toLocaleDateString('es-CL')}` : ''}`}
        className="inline-flex items-center gap-0.5 text-green-500 hover:text-green-400"
      >
        <MessageCircle size={11} />
        <CheckCircle2 size={9} />
      </a>
    )
  }

  if (verificado && !verificacion!.tiene_whatsapp) {
    // Dato caro de conseguir y fácil de perder de vista: DealerNet puede
    // seguir marcando este número como WhatsApp años después de la baja.
    return (
      <span
        title={`Verificado el ${fecha}: este número NO está en WhatsApp${indWhatsapp ? ' (DealerNet lo marca como que sí — su dato está desactualizado)' : ''}`}
        className="text-[9px] px-1 py-0.5 rounded bg-slate-900/60 text-slate-500 border border-slate-800"
      >
        sin WhatsApp
      </span>
    )
  }

  // Sin verificación todavía: se muestra el dato de DealerNet tal cual estaba
  // antes, pero rotulado como suyo (y sin fecha, porque no la tiene).
  if (!indWhatsapp) return null
  const motivo = !disponible
    ? 'Verificación no disponible en este entorno'
    : verificador && verificador.estado !== 'conectado'
      ? `Verificador ${verificador.estado} — dato sin confirmar`
      : 'Según DealerNet (sin fecha) — pendiente de verificar'
  return (
    <a
      href={waLink}
      target="_blank"
      rel="noopener noreferrer"
      title={`Abrir WhatsApp · ${motivo}`}
      className="text-green-500/60 hover:text-green-400"
    >
      <MessageCircle size={11} />
    </a>
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
  // Un número verificado SIN WhatsApp no se puede mandar al CRM: el equipo
  // contacta por ahí. El filtro definitivo está en el mapper de SmartBC
  // (filtrarPhonesConWhatsapp) — acá se bloquea antes, para que nadie lo
  // elija creyendo que va a viajar.
  const { verificacion } = useVerificacionWhatsapp(p.phone_e164)
  const sinWhatsapp = verificacion?.estado === 'ok' && verificacion.tiene_whatsapp === false
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
          disabled={sinWhatsapp}
          title={sinWhatsapp
            ? 'Verificado sin WhatsApp: no se envía al CRM'
            : selected ? 'Quitar del envío al CRM' : 'Incluir en el envío al CRM'}
          aria-pressed={selected}
          className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
            sinWhatsapp
              ? 'border-slate-800 text-transparent cursor-not-allowed opacity-40'
              : selected
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'border-slate-600 text-transparent hover:border-emerald-500'
          }`}
        >
          <Check size={12} />
        </button>
      )}
      <PhoneAvatar idimagen={p.idimagen} phone={p.phone_e164} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-xs text-slate-100">{p.phone_e164}</span>
          <WhatsappBadge phone={p.phone_e164} indWhatsapp={p.ind_whatsapp} />
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
      <VerificarWhatsappButton phone={p.phone_e164} />
      <CopyButton copied={copied} onClick={onCopy} title="Copiar número" />
    </div>
  )
}

/**
 * "Verificar seleccionados": el paso previo a mandar contactos al CRM.
 *
 * Se eligen los teléfonos de la ficha, se pulsa esto, y cuando termina quedan
 * marcados SOLO los que están en WhatsApp — los de baja se desmarcan solos
 * (`onDescartar`). Así lo que viaja al CRM es lo que de verdad se puede
 * contactar, y se ve antes de enviarlo, no después.
 *
 * La espera es real: quien consulta es el worker, a ~15 números/minuto (unos
 * 4 s cada uno), que es el ritmo que evita que Meta banee el número
 * verificador. Para los 3-6 números de una ficha son segundos.
 */
export function VerificarSeleccionButton({
  phones, onDescartar, className = '',
}: {
  phones: string[]
  /** Números verificados SIN WhatsApp — el padre los desmarca. */
  onDescartar: (sinWhatsapp: string[]) => void
  className?: string
}) {
  const [estado, setEstado] = useState<'idle' | 'verificando'>('idle')
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const { verificador, disponible } = useVerificacionWhatsapp(phones[0] ?? null)

  if (!disponible) return null

  const sinVerificador = !verificador || verificador.estado !== 'conectado'

  async function verificar() {
    setEstado('verificando')
    setMsg(null)
    setProgreso({ hechos: 0, total: phones.length })
    const res = await verificarLote(phones, {
      onProgreso: (hechos, total) => setProgreso({ hechos, total }),
    })
    if (res.sinWhatsapp.length > 0) onDescartar(res.sinWhatsapp)
    setEstado('idle')
    setProgreso(null)

    const partes = [`${res.conWhatsapp.length} con WhatsApp`]
    if (res.sinWhatsapp.length) partes.push(`${res.sinWhatsapp.length} descartado(s)`)
    if (res.pendientes.length) {
      // No se miente con un "listo" cuando el worker no llegó a atenderlos:
      // esos números siguen en cola y su badge se actualizará cuando pase.
      partes.push(res.verificador?.estado === 'conectado'
        ? `${res.pendientes.length} aún en cola`
        : `${res.pendientes.length} sin verificar (verificador ${res.verificador?.estado ?? 'sin vincular'})`)
    }
    setMsg(`${res.pendientes.length === 0 ? '✓ ' : ''}${partes.join(' · ')}`)
  }

  return (
    <>
      <button
        onClick={verificar}
        disabled={estado === 'verificando' || phones.length === 0}
        title={phones.length === 0
          ? 'Marca los teléfonos que te interesan y verifícalos antes de enviarlos'
          : sinVerificador
            ? `Verificador ${verificador?.estado ?? 'sin vincular'}: los números quedan encolados, pero no habrá resultado hasta vincularlo (Configuración)`
            : `Verificar en WhatsApp los ${phones.length} teléfono(s) marcados y desmarcar los que estén de baja`}
        className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-green-800/60 text-green-300 hover:bg-green-950/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${className}`}
      >
        {estado === 'verificando'
          ? <><Loader2 size={11} className="animate-spin" /> Verificando {progreso ? `${progreso.hechos}/${progreso.total}` : ''}…</>
          : <><MessageCircle size={11} /> Verificar WhatsApp ({phones.length})</>}
      </button>
      {msg && (
        <span className={`text-[10px] ${msg.startsWith('✓') ? 'text-emerald-400' : 'text-amber-400'}`}>{msg}</span>
      )}
    </>
  )
}

/**
 * "Verificar en WhatsApp". No consulta a WhatsApp desde el navegador: deja el
 * número al principio de la cola del worker. El ritmo del verificador es lo
 * único que evita que Meta banee el número que lo hace posible, así que no
 * puede depender de cuántas veces alguien haga clic acá.
 */
export function VerificarWhatsappButton({ phone }: { phone: string }) {
  const { verificacion, verificador, disponible, solicitar } = useVerificacionWhatsapp(phone)
  // Sin migración/worker en este entorno, el botón simplemente no aparece.
  if (!disponible) return null

  const pedido = Boolean(verificacion?.revalidar_pedido)
  const sinVerificador = !verificador || verificador.estado !== 'conectado'
  const fecha = verificacion?.verificado_at
    ? new Date(verificacion.verificado_at).toLocaleDateString('es-CL')
    : null

  const title = sinVerificador
    ? `Verificador ${verificador?.estado ?? 'sin vincular'} — el pedido queda encolado hasta que se vincule un número`
    : pedido
      ? 'Re-verificación pedida — el worker la atiende en su próxima pasada'
      : fecha
        ? `Verificado el ${fecha} — pedir verificación de nuevo`
        : 'Pedir verificación en WhatsApp (número y foto actual)'

  return (
    <button
      onClick={solicitar}
      disabled={pedido}
      title={title}
      className={`p-1 rounded transition-colors flex-shrink-0 ${
        pedido
          ? 'text-emerald-500/70 cursor-default'
          : 'text-slate-500 hover:text-slate-200 hover:bg-[var(--c-hover)]'
      }`}
    >
      <RefreshCw size={11} className={pedido ? 'animate-pulse' : ''} />
    </button>
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
