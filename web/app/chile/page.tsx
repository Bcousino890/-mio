import { Fragment } from 'react'
import Link from 'next/link'
import PageShell from '@/components/PageShell'
import { Globe, Star, MapPinned } from 'lucide-react'
import { CHILE_COMUNAS, CHILE_PRIORITY_COMUNAS, CHILE_REGIONS, groupByRegion } from '@/lib/chile-zones'

export default function ChilePage() {
  const grouped = groupByRegion()

  return (
    <PageShell
      title="Chile"
      subtitle={`Alcance de cobertura · ${CHILE_COMUNAS.length} comunas · ${CHILE_PRIORITY_COMUNAS.length} prioritarias para scraping`}
      action={
        <Link
          href="/chile/catastro"
          className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <MapPinned size={13} />
          Ver mapa de catastro
        </Link>
      }
    >
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-xs text-slate-500 mb-1">Comunas cubiertas</p>
          <p className="text-lg font-bold text-slate-200">{CHILE_COMUNAS.length}</p>
          <p className="text-[11px] text-slate-700 mt-0.5">Región Metropolitana completa + zonas de vacaciones</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-xs text-slate-500 mb-1">Prioritarias (scraping inicial)</p>
          <p className="text-lg font-bold text-slate-200">{CHILE_PRIORITY_COMUNAS.length}</p>
          <p className="text-[11px] text-slate-700 mt-0.5">Barrio alto RM + Zapallar/Cachagua · Maitencillo · Pucón · Villarrica</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-xs text-slate-500 mb-1">Regiones</p>
          <p className="text-lg font-bold text-slate-200">{CHILE_REGIONS.length}</p>
          <p className="text-[11px] text-slate-700 mt-0.5">{CHILE_REGIONS.join(' · ')}</p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border-card)]">
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Comuna</th>
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Provincia</th>
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Localidades</th>
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Prioridad</th>
            </tr>
          </thead>
          <tbody>
            {CHILE_REGIONS.map((region) => (
              <Fragment key={region}>
                <tr className="bg-[var(--c-hover)]">
                  <td colSpan={4} className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {region} · {grouped[region].length} comunas
                  </td>
                </tr>
                {grouped[region].map((c, i) => (
                  <tr
                    key={c.name}
                    className={`border-b border-[var(--c-border)] ${i % 2 === 0 ? '' : 'bg-[var(--c-card)]'}`}
                  >
                    <td className="px-5 py-2.5 text-slate-200 font-medium">{c.name}</td>
                    <td className="px-5 py-2.5 text-slate-500">{c.provincia}</td>
                    <td className="px-5 py-2.5 text-slate-500 text-xs">
                      {c.localidades?.join(', ') ?? '—'}
                    </td>
                    <td className="px-5 py-2.5">
                      {c.priority && (
                        <span className="flex items-center gap-1 text-[11px] bg-[var(--c-active)] text-amber-300 px-2 py-0.5 rounded w-fit">
                          <Star size={10} />
                          Prioritaria
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <Globe size={12} className="text-slate-700" />
        <span>
          Taxonomía definida en <code className="font-mono">web/lib/chile-zones.ts</code>. Scraper y anuncios para Chile en construcción.
        </span>
      </div>
    </PageShell>
  )
}
