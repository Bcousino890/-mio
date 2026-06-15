import { Settings } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { createAdminClient } from "@/lib/db/admin";
import { IdealistaConfigClient } from "./config-client";

export const dynamic = "force-dynamic";

export default async function IdealistaConfigPage() {
  const supabase = createAdminClient();

  const { data: configRow } = await (supabase
    .from("idealista_config")
    .select("feed_key, client_id, client_secret, sandbox_mode")
    .limit(1)
    .single() as any);

  const initialConfig = configRow
    ? {
        feedKey: (configRow as any).feed_key ?? "",
        clientId: (configRow as any).client_id ?? "",
        clientSecret: (configRow as any).client_secret ?? "",
        sandboxMode: (configRow as any).sandbox_mode ?? true,
      }
    : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="admin.nav.idealista"
        subtitleKey="Configuración de la API de Idealista"
      />

      <div className="mt-7 rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Settings size={20} className="text-gold" />
          <h2 className="font-serif text-lg font-semibold text-ink">
            Configuración API — Tester
          </h2>
        </div>
        <p className="mb-6 text-sm text-ink/60">
          Configura las credenciales OAuth de la Partner API de Idealista y prueba la conexión antes de activar la publicación automática.
        </p>

        <IdealistaConfigClient initialConfig={initialConfig} />
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
