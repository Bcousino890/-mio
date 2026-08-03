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
