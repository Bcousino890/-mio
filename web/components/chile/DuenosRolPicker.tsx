'use client'

import { useState } from 'react'
import { Phone, RefreshCw, UserCheck, History } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Dueños del rol según el Buscador Múltiple de DealerNet (producto 3460, tipo
// "rol"): cada candidato viene marcado como propietario ACTUAL o HISTÓRICO.
//
// El pipeline solo consulta automáticamente al ACTUAL — un histórico ya no es
// el dueño y cada consulta de contactabilidad se paga. Los históricos (y
// cualquier otro RUT) quedan acá a un clic, para pedirlos a propósito: es el
// caso típico de la sociedad que aparece como dueña y de la que se quiere
// consultar a una persona concreta.
// ─────────────────────────────────────────────────────────────────────────────

export interface RutCandidato {
  rut: number | null
  dv: string | null
  clasif?: string | null
  nombres?: string | null
  apellidos?: string | null
  razonSocial?: string | null
  propietario?: string | null // "Actual" | "Histórico"
  probabilidad?: string | null
}

export function candidatoNombre(c: RutCandidato): string {
  return [c.nombres, c.apellidos].filter(Boolean).join(' ') || c.razonSocial || '—'
}

function esHistorico(c: RutCandidato): boolean {
  return (c.propietario ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').startsWith('histor')
}

export function DuenosRolPicker({
  candidatos,
  ownerRut,
  onPedirTelefonos,
  busyRut,
}: {
  candidatos: RutCandidato[]
  /** RUT ya consultado (owner_rut de la captación), para marcarlo. */
  ownerRut?: string | null
  onPedirTelefonos: (rut: string) => void
  /** RUT en curso, para el spinner. `null` = ninguno. */
  busyRut?: string | null
}) {
  const [rutManual, setRutManual] = useState('')

  // Un mismo RUT puede venir como actual y como histórico: se muestra una vez,
  // con la marca de actual (que es la que manda para llamar).
  const vistos = new Set<string>()
  const filas = candidatos
    .filter((c) => c.rut != null)
    .sort((a, b) => Number(esHistorico(a)) - Number(esHistorico(b)))
    .filter((c) => {
      const key = `${c.rut}-${c.dv ?? ''}`
      if (vistos.has(key)) return false
      vistos.add(key)
      return true
    })

  const normalizarRut = (v: string) => v.replace(/[^0-9kK-]/g, '').toUpperCase()

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
        Dueños del rol (DealerNet) <span className="text-slate-600">({filas.length})</span>
      </p>

      <div className="space-y-1">
        {filas.map((c) => {
          const rutStr = `${c.rut}-${c.dv ?? ''}`
          const historico = esHistorico(c)
          const yaConsultado = ownerRut != null && ownerRut.replace(/\./g, '') === rutStr
          const cargando = busyRut === rutStr
          return (
            <div
              key={rutStr}
              className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-[var(--c-border-strong)] bg-[var(--c-card)]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-200 truncate">{candidatoNombre(c)}</span>
                  <span
                    className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${
                      historico
                        ? 'text-slate-400 border-slate-700 bg-slate-800/40'
                        : 'text-emerald-300 border-emerald-800/60 bg-emerald-950/30'
                    }`}
                  >
                    {historico ? <History size={9} /> : <UserCheck size={9} />}
                    {historico ? 'histórico' : 'actual'}
                  </span>
                  {c.probabilidad && (
                    <span className="text-[9px] text-slate-600">prob. {c.probabilidad.toLowerCase()}</span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-slate-500">{rutStr}</span>
              </div>

              {yaConsultado ? (
                <span className="text-[10px] text-emerald-400 whitespace-nowrap">✓ consultado</span>
              ) : (
                <button
                  onClick={() => onPedirTelefonos(rutStr)}
                  disabled={busyRut != null}
                  title={
                    historico
                      ? 'Propietario anterior — la consulta se cobra igual'
                      : 'Pedir teléfonos de este RUT'
                  }
                  className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-blue-900/50 text-blue-300 hover:bg-blue-950/40 disabled:opacity-40 transition-colors"
                >
                  {cargando ? <RefreshCw size={10} className="animate-spin" /> : <Phone size={10} />}
                  Pedir teléfonos
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* RUT a mano: la sociedad dueña rara vez tiene teléfono útil — se
          consulta el de la persona detrás. */}
      <div className="flex items-center gap-1.5 pt-0.5">
        <input
          value={rutManual}
          onChange={(e) => setRutManual(normalizarRut(e.target.value))}
          placeholder="Otro RUT (12345678-9)"
          className="flex-1 min-w-0 bg-[var(--c-card)] border border-[var(--c-border-strong)] rounded px-2 py-1 text-[10px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-700"
        />
        <button
          onClick={() => rutManual && onPedirTelefonos(rutManual)}
          disabled={!rutManual || busyRut != null}
          className="shrink-0 text-[10px] font-medium px-2 py-1 rounded border border-blue-900/50 text-blue-300 hover:bg-blue-950/40 disabled:opacity-40 transition-colors"
        >
          Consultar
        </button>
      </div>
    </div>
  )
}
