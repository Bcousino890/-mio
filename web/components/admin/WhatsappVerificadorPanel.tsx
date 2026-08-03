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
import { MessageCircle, Loader2, CheckCircle2, AlertCircle, QrCode } from 'lucide-react'

interface EstadoVerificador {
  success: boolean
  estado?: 'desvinculado' | 'esperando_qr' | 'conectando' | 'conectado' | 'baneado' | 'error'
  numero_e164?: string | null
  ultimo_error?: string | null
  conectado_at?: string | null
  checks_hoy?: number
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

  // Mientras hay un QR en pantalla hay que repreguntar rápido: el que se ve
  // caduca en ~60 s y el worker publica el siguiente.
  const esperando = data?.estado === 'esperando_qr' || data?.estado === 'conectando'
  useEffect(() => {
    const ms = esperando ? 4_000 : 30_000
    const id = setInterval(() => { void refrescar() }, ms)
    return () => clearInterval(id)
  }, [esperando, refrescar])

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

      {/* ── El QR: esto es lo que se escanea ── */}
      {data?.qr_data_url && (
        <div className="mb-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
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
            El código caduca en ~60 s; se renueva solo. Si no aparece uno nuevo, revisar
            que el contenedor <code>whatsapp-verify</code> esté levantado.
          </p>
        </div>
      )}

      {data?.estado === 'desvinculado' && !data?.qr_data_url && (
        <p className="text-[11px] text-slate-400 mb-3">
          El worker no está publicando ningún QR. Levantarlo con{' '}
          <code className="text-slate-300">docker compose -p casafari --profile whatsapp up -d whatsapp-verify</code>{' '}
          y volver a esta pantalla.
        </p>
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

      {data?.estado === 'conectado' && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 mb-2">
          <CheckCircle2 size={13} />
          <span>
            Vinculado{data.numero_e164 ? ` con ${data.numero_e164}` : ''} · {data.checks_hoy ?? 0} verificaciones hoy
          </span>
        </div>
      )}

      {data?.success && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            ['Por verificar', data.pendientes ?? 0, 'text-slate-300'],
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
