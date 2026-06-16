import PageShell from '@/components/PageShell'
import { MapPin, CheckCircle2, Clock } from 'lucide-react'

const zonas = [
  { name: 'Barrio Salamanca', slug: 'madrid/barrio-de-salamanca', portals: ['idealista'], jobs: 0, status: 'pending' },
  { name: 'Almagro (Chamberí)', slug: 'madrid/chamberi/almagro', portals: ['idealista'], jobs: 0, status: 'pending' },
  { name: 'Ibiza (Retiro)', slug: 'madrid/retiro/ibiza', portals: ['idealista'], jobs: 0, status: 'pending' },
  { name: 'Pozuelo de Alarcón', slug: 'pozuelo-de-alarcon-madrid', portals: ['idealista'], jobs: 0, status: 'pending' },
  { name: 'La Moraleja (Alcobendas)', slug: 'alcobendas/la-moraleja', portals: ['idealista'], jobs: 0, status: 'pending' },
]

export default function ZonasPage() {
  return (
    <PageShell
      title="Zonas & Scraping"
      subtitle="Estado de cobertura · 5 zonas de prueba activas"
    >
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border-card)]">
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Zona</th>
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Slug Idealista</th>
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Portales</th>
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Jobs</th>
              <th className="text-left px-5 py-3 text-xs text-slate-500 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {zonas.map((z, i) => (
              <tr
                key={z.slug}
                className={`border-b border-[var(--c-border)] ${i % 2 === 0 ? '' : 'bg-[var(--c-card)]'}`}
              >
                <td className="px-5 py-3 text-slate-200 font-medium">{z.name}</td>
                <td className="px-5 py-3 text-slate-500 font-mono text-xs">{z.slug}</td>
                <td className="px-5 py-3">
                  {z.portals.map((p) => (
                    <span key={p} className="text-[11px] bg-[var(--c-active)] text-blue-300 px-2 py-0.5 rounded mr-1">
                      {p}
                    </span>
                  ))}
                </td>
                <td className="px-5 py-3 text-slate-500">{z.jobs}</td>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Clock size={12} />
                    Pendiente
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <CheckCircle2 size={12} className="text-slate-700" />
        <span>
          La tabla <code className="font-mono">scrape_jobs</code> en DB controlará el estado real cuando se active el orquestador.
        </span>
      </div>
    </PageShell>
  )
}
