'use client'

import { useEffect, useMemo, useState } from 'react'
import nextDynamicImport from 'next/dynamic'
import PageShell from '@/components/PageShell'
import { ChevronDown, Database, Upload } from 'lucide-react'
import Link from 'next/link'
import { MOCK_PARCELS, MOCK_LISTING_PINS } from '@/lib/mock-chile-cadastre'
import SiiRolSearchPanel from '@/components/chile/SiiRolSearchPanel'

const CadastreMap = nextDynamicImport(() => import('@/components/map/CadastreMap'), { ssr: false })

const ZONES = [
  // ── Barrio alto RM — datos SII reales subidos ─────────────────────────────
  { id: 'vitacura',      label: 'Vitacura',      group: 'Barrio alto RM', center: { lat: -33.3895, lng: -70.5979 }, comuna: 'Vitacura',     siiComunaCode: '15131', hasRealData: true  },
  { id: 'las-condes',   label: 'Las Condes',    group: 'Barrio alto RM', center: { lat: -33.4095, lng: -70.5677 }, comuna: 'Las Condes',   siiComunaCode: '15108', hasRealData: true  },
  { id: 'lo-barnechea', label: 'Lo Barnechea',  group: 'Barrio alto RM', center: { lat: -33.3504, lng: -70.5167 }, comuna: 'Lo Barnechea', siiComunaCode: '15111', hasRealData: true  },
  { id: 'colina',       label: 'Colina',         group: 'Barrio alto RM', center: { lat: -33.2007, lng: -70.6769 }, comuna: 'Colina',       siiComunaCode: '13301', hasRealData: true  },
  { id: 'providencia',  label: 'Providencia',   group: 'Barrio alto RM', center: { lat: -33.4320, lng: -70.6145 }, comuna: 'Providencia',  siiComunaCode: null,    hasRealData: false },
  { id: 'la-reina',     label: 'La Reina',      group: 'Barrio alto RM', center: { lat: -33.4479, lng: -70.5458 }, comuna: 'La Reina',     siiComunaCode: null,    hasRealData: false },
  { id: 'nunoa',        label: 'Ñuñoa',         group: 'Barrio alto RM', center: { lat: -33.4574, lng: -70.5962 }, comuna: 'Ñuñoa',        siiComunaCode: null,    hasRealData: false },
  // ── Zonas de vacaciones ───────────────────────────────────────────────────
  { id: 'zapallar',     label: 'Zapallar',      group: 'Vacaciones',     center: { lat: -32.5538, lng: -71.4633 }, comuna: 'Zapallar',     siiComunaCode: null,    hasRealData: false },
  { id: 'maitencillo',  label: 'Maitencillo',   group: 'Vacaciones',     center: { lat: -32.6421, lng: -71.4167 }, comuna: 'Puchuncaví',   siiComunaCode: null,    hasRealData: false },
  { id: 'pucon',        label: 'Pucón',         group: 'Vacaciones',     center: { lat: -39.2772, lng: -71.9788 }, comuna: 'Pucón',        siiComunaCode: null,    hasRealData: false },
  { id: 'villarrica',   label: 'Villarrica',    group: 'Vacaciones',     center: { lat: -39.2803, lng: -72.2267 }, comuna: 'Villarrica',   siiComunaCode: null,    hasRealData: false },
] as const

type ZoneId = (typeof ZONES)[number]['id']

export default function CatastroPage() {
  const [zoneId, setZoneId] = useState<ZoneId>('vitacura')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const zone = ZONES.find((z) => z.id === zoneId)!
  const [siiStats, setSiiStats] = useState<any>(null)
  const [siiLoading, setSiiLoading] = useState(false)

  useEffect(() => {
    if (!zone.siiComunaCode) { setSiiStats(null); return }
    setSiiLoading(true)
    fetch(`/api/chile/sii-stats?sii_comuna_code=${zone.siiComunaCode}`)
      .then(r => r.json())
      .then(d => { if (d.success) setSiiStats(d) })
      .catch(() => setSiiStats(null))
      .finally(() => setSiiLoading(false))
  }, [zone.siiComunaCode])

  const parcels = useMemo(() => MOCK_PARCELS.filter((p) => p.comuna === zone.comuna), [zone.comuna])
  const pins = useMemo(() => MOCK_LISTING_PINS.filter((p) => p.comuna === zone.comuna), [zone.comuna])

  const confirmedCount = pins.filter((p) => p.location_confidence === 'confirmed').length
  const suspectCount = pins.filter((p) => p.location_confidence === 'pin_suspect').length

  const groups = ['Barrio alto RM', 'Vacaciones'] as const

  return (
    <PageShell
      title="Catastro Chile"
      subtitle="Mapa satelital + polígonos catastrales (IDE Chile) + pines triangulados"
      action={
        <div className="flex items-center gap-2">
          {/* Dropdown selector de comunas */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-2 text-xs font-medium bg-[var(--c-card)] border border-[var(--c-border-card)] text-slate-200 px-3 py-1.5 rounded-lg hover:border-blue-600/40 transition-colors"
            >
              {zone.hasRealData && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              )}
              {zone.label}
              <ChevronDown size={12} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-xl shadow-xl shadow-black/40 py-1.5 min-w-[180px]">
                {groups.map((g) => (
                  <div key={g}>
                    <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">{g}</p>
                    {ZONES.filter((z) => z.group === g).map((z) => (
                      <button
                        key={z.id}
                        onClick={() => { setZoneId(z.id); setDropdownOpen(false) }}
                        className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors ${
                          z.id === zoneId ? 'text-blue-400 bg-blue-950/30' : 'text-slate-400 hover:text-slate-200 hover:bg-[var(--c-surface)]'
                        }`}
                      >
                        {z.hasRealData
                          ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                          : <span className="w-1.5 h-1.5 rounded-full bg-slate-700 flex-shrink-0" />
                        }
                        {z.label}
                        {z.hasRealData && <span className="ml-auto text-[9px] text-emerald-500 font-semibold">SII</span>}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="border-t border-[var(--c-border-card)] mt-1.5 pt-1.5 px-3 pb-1">
                  <Link
                    href="/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    <Upload size={11} />
                    Subir más comunas SII
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      }
    >
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-[11px] text-slate-500 mb-1">Parcelas (demo)</p>
          <p className="text-lg font-bold text-slate-200">{parcels.length}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">Polígonos IDE Chile</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-[11px] text-slate-500 mb-1">Confirmados</p>
          <p className="text-lg font-bold text-emerald-400">{confirmedCount}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">Triangulados + parcela</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-[11px] text-slate-500 mb-1">Sospechosos</p>
          <p className="text-lg font-bold text-red-400">{suspectCount}</p>
          <p className="text-[10px] text-slate-700 mt-0.5">Pin fuera de parcela</p>
        </div>
        <div className={`rounded-xl border p-4 ${zone.hasRealData ? 'border-emerald-900/50 bg-emerald-950/20' : 'border-[var(--c-border-card)] bg-[var(--c-card)]'}`}>
          <p className="text-[11px] text-slate-500 mb-1">Roles SII reales</p>
          {siiLoading ? (
            <p className="text-lg font-bold text-slate-600">…</p>
          ) : siiStats ? (
            <p className="text-lg font-bold text-emerald-400">{Number(siiStats.total_roles).toLocaleString('es-CL')}</p>
          ) : (
            <p className="text-lg font-bold text-slate-600">—</p>
          )}
          <p className="text-[10px] text-slate-700 mt-0.5">{zone.hasRealData ? `sii_roles_cl · ${zone.siiComunaCode}` : 'Sin datos SII aún'}</p>
        </div>
      </div>

      {/* Map + search panel */}
      <div className={zone.siiComunaCode ? 'grid grid-cols-3 gap-4' : ''}>
        <div className={`rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden h-[520px] ${zone.siiComunaCode ? 'col-span-2' : ''}`}>
          <CadastreMap parcels={parcels} pins={pins} center={zone.center} zoom={16} />
        </div>
        {zone.siiComunaCode && (
          <SiiRolSearchPanel comunaCode={zone.siiComunaCode} comunaLabel={zone.label} />
        )}
      </div>

      {/* SII real data stats panel */}
      {zone.siiComunaCode && siiStats && (
        <div className="mt-4 rounded-xl border border-emerald-900/40 bg-[var(--c-card)] p-4">
          <div className="flex items-center gap-2 mb-4">
            <Database size={13} className="text-emerald-400" />
            <p className="text-xs font-semibold text-emerald-300">Datos reales SII — {zone.label}</p>
            <span className="ml-auto text-[10px] text-slate-600">sii_roles_cl · {zone.siiComunaCode}</span>
          </div>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="rounded-lg bg-[var(--c-surface)] p-3">
              <p className="text-[10px] text-slate-500 mb-0.5">Total roles</p>
              <p className="text-base font-bold text-slate-200">{Number(siiStats.total_roles).toLocaleString('es-CL')}</p>
            </div>
            <div className="rounded-lg bg-[var(--c-surface)] p-3">
              <p className="text-[10px] text-slate-500 mb-0.5">Habitacional</p>
              <p className="text-base font-bold text-slate-200">{Number(siiStats.habitacional).toLocaleString('es-CL')}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">
                {siiStats.total_roles > 0 ? `${Math.round(siiStats.habitacional * 100 / siiStats.total_roles)}%` : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--c-surface)] p-3">
              <p className="text-[10px] text-slate-500 mb-0.5">Avalúo promedio</p>
              <p className="text-base font-bold text-slate-200">
                {siiStats.avaluo_promedio ? `$${Math.round(siiStats.avaluo_promedio / 1_000_000)}M` : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--c-surface)] p-3">
              <p className="text-[10px] text-slate-500 mb-0.5">Sup. promedio terreno</p>
              <p className="text-base font-bold text-slate-200">
                {siiStats.superficie_promedio_m2 ? `${Math.round(siiStats.superficie_promedio_m2)} m²` : '—'}
              </p>
            </div>
          </div>
          {siiStats.sample_roles?.length > 0 && (
            <>
              <p className="text-[10px] text-slate-600 mb-2 uppercase tracking-widest font-semibold">Top 10 por avalúo fiscal</p>
              <div className="overflow-x-auto rounded-lg border border-[var(--c-border-card)]">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-[var(--c-surface)] text-slate-600 border-b border-[var(--c-border-card)]">
                      <th className="text-left px-3 py-2 font-medium">Rol</th>
                      <th className="text-left px-3 py-2 font-medium">Dirección</th>
                      <th className="text-right px-3 py-2 font-medium">Avalúo fiscal</th>
                      <th className="text-right px-3 py-2 font-medium">Sup. terreno</th>
                      <th className="text-right px-3 py-2 font-medium">Destino</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siiStats.sample_roles.map((r: any, i: number) => (
                      <tr key={r.rol} className={`border-b border-[var(--c-border-card)]/40 hover:bg-[var(--c-surface)] transition-colors ${i % 2 === 1 ? 'bg-[var(--c-card)]/50' : ''}`}>
                        <td className="px-3 py-2 font-mono text-blue-400">{r.rol}</td>
                        <td className="px-3 py-2 text-slate-400 max-w-[220px] truncate">{r.direccion ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-200 font-medium">
                          {r.avaluo_fiscal_total ? `$${Math.round(r.avaluo_fiscal_total / 1_000_000)}M` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400">
                          {r.superficie_terreno_m2 ? `${r.superficie_terreno_m2} m²` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">{r.codigo_destino_principal ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sin datos SII — CTA upload */}
      {!zone.siiComunaCode && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] px-4 py-3">
          <p className="text-xs text-slate-500">
            {zone.label} no tiene datos SII ingeridos aún. Descarga el archivo plano en <span className="text-slate-400">sii.cl → Avalúos → Descarga por comuna</span> y súbelo aquí.
          </p>
          <Link
            href="/settings"
            className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors ml-4 flex-shrink-0"
          >
            <Upload size={12} />
            Subir datos SII
          </Link>
        </div>
      )}
    </PageShell>
  )
}
