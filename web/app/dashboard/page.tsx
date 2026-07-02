import Link from 'next/link'
import PageShell from '@/components/PageShell'
import { Building2, TrendingDown, Users, AlertCircle, Globe, MapPinned, Phone, ChevronRight } from 'lucide-react'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface DashboardStats {
  activeListings: number | null
  priceDropsToday: number | null
  particularLeads: number | null
  opportunities: number | null
  chileListings: number | null
  chileSiiRoles: number | null
  chileCaptaciones: number | null
  chileContactos: number | null
}

async function getStats(): Promise<DashboardStats> {
  const empty: DashboardStats = {
    activeListings: null, priceDropsToday: null, particularLeads: null, opportunities: null,
    chileListings: null, chileSiiRoles: null, chileCaptaciones: null, chileContactos: null,
  }
  if (!process.env.DATABASE_URL) return empty

  // Cada métrica cae a NULL por separado: una tabla/vista ausente (BD a medio
  // migrar) no debe tumbar el dashboard entero.
  const q = async (sql: string): Promise<number | null> => {
    try {
      const { rows } = await pool.query(sql)
      return Number(rows[0]?.n ?? 0)
    } catch {
      return null
    }
  }

  const [activeListings, priceDropsToday, particularLeads, opportunities,
    chileListings, chileSiiRoles, chileCaptaciones, chileContactos] = await Promise.all([
    q(`SELECT count(*) AS n FROM listings WHERE is_active`),
    q(`SELECT count(*) AS n FROM listing_changes WHERE change_type = 'price_down' AND changed_at::date = CURRENT_DATE`),
    q(`SELECT count(*) AS n FROM v_leads_particulares`),
    q(`SELECT count(*) AS n FROM mv_opportunities`),
    q(`SELECT count(*) AS n FROM listings_cl WHERE is_active`),
    q(`SELECT count(*) AS n FROM sii_roles_cl`),
    q(`SELECT count(*) AS n FROM captaciones_cl`),
    q(`SELECT count(*) AS n FROM captaciones_cl WHERE stage = 'contact_found'`),
  ])

  return { activeListings, priceDropsToday, particularLeads, opportunities, chileListings, chileSiiRoles, chileCaptaciones, chileContactos }
}

function fmt(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString('es-ES')
}

export default async function DashboardPage() {
  const s = await getStats()

  const madridStats = [
    { label: 'Anuncios activos', value: fmt(s.activeListings), icon: Building2, color: 'text-blue-400', href: '/anuncios' },
    { label: 'Bajadas de precio hoy', value: fmt(s.priceDropsToday), icon: TrendingDown, color: 'text-green-400', href: '/anuncios' },
    { label: 'Leads particulares', value: fmt(s.particularLeads), icon: Users, color: 'text-purple-400', href: '/captacion' },
    { label: 'Oportunidades inversión', value: fmt(s.opportunities), icon: AlertCircle, color: 'text-amber-400', href: '/oportunidades' },
  ]

  const chileStats = [
    { label: 'Anuncios Chile activos', value: fmt(s.chileListings), icon: Building2, color: 'text-blue-400', href: '/chile/anuncios' },
    { label: 'Roles SII cargados', value: fmt(s.chileSiiRoles), icon: MapPinned, color: 'text-emerald-400', href: '/chile/catastro' },
    { label: 'Captaciones en pipeline', value: fmt(s.chileCaptaciones), icon: Users, color: 'text-violet-400', href: '/chile/captacion' },
    { label: 'Dueños con teléfono', value: fmt(s.chileContactos), icon: Phone, color: 'text-amber-400', href: '/chile/captacion' },
  ]

  const madridEmpty = !s.activeListings && !s.particularLeads

  return (
    <PageShell title="Dashboard" subtitle="Visión general · Madrid + Chile">
      {/* Madrid */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🇪🇸</span>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Madrid</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {madridStats.map(({ label, value, icon: Icon, color, href }) => (
          <Link
            key={label}
            href={href}
            className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-5 hover:border-slate-600 transition-colors group"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500">{label}</p>
              <Icon size={16} className={color} />
            </div>
            <p className="text-2xl font-bold text-slate-100 flex items-center justify-between">
              {value}
              <ChevronRight size={14} className="text-slate-700 group-hover:text-slate-400 transition-colors" />
            </p>
          </Link>
        ))}
      </div>

      {madridEmpty && (
        <div className="rounded-xl border border-dashed border-[var(--c-border-strong)] bg-[var(--c-card)] p-8 text-center mb-8">
          <Building2 size={28} className="mx-auto text-slate-700 mb-2" />
          <p className="text-slate-500 text-sm font-medium">Madrid sin datos todavía</p>
          <p className="text-slate-700 text-xs mt-1">
            Importa los particulares del VPS antiguo o ejecuta el primer scrape para poblar estas métricas.
          </p>
        </div>
      )}

      {/* Chile */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🇨🇱</span>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Chile</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {chileStats.map(({ label, value, icon: Icon, color, href }) => (
          <Link
            key={label}
            href={href}
            className="rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-5 hover:border-slate-600 transition-colors group"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500">{label}</p>
              <Icon size={16} className={color} />
            </div>
            <p className="text-2xl font-bold text-slate-100 flex items-center justify-between">
              {value}
              <ChevronRight size={14} className="text-slate-700 group-hover:text-slate-400 transition-colors" />
            </p>
          </Link>
        ))}
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 gap-4">
        <Link
          href="/chile/captar-url"
          className="flex items-center gap-3 rounded-xl border border-blue-900/40 bg-blue-950/10 p-4 hover:border-blue-700/60 transition-colors"
        >
          <Globe size={18} className="text-blue-400" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Captar desde URL</p>
            <p className="text-[11px] text-slate-500">Portal Inmobiliario → rol + dueño + teléfonos</p>
          </div>
        </Link>
        <Link
          href="/mercado"
          className="flex items-center gap-3 rounded-xl border border-[var(--c-border-card)] bg-[var(--c-card)] p-4 hover:border-slate-600 transition-colors"
        >
          <TrendingDown size={18} className="text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Análisis de mercado</p>
            <p className="text-[11px] text-slate-500">€/m² mediano · stock · time-on-market por zona</p>
          </div>
        </Link>
      </div>
    </PageShell>
  )
}
