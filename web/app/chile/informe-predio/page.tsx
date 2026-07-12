'use client'

import { useEffect, useState } from 'react'
import { Printer, ExternalLink } from 'lucide-react'
import { formatCLP, formatUF } from '@/lib/currency-formatter'
import { DESTINO_LABELS, MATERIAL_LABELS, CALIDAD_LABELS } from '@/lib/sii-labels'
import { googleEarthUrl, googleMapsUrl } from '@/lib/map-links'

/**
 * Informe imprimible del predio — /chile/informe-predio?comuna=15108&rol=795-198
 *
 * Página en tema claro pensada para imprimir / guardar como PDF desde el
 * navegador (Ctrl+P). Reúne todo lo que el visor sabe del rol: ficha SII,
 * avalúos, construcciones, dueño (SII/TGR/DealerNet ya consultados),
 * compraventas CBR y contexto del entorno (300 m a la redonda).
 */
/**
 * Sparkline SVG minimalista para la serie de avalúo (sin dependencias). Dibuja
 * la evolución del avalúo total por período; degrada a null si hay <2 puntos.
 */
function AvaluoSparkline({ serie }: { serie: { periodo: string; avaluo_total: number | null }[] }) {
  const pts = serie.filter(p => p.avaluo_total != null) as { periodo: string; avaluo_total: number }[]
  if (pts.length < 2) return null
  const W = 220, H = 44, PAD = 3
  const vals = pts.map(p => p.avaluo_total)
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || 1
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (pts.length - 1)
  const y = (v: number) => H - PAD - ((v - min) * (H - 2 * PAD)) / span
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.avaluo_total).toFixed(1)}`).join(' ')
  const first = pts[0], last = pts[pts.length - 1]
  const pct = first.avaluo_total > 0 ? Math.round(((last.avaluo_total - first.avaluo_total) / first.avaluo_total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="flex-shrink-0">
        <path d={d} fill="none" stroke="#2563eb" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(last.avaluo_total)} r={2.5} fill="#2563eb" />
      </svg>
      <div className="text-[11px] text-slate-600">
        <span className={pct >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>{pct >= 0 ? '+' : ''}{pct}%</span>
        {' '}<span className="text-slate-400">{first.periodo}→{last.periodo}</span>
      </div>
    </div>
  )
}

export default function InformePredioPage() {
  const [comuna, setComuna] = useState<string | null>(null)
  const [rol, setRol] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [detail, setDetail] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tgr, setTgr] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [dealernet, setDealernet] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ventas, setVentas] = useState<any[] | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [entorno, setEntorno] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [avm, setAvm] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [histAvaluo, setHistAvaluo] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const c = sp.get('comuna')
    const r = sp.get('rol')
    if (!c || !r) { setError('Faltan parámetros: ?comuna=<código SII>&rol=<manzana-predio>'); return }
    setComuna(c)
    setRol(r)
  }, [])

  useEffect(() => {
    if (!comuna || !rol) return
    fetch(`/api/chile/sii-rol-detail?sii_comuna_code=${comuna}&rol=${encodeURIComponent(rol)}`)
      .then(res => res.json())
      .then(d => { if (d.success) setDetail(d); else setError(d.error ?? 'Rol no encontrado') })
      .catch(() => setError('Error al cargar el rol'))
    // Solo lecturas cacheadas — el informe nunca dispara consultas nuevas a
    // TGR (headless ~20s) ni a DealerNet (servicio pagado); eso se hace desde
    // el visor y aquí se refleja lo ya guardado.
    fetch(`/api/chile/tgr-lookup?rol=${encodeURIComponent(rol)}&sii_comuna_code=${comuna}`)
      .then(res => res.json())
      .then(d => { if (d.success && d.certificado) setTgr(d.certificado) })
      .catch(() => {})
    fetch(`/api/chile/dealernet-lookup?sii_rol=${encodeURIComponent(rol)}&sii_comuna_code=${comuna}`)
      .then(res => res.json())
      .then(d => { if (d.success && d.contact) setDealernet(d) })
      .catch(() => {})
    fetch(`/api/chile/sii-transacciones?sii_comuna_code=${comuna}&rol=${encodeURIComponent(rol)}`)
      .then(res => res.json())
      .then(d => { if (d.success) setVentas(d.data ?? []) })
      .catch(() => {})
    fetch(`/api/chile/avm?sii_comuna_code=${comuna}&rol=${encodeURIComponent(rol)}`)
      .then(res => res.json())
      .then(d => { if (d.success) setAvm(d) })
      .catch(() => {})
    fetch(`/api/chile/avaluo-historico?sii_comuna_code=${comuna}&rol=${encodeURIComponent(rol)}`)
      .then(res => res.json())
      .then(d => { if (d.success) setHistAvaluo(d.serie ?? []) })
      .catch(() => {})
  }, [comuna, rol])

  // Contexto del entorno: roles a 300 m a la redonda (necesita coordenadas)
  useEffect(() => {
    const r = detail?.rol
    if (!r?.lat || !r?.lng || !comuna) return
    fetch('/api/chile/sii-roles-in-zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sii_comuna_code: comuna, shape: { type: 'circle', center: [r.lat, r.lng], radius: 300 } }),
    })
      .then(res => res.json())
      .then(d => { if (d.success) setEntorno(d) })
      .catch(() => {})
  }, [detail, comuna])

  const r = detail?.rol
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const construcciones: any[] = detail?.construcciones ?? []

  if (error) {
    return <div className="min-h-screen bg-white text-slate-800 flex items-center justify-center text-sm">{error}</div>
  }
  if (!r) {
    return <div className="min-h-screen bg-white text-slate-500 flex items-center justify-center text-sm">Generando informe…</div>
  }

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value == null || value === '' ? null : (
      <div className="flex py-1.5 border-b border-slate-100 last:border-0">
        <span className="w-44 flex-shrink-0 text-[12px] text-slate-500">{label}</span>
        <span className="text-[12px] text-slate-800 font-medium">{value}</span>
      </div>
    )

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white">
      <div className="max-w-3xl mx-auto px-8 py-8">

        {/* Barra de acciones — no se imprime */}
        <div className="flex items-center gap-2 mb-6 print:hidden">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2"
          >
            <Printer size={15} />
            Imprimir / Guardar PDF
          </button>
          {r.lat && r.lng && (
            <>
              <a href={googleMapsUrl(r.lat, r.lng)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">Google Maps <ExternalLink size={10} /></a>
              <a href={googleEarthUrl(r.lat, r.lng)} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-1">Google Earth <ExternalLink size={10} /></a>
            </>
          )}
        </div>

        {/* Encabezado */}
        <header className="border-b-2 border-slate-900 pb-4 mb-6">
          <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Informe catastral del predio</p>
          <h1 className="text-2xl font-bold leading-tight">{r.direccion ?? `Rol ${r.rol}`}</h1>
          <p className="text-sm text-slate-600 mt-1">
            Rol <span className="font-mono font-semibold">{comuna}-{r.rol}</span>
            {r.lat && r.lng && <span className="text-slate-400"> · {Number(r.lat).toFixed(6)}, {Number(r.lng).toFixed(6)}</span>}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Generado el {new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })} · Fuente: SII (archivo oficial de roles), TGR, CBR</p>
        </header>

        {/* Valoración estimada (AVM v2) — dos señales públicas: oferta + suelo MINVU */}
        {avm && ((avm.enough && avm.estimated_value != null) || avm.suelo_minvu) && (
          <section className="mb-6">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700 mb-2">Valoración estimada de mercado</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {avm.enough && avm.estimated_value != null && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-500 mb-1">Oferta (anuncios)</p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl font-bold text-blue-800">{formatCLP(avm.estimated_value)}</span>
                    <span className="text-sm text-blue-600">{formatUF(avm.estimated_value, 0)}</span>
                  </div>
                  {avm.estimated_min != null && avm.estimated_max != null && (
                    <p className="text-[12px] text-slate-600 mt-1">Rango: {formatCLP(avm.estimated_min)} – {formatCLP(avm.estimated_max)}</p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-2">
                    {avm.n_comparables} anuncios de venta {avm.scope === 'radio' ? 'en 1 km' : 'de la comuna'}
                    {avm.median_sqm ? ` · mediana ${formatCLP(Math.round(avm.median_sqm))}/m²` : ''} × {avm.base_surface_m2} m² {avm.base_surface_type}.
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 italic">Precio de publicación, no de cierre; con sesgo al alza conocido.</p>
                </div>
              )}
              {avm.suelo_minvu && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 mb-1">Suelo MINVU {avm.suelo_minvu.scope === 'zona' ? '(zona)' : '(comuna)'}</p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl font-bold text-emerald-800">{avm.suelo_minvu.valor_uf_m2} UF/m²</span>
                    {avm.suelo_minvu.valor_clp_m2 != null && (
                      <span className="text-sm text-emerald-700">{formatCLP(avm.suelo_minvu.valor_clp_m2)}/m²</span>
                    )}
                  </div>
                  {avm.suelo_minvu.valor_suelo_estimado != null && (
                    <p className="text-[12px] text-slate-600 mt-1">Valor de suelo del predio: {formatCLP(avm.suelo_minvu.valor_suelo_estimado)}</p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-2">
                    Observatorio del Mercado de Suelo (MINVU){avm.suelo_minvu.periodo ? ` · ${avm.suelo_minvu.periodo}` : ''}, derivado de transacciones del SII.
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 italic">Valor de suelo (terreno), no de la construcción. Mercado realizado a nivel de zona.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Avalúos */}
        <section className="mb-6">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700 mb-2">Avalúos fiscales</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Avalúo total', value: r.avaluo_fiscal_total },
              { label: 'Avalúo exento', value: r.avaluo_exento },
              { label: 'Contribución semestral', value: r.contribucion_semestral },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className="text-base font-bold text-slate-900">{value != null ? formatCLP(Number(value)) : '—'}</p>
                {value != null && Number(value) > 0 && <p className="text-[10px] text-slate-400">{formatUF(Number(value), 2)}</p>}
              </div>
            ))}
          </div>
          {histAvaluo && histAvaluo.length >= 2 && (
            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500 mb-1.5">Evolución del avalúo total (SII)</p>
              <AvaluoSparkline serie={histAvaluo} />
            </div>
          )}
        </section>

        {/* Ficha catastral */}
        <section className="mb-6">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700 mb-2">Información catastral</h2>
          <div className="rounded-lg border border-slate-200 px-3 py-1">
            <Row label="Destino" value={r.codigo_destino_principal ? `${r.codigo_destino_principal} — ${DESTINO_LABELS[r.codigo_destino_principal] ?? ''}` : null} />
            <Row label="Ubicación" value={r.codigo_ubicacion === 'U' ? 'Urbano' : r.codigo_ubicacion === 'R' ? 'Rural' : r.codigo_ubicacion} />
            <Row label="Superficie terreno" value={r.superficie_terreno_m2 ? `${Number(r.superficie_terreno_m2).toLocaleString('es-CL')} m²` : null} />
            <Row label="Superficie construida" value={r.superficie_construida_m2 ? `${Number(r.superficie_construida_m2).toLocaleString('es-CL')} m²` : null} />
            <Row label="Serie" value={r.serie} />
            <Row label="Rol padre (edificio)" value={r.rol_padre} />
            <Row label="Beneficio DFL2" value={r.dfl2_flag ? 'Sí (≤140 m² construidos)' : null} />
          </div>
        </section>

        {/* Propietario */}
        <section className="mb-6">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700 mb-2">Propietario</h2>
          <div className="rounded-lg border border-slate-200 px-3 py-1">
            <Row label="Nombre (SII)" value={r.nombre_propietario} />
            <Row label="Nombre (certificado TGR)" value={tgr?.nombre} />
            <Row
              label="Deuda TGR"
              value={tgr ? (tgr.tiene_deuda ? `CON DEUDA${tgr.total_deuda_morosa ? ` · morosa ${formatCLP(Number(tgr.total_deuda_morosa))}` : ''}` : 'Sin deuda registrada') : null}
            />
            <Row label="Titular (DealerNet)" value={dealernet?.contact?.nombre_titular} />
            {(dealernet?.phones ?? []).slice(0, 4).map((p: { phone_e164?: string; categoria?: string }, i: number) => (
              <Row key={i} label={`Teléfono ${i + 1}`} value={`${p.phone_e164 ?? ''}${p.categoria ? ` (${p.categoria})` : ''}`} />
            ))}
            {!r.nombre_propietario && !tgr?.nombre && !dealernet?.contact && (
              <p className="text-[12px] text-slate-400 py-1.5">Sin datos de propietario consultados aún — usar el visor para consultar TGR/DealerNet.</p>
            )}
          </div>
        </section>

        {/* Construcciones */}
        {construcciones.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700 mb-2">Construcciones ({construcciones.length})</h2>
            <table className="w-full text-[12px] border border-slate-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-left">
                  <th className="px-3 py-2 font-medium">Destino</th>
                  <th className="px-3 py-2 font-medium">Material</th>
                  <th className="px-3 py-2 font-medium">Calidad</th>
                  <th className="px-3 py-2 font-medium text-right">Año</th>
                  <th className="px-3 py-2 font-medium text-right">m²</th>
                </tr>
              </thead>
              <tbody>
                {construcciones.map((c, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{c.destino_code ? (DESTINO_LABELS[c.destino_code] ?? c.destino_code) : '—'}</td>
                    <td className="px-3 py-1.5">{c.material_code ? (MATERIAL_LABELS[c.material_code] ?? c.material_code) : '—'}</td>
                    <td className="px-3 py-1.5">{c.calidad_code ? (CALIDAD_LABELS[String(c.calidad_code)] ?? c.calidad_code) : '—'}</td>
                    <td className="px-3 py-1.5 text-right">{c.anio_construccion ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">{c.superficie_m2 ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Ventas históricas CBR */}
        <section className="mb-6">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700 mb-2">Compraventas (Conservador de Bienes Raíces)</h2>
          {ventas === null ? (
            <p className="text-[12px] text-slate-400">Buscando…</p>
          ) : ventas.length === 0 ? (
            <p className="text-[12px] text-slate-400">Sin compraventas registradas para este rol en el dataset CBR cargado.</p>
          ) : (
            <table className="w-full text-[12px] border border-slate-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-left">
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Foja / CBR</th>
                  <th className="px-3 py-2 font-medium text-right">Monto</th>
                  <th className="px-3 py-2 font-medium text-right">UF/m²</th>
                </tr>
              </thead>
              <tbody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {ventas.map((t: any, i: number) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{t.fecha_escritura ? new Date(t.fecha_escritura).toLocaleDateString('es-CL') : '—'}</td>
                    <td className="px-3 py-1.5 text-slate-500">{[t.foja_numero_anio, t.cbr_nombre].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{t.monto_uf != null ? `${Number(t.monto_uf).toLocaleString('es-CL')} UF` : t.monto_clp != null ? formatCLP(Number(t.monto_clp)) : '—'}</td>
                    <td className="px-3 py-1.5 text-right">{t.uf_por_m2 != null ? Number(t.uf_por_m2).toLocaleString('es-CL') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Entorno */}
        {entorno && entorno.count > 0 && (
          <section className="mb-6">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700 mb-2">Entorno (300 m a la redonda)</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Roles SII</p>
                <p className="text-base font-bold">{Number(entorno.count).toLocaleString('es-CL')}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Avalúo promedio zona</p>
                <p className="text-base font-bold">{entorno.avaluo_promedio ? formatCLP(Number(entorno.avaluo_promedio)) : '—'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Este predio vs promedio</p>
                <p className="text-base font-bold">
                  {r.avaluo_fiscal_total && entorno.avaluo_promedio
                    ? `${Math.round((Number(r.avaluo_fiscal_total) / Number(entorno.avaluo_promedio)) * 100)}%`
                    : '—'}
                </p>
              </div>
            </div>
          </section>
        )}

        <footer className="border-t border-slate-200 pt-3 text-[10px] text-slate-400">
          Informe generado por Casafari Mio a partir de datos oficiales (archivo de roles SII, Tesorería General de la República, Conservador de Bienes Raíces). Los avalúos fiscales no constituyen tasación comercial.
        </footer>
      </div>
    </div>
  )
}
