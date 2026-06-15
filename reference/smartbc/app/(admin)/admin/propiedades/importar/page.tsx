import { Link2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { getAgencies } from "@/lib/db/queries/agencies";
import { ImportByLinkClient } from "./import-by-link-client";

export default async function AdminImportByLinkPage() {
  const agencyRows = await getAgencies();
  const agencies = ((agencyRows ?? []) as Array<{
    slug: string;
    name: string;
  }>).map((a) => ({ slug: a.slug, name: a.name }));

  return (
    <div className="mx-auto flex min-h-screen max-w-[1100px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="adminProps.title"
        subtitleKey="adminProps.subtitle"
        welcome={false}
      />

      <section className="mt-7 rounded-2xl border border-gold/15 bg-cream-50/85 p-6 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-8">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-full bg-gold/10 p-2 text-gold">
            <Link2 size={18} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="font-serif text-xl font-medium text-ink">
              Importar propiedad por link
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              Pega el enlace público de la propiedad y la traemos
              automáticamente. Funciona con enlaces de Idealista, Fotocasa,
              webs sobre Inmoweb y otros portales (con extractor genérico).
            </p>
          </div>
        </div>

        <ImportByLinkClient agencies={agencies} />
      </section>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
