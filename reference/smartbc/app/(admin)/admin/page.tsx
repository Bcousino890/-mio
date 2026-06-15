import { CalendarClock, Home, Send, Users } from "lucide-react";
import Link from "next/link";
import { getDashboardData } from "@/lib/db/queries/dashboard";

function formatPrice(price: number | null, operation: string | null) {
  if (price == null) return "—";
  const formatted = new Intl.NumberFormat("es-ES").format(price);
  return operation === "rent" ? `${formatted} €/mes` : `${formatted} €`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const STATUS_VISIT_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  rescheduled: "Reprogramada",
  rejected: "Rechazada",
  completed: "Completada",
};

const STATUS_VISIT_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border border-amber-200",
  confirmed: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  rescheduled: "bg-blue-100 text-blue-800 border border-blue-200",
  rejected: "bg-red-100 text-red-800 border border-red-200",
  completed: "bg-ink/10 text-ink/60 border border-ink/15",
};

const STATUS_PROP_LABELS: Record<string, string> = {
  available: "Disponible",
  reserved: "Reservada",
  rented: "Alquilada",
  sold: "Vendida",
  draft: "Borrador",
};

const STATUS_PROP_COLORS: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  reserved: "bg-amber-100 text-amber-800 border border-amber-200",
  rented: "bg-blue-100 text-blue-800 border border-blue-200",
  sold: "bg-purple-100 text-purple-800 border border-purple-200",
  draft: "bg-ink/10 text-ink/60 border border-ink/15",
};

export default async function AdminDashboardPage() {
  const data = await getDashboardData();
  const { kpis, recentProperties, recentVisits } = data;

  const kpiItems = [
    {
      label: "PROPIEDADES ACTIVAS",
      value: kpis.activeProperties,
      icon: Home,
    },
    {
      label: "CLIENTES",
      value: kpis.totalClients,
      icon: Users,
    },
    {
      label: "VISITAS PENDIENTES",
      value: kpis.pendingVisits,
      icon: CalendarClock,
    },
    {
      label: "SMARTLINKS",
      value: kpis.smartLinks,
      icon: Send,
    },
  ];

  return (
    <div className="space-y-8 p-6 lg:p-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-ink/55">
          Resumen general de la actividad del CRM
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiItems.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
                {label}
              </span>
              <div className="rounded-lg bg-gold/10 p-2 text-gold">
                <Icon size={16} />
              </div>
            </div>
            <p className="mt-3 text-3xl font-bold text-ink">{value}</p>
          </div>
        ))}
      </div>

      {/* Tables row */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Últimas propiedades */}
        <section className="rounded-2xl border border-gold/15 bg-cream-50/85 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-gold/10 px-5 py-4">
            <h2 className="text-sm font-semibold text-ink">
              Últimas propiedades
            </h2>
            <Link
              href="/admin/propiedades"
              className="text-[11px] font-medium text-gold hover:underline"
            >
              Ver todas →
            </Link>
          </div>
          {recentProperties.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink/45">
              Sin propiedades aún.
            </p>
          ) : (
            <div className="divide-y divide-gold/8">
              {recentProperties.map((prop) => (
                <Link
                  key={prop.id}
                  href={`/admin/propiedades/${prop.slug}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-gold/5"
                >
                  {/* Miniatura */}
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-ink/8">
                    {prop.cover_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={prop.cover_photo_url}
                        alt={prop.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ink/30">
                        <Home size={16} />
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {prop.title}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-ink/50">
                      {prop.zone ?? "—"}
                      {prop.bc_reference ? ` · Ref. ${prop.bc_reference}` : ""}
                    </p>
                  </div>
                  {/* Precio + estado */}
                  <div className="shrink-0 text-right">
                    <p className="text-[12px] font-semibold text-ink">
                      {formatPrice(prop.price, prop.operation)}
                    </p>
                    {prop.status && (
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_PROP_COLORS[prop.status] ?? "bg-ink/10 text-ink/60"}`}
                      >
                        {STATUS_PROP_LABELS[prop.status] ?? prop.status}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Últimas solicitudes */}
        <section className="rounded-2xl border border-gold/15 bg-cream-50/85 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-gold/10 px-5 py-4">
            <h2 className="text-sm font-semibold text-ink">
              Últimas solicitudes de visita
            </h2>
            <Link
              href="/admin/solicitudes"
              className="text-[11px] font-medium text-gold hover:underline"
            >
              Ver todas →
            </Link>
          </div>
          {recentVisits.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink/45">
              Sin solicitudes aún.
            </p>
          ) : (
            <div className="divide-y divide-gold/8">
              {recentVisits.map((visit) => (
                <div
                  key={visit.id}
                  className="flex items-center gap-4 px-5 py-3.5"
                >
                  {/* Avatar inicial */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/10 text-[13px] font-semibold text-gold">
                    {visit.profiles?.full_name
                      ? visit.profiles.full_name.charAt(0).toUpperCase()
                      : "?"}
                  </div>
                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {visit.profiles?.full_name ??
                        visit.profiles?.email ??
                        "Cliente desconocido"}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-ink/50">
                      {visit.properties?.title ?? "Propiedad eliminada"}
                      {visit.properties?.bc_reference
                        ? ` · Ref. ${visit.properties.bc_reference}`
                        : ""}
                    </p>
                  </div>
                  {/* Fecha + badge */}
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-ink/45">
                      {formatDate(visit.created_at)}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_VISIT_COLORS[visit.status] ?? "bg-ink/10 text-ink/60"}`}
                    >
                      {STATUS_VISIT_LABELS[visit.status] ?? visit.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
