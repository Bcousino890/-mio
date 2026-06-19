'use client'

import { useState, useEffect } from 'react'
import PageShell from '@/components/PageShell'
import { Users, AlertTriangle, TrendingUp, MapPin } from 'lucide-react'

type Lead = {
  id: string
  portal: string
  external_id: string
  source_url: string
  operation: 'sale' | 'rent'
  price: number
  bedrooms: number
  bathrooms: number
  square_meters: number
  contact_name: string | null
  phone: string | null
  zone_raw: string
  address: string
  latitude: number
  longitude: number
  detected_at: string
  last_seen_at: string
}

function fmt(n: number) {
  return n.toLocaleString('es-ES')
}

export default function CaptacionPage() {
  const [particulareCount, setParticulareCount] = useState<number | null>(null)
  const [exclusivasCount, setExclusivasCount] = useState<number | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loadingMetrics, setLoadingMetrics] = useState(true)
  const [loadingLeads, setLoadingLeads] = useState(true)

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoadingMetrics(true)
        const [pRes, eRes] = await Promise.all([
          fetch('/api/captacion?metric=particulares'),
          fetch('/api/captacion?metric=exclusivas'),
        ])
        const pData = await pRes.json()
        const eData = await eRes.json()
        setParticulareCount(pData.success ? pData.count : 0)
        setExclusivasCount(eData.success ? eData.count : 0)
      } catch (err) {
        console.error('Error loading metrics:', err)
        setParticulareCount(0)
        setExclusivasCount(0)
      } finally {
        setLoadingMetrics(false)
      }
    }
    fetchMetrics()
  }, [])

  useEffect(() => {
    const fetchLeads = async () => {
      try {
        setLoadingLeads(true)
        const res = await fetch('/api/captacion?metric=leads_list&limit=20')
        const data = await res.json()
        if (data.success) setLeads(data.data || [])
      } catch (err) {
        console.error('Error loading leads:', err)
      } finally {
        setLoadingLeads(false)
      }
    }
    fetchLeads()
  }, [])

  return (
    <PageShell
      title="Captación"
      subtitle="Leads de particulares · exclusivas rotas · señales de motivación"
    >
      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-purple-400" />
            <p className="text-sm font-medium text-slate-300">Particulares activos</p>
          </div>
          {loadingMetrics ? (
            <p className="text-2xl font-bold text-slate-100">—</p>
          ) : (
            <p className="text-2xl font-bold text-slate-100">{fmt(particulareCount ?? 0)}</p>
          )}
          <p className="text-xs text-slate-600 mt-1">Anuncios en venta/alquiler</p>
        </div>
        <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-400" />
            <p className="text-sm font-medium text-slate-300">Exclusivas rotas</p>
          </div>
          {loadingMetrics ? (
            <p className="text-2xl font-bold text-slate-100">—</p>
          ) : (
            <p className="text-2xl font-bold text-slate-100">{fmt(exclusivasCount ?? 0)}</p>
          )}
          <p className="text-xs text-slate-600 mt-1">Inmuebles en ≥2 agencias</p>
        </div>
      </div>

      {/* Leads list */}
      <div className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[var(--c-border-card)]">
          <TrendingUp size={16} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-300">Últimos leads de particulares</h3>
        </div>

        {loadingLeads ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-700">
            <p className="text-sm font-medium">Cargando leads…</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-700">
            <Users size={32} className="text-slate-700 mb-3" />
            <p className="text-sm font-medium">Sin leads todavía</p>
            <p className="text-xs mt-1">Aparecerán al scrapear particulares</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead>
                <tr className="text-[10px] text-slate-600 uppercase tracking-wide border-b border-[var(--c-border-card)]">
                  <th className="font-medium px-5 py-3">Contacto</th>
                  <th className="font-medium px-3 py-3">Teléfono</th>
                  <th className="font-medium px-3 py-3">Portal</th>
                  <th className="font-medium px-3 py-3">Operación</th>
                  <th className="font-medium px-3 py-3 text-right">Precio</th>
                  <th className="font-medium px-3 py-3">Zona</th>
                  <th className="font-medium px-3 py-3 text-center">Hab</th>
                  <th className="font-medium px-3 py-3 text-center">Baños</th>
                  <th className="font-medium px-3 py-3 text-right">m²</th>
                  <th className="font-medium px-3 py-3">Última vez</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--c-border-card)]">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-[var(--c-hover)] transition-colors text-sm">
                    <td className="px-5 py-3">
                      <a
                        href={lead.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-medium truncate block max-w-xs"
                      >
                        {lead.contact_name || `Anuncio ${lead.external_id.slice(0, 8)}`}
                      </a>
                      <p className="text-[10px] text-slate-600 mt-0.5">{lead.address}</p>
                    </td>
                    <td className="px-3 py-3">
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} className="text-slate-300 hover:text-blue-400">
                          {lead.phone}
                        </a>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-slate-400">{lead.portal}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        lead.operation === 'sale'
                          ? 'bg-blue-950/60 text-blue-400'
                          : 'bg-violet-950/60 text-violet-400'
                      }`}>
                        {lead.operation === 'sale' ? 'Venta' : 'Alquiler'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-300">
                      {fmt(lead.price)} {lead.operation === 'sale' ? '€' : '€/mes'}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-slate-400">{lead.zone_raw}</span>
                    </td>
                    <td className="px-3 py-3 text-center text-slate-400">{lead.bedrooms}</td>
                    <td className="px-3 py-3 text-center text-slate-400">{lead.bathrooms}</td>
                    <td className="px-3 py-3 text-right text-slate-400">{lead.square_meters}</td>
                    <td className="px-3 py-3">
                      <span className="text-[10px] text-slate-600">
                        {new Date(lead.last_seen_at).toLocaleDateString('es-ES', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        } as Intl.DateTimeFormatOptions)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  )
}
