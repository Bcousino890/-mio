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
  Settings,
  ChevronRight,
} from 'lucide-react'

const modules = [
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
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="fixed top-0 left-0 h-screen flex flex-col z-[2000]"
      style={{ width: 'var(--sidebar-w)', background: '#0f1117', borderRight: '1px solid #1e2130' }}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[#1e2130]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-brand flex items-center justify-center text-white text-xs font-bold">
            C
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100 leading-none">casafari</div>
            <div className="text-[10px] text-slate-500 leading-none mt-0.5">mio · Madrid</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
          Módulos
        </p>
        <ul className="space-y-0.5">
          {modules.map(({ href, label, icon: Icon, description, badge }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all group ${
                    active
                      ? 'bg-[#1e2a45] text-white'
                      : 'text-[#8892a4] hover:bg-[#1a1f2e] hover:text-slate-200'
                  }`}
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
      <div className="px-2 py-3 border-t border-[#1e2130]">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-slate-600 hover:bg-[#1a1f2e] hover:text-slate-300 transition-all"
        >
          <Settings size={16} />
          <span>Configuración</span>
        </Link>
        <p className="px-3 pt-2 text-[10px] text-slate-700">
          DB: 204.168.174.0:5433
        </p>
      </div>
    </aside>
  )
}
