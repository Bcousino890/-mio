'use client'

// Panel de Configuración → Verificador de WhatsApp.
//
// Es DONDE SE ESCANEA EL QR. El worker (scraper/whatsapp-verify-worker.mjs)
// publica el QR de vinculación en la base y este panel lo pinta; antes había
// que entrar al contenedor a leer logs.
//
// El QR caduca en ~60 s y el worker emite uno nuevo automáticamente, así que
// mientras está esperando vinculación el panel repregunta cada 4 s. Cuando ya
// está conectado, cada 30 s: solo cambian los contadores.
//
// ⚠️ Antes de vincular: docs/WHATSAPP-VERIFICACION.md. Se vincula un número
// REAL de WhatsApp y Meta puede banearlo — va siempre un número sacrificable,
// nunca el corporativo.

import { useCallback, useEffect, useState } from 'react'
import { MessageCircle, Loader2, AlertCircle, QrCode } from 'lucide-react'

interface EstadoVerificador {
  success: boolean
  estado?: 'desvinculado' | 'esperando_qr' | 'conectando' | 'conectado' | 'baneado' | 'error'
  numero_e164?: string | null
  ultimo_error?: string | null
  conectado_at?: string | null
  checks_hoy?: number
  /** 'solicitados' = solo verifica lo que se pide desde las fichas. */
  modo?: 'solicitados' | 'barrido'
  /** Números pedidos a mano y todavía sin atender. */
  pedidos?: number
  /** El worker dio señales de vida hace menos de 3 min. */
  latido?: boolean
  qr_data_url?: string | null
  pendientes?: number | null
  verificados?: { con_whatsapp: number; sin_whatsapp: number; con_foto: number } | null
  error?: string
}

const ROTULO: Record<string, { texto: string; clase: string }> = {
  desvinculado: { texto: 'sin vincular', clase: 'bg-slate-800 text-slate-400' },
  esperando_qr: { texto: 'esperando escaneo', clase: 'bg-amber-900/40 text-amber-300' },
  conectando: { texto: 'conectando…', clase: 'bg-amber-900/40 text-amber-300' },
  conectado: { texto: 'conectado', clase: 'bg-emerald-900/40 text-emerald-300' },
  baneado: { texto: 'BANEADO', clase: 'bg-red-900/50 text-red-300' },
  error: { texto: 'error', clase: 'bg-red-900/50 text-red-300' },
}

export default function WhatsappVerificadorPanel() {
  const [data, setData] = useState<EstadoVerificador | null>(null)
  const [cargando, setCargando] = useState(true)
  // El QR se pide, no se muestra de entrada: vincula un número real y no tiene
  // por qué estar a la vista de cualquiera que abra Configuración.
  const [mostrarQr, setMostrarQr] = useState(false)
  const [guardandoModo, setGuardandoModo] = useState(false)

  const refrescar = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp-verificador')
      setData(await res.json())
    } catch {
      setData({ success: false, error: 'Error de red' })
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { void refrescar() }, [refrescar])

  // El worker relee el modo en cada pasada, así que el cambio se nota en
  // segundos sin reiniciar nada.
  const cambiarModo = useCallback(async (modo: 'solicitados' | 'barrido') => {
    setGuardandoModo(true)
    try {
      await fetch('/api/admin/whatsapp-verificador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo }),
      })
      await refrescar()
    } finally {
      setGuardandoModo(false)
    }
  }, [refrescar])

  const conectado = data?.estado === 'conectado'

  // Con el QR a la vista hay que repreguntar rápido: el código caduca en ~60 s
  // y el worker publica el siguiente. El resto del tiempo, cada 30 s — solo
  // cambian los contadores.
  useEffect(() => {
    const ms = mostrarQr && !conectado ? 4_000 : 30_000
    const id = setInterval(() => { void refrescar() }, ms)
    return () => clearInterval(id)
  }, [mostrarQr, conectado, refrescar])

  // Al vincularse, el QR ya no sirve: el bloque se cierra solo en vez de
  // quedarse con un código muerto en pantalla.
  useEffect(() => { if (conectado) setMostrarQr(false) }, [conectado])

  const rotulo = ROTULO[data?.estado ?? 'desvinculado'] ?? ROTULO.desvinculado

  return (
    <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <MessageCircle size={16} className="text-emerald-500" />
        <h2 className="text-sm font-semibold text-[var(--c-text)]">Verificador de WhatsApp</h2>
        {cargando
          ? <Loader2 size={13} className="animate-spin text-slate-500" />
          : <span className={`text-[10px] px-1.5 py-0.5 rounded ${rotulo.clase}`}>{rotulo.texto}</span>}
      </div>
      <p className="text-xs text-[var(--c-text-muted)] mb-3">
        Confirma contra WhatsApp si los teléfonos de DealerNet siguen activos y guarda su
        foto de perfil actual. DealerNet entrega ambos datos de su propia base y sin fecha.
        Los números verificados <strong>sin</strong> WhatsApp no se envían al CRM.
      </p>

      {data?.success === false && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-400 bg-amber-950/30 border border-amber-900/40 rounded-lg px-2.5 py-2 mb-3">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            No se pudo leer el estado. Si la migración <code>0095</code> no está aplicada
            todavía, es esperable. Detalle: {data.error}
          </span>
        </div>
      )}

      {/* ── Conectado o no, en una línea ── */}
      {data?.success && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className={`inline-flex items-center gap-1.5 text-xs ${conectado ? 'text-emerald-400' : 'text-slate-400'}`}>
            <span className={`w-2 h-2 rounded-full ${
              conectado ? 'bg-emerald-500' : data.estado === 'baneado' ? 'bg-red-500' : 'bg-slate-600'
            }`} />
            {conectado
              ? `Conectado${data.numero_e164 ? ` · ${data.numero_e164}` : ''}`
              : data.estado === 'baneado' ? 'Número baneado' : 'No conectado'}
          </span>

          {/* El QR no se muestra de entrada: es un código que vincula un
              número real y no tiene por qué estar a la vista de cualquiera
              que abra Configuración. Se pide. */}
          {!conectado && (
            <button
              onClick={() => setMostrarQr((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-emerald-800/60 text-emerald-300 hover:bg-emerald-950/30 transition-colors"
            >
              <QrCode size={12} />
              {mostrarQr ? 'Ocultar QR' : 'Ver QR'}
            </button>
          )}
          {conectado && (
            <span className="text-[10px] text-slate-500">
              {data.checks_hoy ?? 0} verificaciones hoy
            </span>
          )}
        </div>
      )}

      {/* ── El QR: esto es lo que se escanea ── */}
      {mostrarQr && !conectado && (
        <div className="mb-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
          {data?.qr_data_url ? (
            <>
              <div className="flex items-center gap-1.5 mb-2">
                <QrCode size={13} className="text-amber-400" />
                <p className="text-[11px] font-semibold text-amber-300">Escanear para vincular</p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.qr_data_url}
                alt="QR de vinculación de WhatsApp"
                className="w-64 h-64 rounded-lg bg-white p-2 mx-auto"
              />
              <ol className="mt-2 text-[11px] text-slate-400 space-y-0.5 list-decimal list-inside">
                <li>En el teléfono del número verificador: WhatsApp → Ajustes</li>
                <li>Dispositivos vinculados → Vincular un dispositivo</li>
                <li>Apuntar a este código</li>
              </ol>
              <p className="mt-2 text-[10px] text-slate-500">
                El código caduca en ~60 s y se renueva solo mientras esta pantalla esté abierta.
              </p>
            </>
          ) : data?.latido ? (
            // Levantado y a segundos de emitir el código: solo hay que esperar.
            <p className="text-[11px] text-amber-400 inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Worker activo, esperando que WhatsApp emita el código…
            </p>
          ) : (
            // Sin latido: el contenedor no está corriendo. Es la causa nº 1 de
            // "no aparece el QR", y llevan a acciones opuestas — por eso se
            // distinguen en vez de dejar girando un spinner eterno.
            <div className="text-[11px] text-slate-400 space-y-1">
              <p className="text-amber-300">El worker no está corriendo — por eso no hay QR.</p>
              <p>Levantarlo en el VPS:</p>
              <code className="block text-slate-300 bg-slate-900/60 border border-slate-700 rounded px-2 py-1 overflow-x-auto">
                docker compose -p casafari --env-file ../.env --profile whatsapp up -d whatsapp-verify
              </code>
              <p>
                O deja <code className="text-slate-300">WA_VERIFY_ENABLED=1</code> en el{' '}
                <code className="text-slate-300">.env</code> del VPS y cada deploy lo mantendrá vivo.
              </p>
            </div>
          )}
        </div>
      )}

      {data?.estado === 'baneado' && (
        <div className="flex items-start gap-1.5 text-[11px] text-red-300 bg-red-950/30 border border-red-900/40 rounded-lg px-2.5 py-2 mb-3">
          <AlertCircle size={13} className="mt-px shrink-0" />
          <span>
            Meta baneó el número verificador. Hay que rotar a otro número sacrificable:
            borrar el volumen <code>wa-auth</code> y volver a vincular.
          </span>
        </div>
      )}

      {/* ── Qué verifica: lo que se le pide, o toda la base ── */}
      {data?.success && (
        <div className="mb-3 rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-hover)] p-2.5">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Qué verifica
          </p>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['solicitados', 'Solo lo que yo pida', 'Nada se verifica solo: el worker atiende únicamente los teléfonos que marques y verifiques desde las fichas.'],
              ['barrido', 'Barrer toda la base', `Además de lo pedido, va completando los ${(data.pendientes ?? 0).toLocaleString('es-CL')} números sin verificar, por antigüedad.`],
            ] as const).map(([valor, etiqueta, ayuda]) => (
              <button
                key={valor}
                onClick={() => cambiarModo(valor)}
                disabled={guardandoModo}
                title={ayuda}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                  (data.modo ?? 'solicitados') === valor
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-slate-600 text-slate-300 hover:border-emerald-500'
                }`}
              >
                {etiqueta}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-slate-500">
            {(data.modo ?? 'solicitados') === 'solicitados'
              ? `El worker está en espera. ${(data.pedidos ?? 0) > 0 ? `${data.pedidos} teléfono(s) pedidos en cola.` : 'Sin nada pedido ahora mismo.'}`
              : 'El worker completa la base por su cuenta, priorizando siempre lo que pidas desde las fichas.'}
          </p>
        </div>
      )}

      {data?.success && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            ['Sin verificar', data.pendientes ?? 0, 'text-slate-300'],
            ['Con WhatsApp', data.verificados?.con_whatsapp ?? 0, 'text-emerald-400'],
            ['Sin WhatsApp', data.verificados?.sin_whatsapp ?? 0, 'text-slate-500'],
            ['Con foto', data.verificados?.con_foto ?? 0, 'text-blue-400'],
          ].map(([etiqueta, valor, clase]) => (
            <div key={String(etiqueta)} className="rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-hover)] py-1.5">
              <p className={`text-sm font-semibold ${clase}`}>{Number(valor).toLocaleString('es-CL')}</p>
              <p className="text-[10px] text-slate-500">{etiqueta}</p>
            </div>
          ))}
        </div>
      )}

      {data?.ultimo_error && data.estado !== 'conectado' && (
        <p className="mt-2 text-[10px] text-slate-500 truncate" title={data.ultimo_error}>
          Último error: {data.ultimo_error}
        </p>
      )}
    </div>
  )
}
