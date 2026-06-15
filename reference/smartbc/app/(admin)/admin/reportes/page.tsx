import { getReportsStats } from "@/lib/db/queries/reports";
import { ReportesClient } from "./reportes-client";

export default async function AdminReportesPage() {
  const stats = await getReportsStats();
  return <ReportesClient stats={stats} />;
}
