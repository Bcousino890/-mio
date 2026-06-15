import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { DiagnosticoClient } from "./diagnostico-client";

export default function AdminDiagnosticoPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1100px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="Diagnóstico de usuarios"
        subtitleKey="Revisa por qué no aparecen los usuarios y corrígelo con un clic."
      />

      <DiagnosticoClient />

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
