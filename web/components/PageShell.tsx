interface Props {
  title: string
  subtitle?: string
  badge?: string
  children: React.ReactNode
  action?: React.ReactNode
}

export default function PageShell({ title, subtitle, badge, children, action }: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-[#1e2130]">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-100">{title}</h1>
              {badge && (
                <span className="text-[10px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded">
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action && <div>{action}</div>}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">{children}</div>
    </div>
  )
}
