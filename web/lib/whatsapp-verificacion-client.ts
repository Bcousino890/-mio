'use client'

// Cliente de la verificación en vivo de WhatsApp (migración 0095).
//
// Las filas de teléfono (PhoneRow) se pintan en tres pantallas distintas
// (ficha Dealer, Captación, Propiedades) y en varias de ellas hay decenas de
// números a la vez. Si cada fila pidiera su verificación por separado serían
// decenas de requests por render, así que este módulo junta los números que
// piden las filas montadas en la misma tanda (~60 ms) y hace UNA consulta.
//
// El resultado se cachea a nivel de módulo: volver a abrir la misma ficha no
// vuelve a preguntar. Es cache de lectura de un dato que solo cambia cuando
// pasa el worker, no un estado que haya que sincronizar.

import { useCallback, useEffect, useState } from 'react'

export interface VerificacionWhatsapp {
  phone_e164: string
  tiene_whatsapp: boolean | null
  tiene_foto: boolean | null
  estado: 'pendiente' | 'ok' | 'error'
  verificado_at: string | null
  foto_cambiada_at: string | null
  revalidar_pedido: boolean
}

export interface EstadoVerificador {
  estado: 'desvinculado' | 'esperando_qr' | 'conectando' | 'conectado' | 'baneado' | 'error'
  numero_e164?: string | null
  conectado_at?: string | null
  ultimo_error?: string | null
}

const ENDPOINT = '/api/chile/whatsapp-verificacion'

/** `null` = consultado y sin verificación todavía (el worker aún no lo tocó). */
const cache = new Map<string, VerificacionWhatsapp | null>()
const porPedir = new Set<string>()
const suscriptores = new Set<() => void>()
let verificador: EstadoVerificador | null = null
let timer: ReturnType<typeof setTimeout> | null = null
// Se apaga si la ruta falla (p. ej. migración 0095 sin aplicar en ese entorno):
// la ficha tiene que seguir mostrando el dato de DealerNet, no romperse.
let disponible = true

function avisar() {
  for (const f of suscriptores) f()
}

export function normalizarTelefono(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits ? `+${digits}` : ''
}

function programarConsulta() {
  if (timer || !disponible) return
  timer = setTimeout(() => { timer = null; void consultar() }, 60)
}

async function consultar(solicitar = false, extra: string[] = []) {
  const phones = Array.from(new Set([...porPedir, ...extra]))
  porPedir.clear()
  if (phones.length === 0) return

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phones, solicitar }),
    })
    const data = await res.json()
    if (!data?.success) {
      disponible = false
      avisar()
      return
    }
    verificador = data.verificador ?? null
    for (const p of phones) cache.set(p, data.verificaciones?.[p] ?? null)
    avisar()
  } catch {
    disponible = false
    avisar()
  }
}

/**
 * Pide al worker que re-verifique este número. No verifica en el acto a
 * propósito: el ritmo del verificador es lo que evita que Meta banee el
 * número que lo hace posible, así que no puede depender de cuántas veces
 * alguien haga clic. El botón deja el pedido y la fila queda "pedida".
 */
export async function solicitarVerificacion(phone: string) {
  const clave = normalizarTelefono(phone)
  if (!clave || !disponible) return
  const actual = cache.get(clave)
  if (actual) {
    cache.set(clave, { ...actual, revalidar_pedido: true })
    avisar()
  }
  await consultar(true, [clave])
}

export interface ResultadoVerificacionLote {
  conWhatsapp: string[]
  sinWhatsapp: string[]
  /** Los que el worker no alcanzó a atender dentro del tiempo de espera. */
  pendientes: string[]
  verificador: EstadoVerificador | null
  /** true si se agotó la espera con números todavía en cola. */
  timeout: boolean
}

/**
 * Verifica AHORA un lote de números y espera el resultado — el paso previo a
 * mandar contactos al CRM: se eligen los teléfonos, se verifican, y se quedan
 * marcados solo los que están en WhatsApp.
 *
 * "Ahora" tiene un límite físico: quien consulta a WhatsApp es el worker, a
 * ~15 números por minuto (unos 4 s cada uno). Ese ritmo es lo que evita que
 * Meta banee el número verificador, así que un botón no puede saltárselo. Lo
 * que hace este método es poner el lote al principio de la cola y esperar:
 * para los 3-6 números de una ficha son segundos, no minutos.
 *
 * Un número se considera resuelto cuando el worker limpia su `revalidar_pedido`
 * — es la señal de que ya pasó por él, tenga o no WhatsApp.
 */
export async function verificarLote(
  phones: string[],
  { onProgreso, timeoutMs = 180_000, intervaloMs = 3_000 }: {
    onProgreso?: (resueltos: number, total: number) => void
    timeoutMs?: number
    intervaloMs?: number
  } = {}
): Promise<ResultadoVerificacionLote> {
  const claves = Array.from(new Set(phones.map(normalizarTelefono).filter(Boolean)))
  const vacio: ResultadoVerificacionLote = {
    conWhatsapp: [], sinWhatsapp: [], pendientes: claves, verificador, timeout: false,
  }
  if (claves.length === 0 || !disponible) return vacio

  const pedir = async (solicitar: boolean) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phones: claves, solicitar }),
    })
    const data = await res.json()
    if (!data?.success) throw new Error(data?.error ?? 'sin respuesta')
    verificador = data.verificador ?? null
    for (const p of claves) cache.set(p, data.verificaciones?.[p] ?? null)
    avisar()   // los badges de la ficha se actualizan solos según llegan
    return data
  }

  const clasificar = () => {
    const conWhatsapp: string[] = []
    const sinWhatsapp: string[] = []
    const pendientes: string[] = []
    for (const p of claves) {
      const v = cache.get(p)
      // Resuelto = el worker ya lo atendió (limpió el pedido) y dio un veredicto.
      if (!v || v.revalidar_pedido || v.estado !== 'ok' || v.tiene_whatsapp == null) pendientes.push(p)
      else if (v.tiene_whatsapp) conWhatsapp.push(p)
      else sinWhatsapp.push(p)
    }
    return { conWhatsapp, sinWhatsapp, pendientes }
  }

  try {
    await pedir(true)
  } catch {
    disponible = false
    avisar()
    return vacio
  }

  const hasta = Date.now() + timeoutMs
  for (;;) {
    const estado = clasificar()
    onProgreso?.(claves.length - estado.pendientes.length, claves.length)
    if (estado.pendientes.length === 0) return { ...estado, verificador, timeout: false }
    if (Date.now() >= hasta) return { ...estado, verificador, timeout: true }
    await new Promise((r) => setTimeout(r, intervaloMs))
    // `solicitar: false`: el pedido ya está puesto; repetirlo solo reordenaría
    // la cola una y otra vez.
    try { await pedir(false) } catch { return { ...clasificar(), verificador, timeout: true } }
  }
}

/**
 * Verificación de UN número. Devuelve también el estado del verificador para
 * que la UI distinga "todavía no verificado" de "no hay verificador vinculado"
 * — que para quien está por llamar no es lo mismo en absoluto.
 */
export function useVerificacionWhatsapp(phone: string | null | undefined) {
  const clave = phone ? normalizarTelefono(phone) : ''
  const [, forzarRender] = useState(0)

  useEffect(() => {
    const cb = () => forzarRender((n) => n + 1)
    suscriptores.add(cb)
    if (clave && !cache.has(clave) && disponible) {
      porPedir.add(clave)
      programarConsulta()
    }
    return () => { suscriptores.delete(cb) }
  }, [clave])

  const solicitar = useCallback(() => solicitarVerificacion(clave), [clave])

  return {
    verificacion: clave ? cache.get(clave) ?? null : null,
    verificador,
    disponible,
    solicitar,
  }
}
