'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  TrendingUp,
  Users,
  BarChart3,
  MapPin,
  Box,
  Settings,
  ChevronRight,
  Sun,
  Moon,
  Globe,
  MapPinned,
  Database,
  Upload,
  Link2,
  UserSearch,
  Receipt,
  Contact,
  Store,
  Home,
  Activity,
  type LucideIcon,
} from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'

const COUNTRIES = [
  { id: 'es', label: 'España', flag: '🇪🇸', homeHref: '/dashboard', city: 'Madrid' },
  { id: 'cl', label: 'Chile', flag: '🇨🇱', homeHref: '/chile', city: 'Santiago' },
] as const

interface ModuleItem {
  href: string
  label: string
  icon: LucideIcon
  description: string
  badge?: string
}

const MODULES_BY_COUNTRY: Record<'es' | 'cl', ModuleItem[]> = {
  es: [
    {
      href: '/dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'Resumen general',
    },
    {
      href: '/anuncios',
      label: 'Anuncios',
      icon: Building2,
      description: 'Mercado completo deduplicado',
    },
    {
      href: '/oportunidades',
      label: 'Oportunidades',
      icon: TrendingUp,
      description: 'Inversión · precio/m² bajo',
      badge: 'NEW',
    },
    {
      href: '/captacion',
      label: 'Captación',
      icon: Users,
      description: 'Leads · exclusivas rotas',
    },
    {
      href: '/mercado',
      label: 'Mercado',
      icon: BarChart3,
      description: '€/m² · heatmap · TOM',
    },
    {
      href: '/zonas',
      label: 'Zonas & Scraping',
      icon: MapPin,
      description: 'Cobertura por zona',
    },
    {
      href: '/mapa-3d',
      label: 'Mapa 3D',
      icon: Box,
      description: 'Satélite · rotación e inclinación',
      badge: 'NEW',
    },
  ],
  cl: [
    {
      href: '/chile',
      label: 'Chile',
      icon: Globe,
      description: 'Resumen · comunas cubiertas',
    },
    {
      href: '/chile/catastro',
      label: 'Catastro',
      icon: MapPinned,
      description: 'Mapa catastral + Rol SII real',
    },
    {
      href: '/chile/anuncios',
      label: 'Anuncios',
      icon: Building2,
      description: 'Portal Inmobiliario · venta y arriendo RM',
      badge: 'NEW',
    },
    {
      href: '/chile/propiedades',
      label: 'Propiedades',
      icon: Home,
      description: '1 inmueble = 1 ficha · N corredoras (dedup)',
      badge: 'NEW',
    },
    {
      href: '/chile/corredoras',
      label: 'Corredoras',
      icon: Store,
      description: 'Directorio · stock, rotación, exclusividad',
      badge: 'NEW',
    },
    {
      href: '/chile/anuncios-health',
      label: 'Salud scraping',
      icon: Activity,
      description: 'Estado del pipeline · ingesta, dedup, cobertura',
      badge: 'NEW',
    },
    {
      href: '/chile/oportunidades',
      label: 'Oportunidades',
      icon: TrendingUp,
      description: 'Precio bajo mediana $/m² por comuna',
    },
    {
      href: '/chile/captacion',
      label: 'Captación',
      icon: Users,
      description: 'Pipeline URL → rol → dueño → teléfonos',
      badge: 'NEW',
    },
    {
      href: '/chile/captar-url',
      label: 'Captar desde URL',
      icon: Link2,
      description: 'Portal Inmobiliario → triangular con SII',
      badge: 'NEW',
    },
    {
      href: '/chile/duenos',
      label: 'Dueños',
      icon: UserSearch,
      description: 'Buscar propietario · RUT · teléfonos',
    },
    {
      href: '/dealer',
      label: 'Dealer',
      icon: Contact,
      description: 'DealerNet · credenciales, RUT y Buscador Múltiple',
      badge: 'NEW',
    },
    {
      href: '/chile/tgr-dueno',
      label: 'TGR DUEÑO',
      icon: Receipt,
      description: 'Certificado de deuda TGR · Región Metropolitana',
      badge: 'NEW',
    },
    {
      href: '/settings',
      label: 'Subir datos SII',
      icon: Upload,
      description: 'Catastro por comuna · archivos SII',
    },
  ],
}

export default function Sidebar() {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()

  // País por pertenencia a los módulos, no por prefijo: /dealer y /settings son
  // módulos de Chile aunque su ruta no empiece con /chile — con el prefijo, al
  // entrar a ellos la sidebar saltaba a los módulos de España.
  const matchesModule = (m: ModuleItem) => pathname === m.href || pathname.startsWith(m.href + '/')
  const country: 'es' | 'cl' = pathname.startsWith('/chile') ? 'cl'
    : MODULES_BY_COUNTRY.es.some(matchesModule) ? 'es'
    : MODULES_BY_COUNTRY.cl.some(matchesModule) ? 'cl'
    : 'es'
  const modules = MODULES_BY_COUNTRY[country]
  const countryMeta = COUNTRIES.find((c) => c.id === country)!

  const activeHref = modules
    .filter((m) => pathname === m.href || pathname.startsWith(m.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <aside
      className="fixed top-0 left-0 h-screen flex flex-col z-[2000]"
      style={{ width: 'var(--sidebar-w)', background: 'var(--c-sidebar-bg)', borderRight: '1px solid var(--c-border-card)' }}
    >
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--c-border-card)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-brand flex items-center justify-center text-white text-xs font-bold">
            C
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100 leading-none">casafari</div>
            <div className="text-[10px] text-slate-500 leading-none mt-0.5">mio · {countryMeta.city}</div>
          </div>
        </div>
      </div>

      {/* Country switch */}
      <div className="px-2 pt-3">
        <div className="flex items-center gap-1 bg-[var(--c-card)] border border-[var(--c-border-card)] rounded-lg p-1">
          {COUNTRIES.map((c) => (
            <Link
              key={c.id}
              href={c.homeHref}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md transition-colors ${
                country === c.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>{c.flag}</span>
              {c.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
          Módulos
        </p>
        <ul className="space-y-0.5">
          {modules.map(({ href, label, icon: Icon, description, badge }) => {
            const active = href === activeHref
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all group ${
                    active
                      ? 'text-white'
                      : 'text-[#8892a4] hover:text-slate-200'
                  }`}
                  style={active
                    ? { background: 'var(--c-active)' }
                    : undefined
                  }
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--c-hover)' }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  <Icon
                    size={16}
                    className={active ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'}
                  />
                  <span className="flex-1 font-medium">{label}</span>
                  {badge && (
                    <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded">
                      {badge}
                    </span>
                  )}
                  {active && <ChevronRight size={12} className="text-blue-400" />}
                </Link>
                {active && (
                  <p className="px-3 pb-1 text-[11px] text-slate-600">{description}</p>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-2 py-3" style={{ borderTop: '1px solid var(--c-border-card)' }}>
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-slate-500 hover:text-slate-300 transition-all"
          style={{ marginBottom: '2px' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-hover)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
        >
          {theme === 'dark'
            ? <Sun size={16} className="text-amber-400" />
            : <Moon size={16} className="text-blue-400" />
          }
          <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
        </button>

        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-slate-600 hover:text-slate-300 transition-all"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-hover)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
        >
          <Settings size={16} />
          <span>Configuración</span>
        </Link>
        <p className="px-3 pt-2 text-[10px] text-slate-700">
          casafari-mio · {countryMeta.city}
        </p>
      </div>
    </aside>
  )
}
