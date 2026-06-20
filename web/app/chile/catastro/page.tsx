'use client'

import { useMemo, useState } from 'react'
import nextDynamicImport from 'next/dynamic'
import PageShell from '@/components/PageShell'
import { MapPinned } from 'lucide-react'
import { MOCK_PARCELS, MOCK_LISTING_PINS } from '@/lib/mock-chile-cadastre'
import SiiRolSearchPanel from '@/components/chile/SiiRolSearchPanel'

const CadastreMap = nextDynamicImport(() => import('@/components/map/CadastreMap'), { ssr: false })

const ZONES = [
  { id: 'vitacura', label: 'Vitacura', center: { lat: -33.3895, lng: -70.5979 }, comuna: 'Vitacura', siiComunaCode: null },
  { id: 'zapallar', label: 'Zapallar', center: { lat: -32.5538, lng: -71.4633 }, comuna: 'Zapallar', siiComunaCode: null },
  { id: 'las-condes', label: 'Las Condes', center: { lat: -33.4095, lng: -70.5677 }, comuna: 'Las Condes', siiComunaCode: '15108' },
] as const

export default function CatastroPage() {
  const [zoneId, setZoneId] = useState<(typeof ZONES)[number]['id']>('vitacura')
  const zone = ZONES.find((z) => z.id === zoneId)!

  const parcels = useMemo(() => MOCK_PARCELS.filter((p) => p.comuna === zone.comuna), [zone.comuna])
  const pins = useMemo(() => MOCK_LISTING_PINS.filter((p) => p.comuna === zone.comuna), [zone.comuna])

  const confirmedCount = pins.filter((p) => p.location_confidence === 'confirmed').length
  const suspectCount = pins.filter((p) => p.location_confidence === 'pin_suspect').length

  return (
    <PageShell
      title="Catastro Chile"
      subtitle="Mapa satelital + polígonos catastrales (IDE Chile) + pines de anuncios triangulados"
      action={
        <div className="flex items-center gap-1.5 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg p-1">
          {ZONES.map((z) => (
            <button
              key={z.id}
              onClick={() => setZoneId(z.id)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                z.id === zoneId ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {z.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-xs text-slate-500 mb-1">Parcelas catastrales</p>
          <p className="text-lg font-bold text-slate-200">{parcels.length}</p>
          <p className="text-[11px] text-slate-700 mt-0.5">Fuente: IDE Chile (SII)</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-xs text-slate-500 mb-1">Anuncios confirmados</p>
          <p className="text-lg font-bold text-emerald-400">{confirmedCount}</p>
          <p className="text-[11px] text-slate-700 mt-0.5">Triangulación entre corredoras + parcela coincidente</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4">
          <p className="text-xs text-slate-500 mb-1">Pines sospechosos</p>
          <p className="text-lg font-bold text-red-400">{suspectCount}</p>
          <p className="text-[11px] text-slate-700 mt-0.5">Pin fuera de la parcela esperada</p>
        </div>
      </div>

      <div className={zone.siiComunaCode ? 'grid grid-cols-3 gap-4' : ''}>
        <div className={`rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden h-[560px] ${zone.siiComunaCode ? 'col-span-2' : ''}`}>
          <CadastreMap parcels={parcels} pins={pins} center={zone.center} zoom={17} />
        </div>
        {zone.siiComunaCode && <SiiRolSearchPanel comunaCode={zone.siiComunaCode} comunaLabel={zone.label} />}
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
        <MapPinned size={12} className="text-slate-700" />
        <span>
          Polígonos y pines: datos de demostración (<code className="font-mono">web/lib/mock-chile-cadastre.ts</code>) — misma
          forma que producirán la ingesta de IDE Chile y el scraper de Portalinmobiliario una vez conectados a la base de
          datos en vivo.
          {zone.siiComunaCode && ' El buscador de Rol SII a la derecha sí usa datos reales ya ingeridos para esta comuna.'}
        </span>
      </div>
    </PageShell>
  )
}
