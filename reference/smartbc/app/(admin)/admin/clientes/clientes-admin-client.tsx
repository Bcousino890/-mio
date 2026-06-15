"use client";

import { useMemo, useState } from "react";
import { ClientDetailPanel } from "@/components/admin/clientes/client-detail-panel";
import { ClientsTable } from "@/components/admin/clientes/clients-table";
import type { AdminClient } from "@/lib/types";

export function ClientesAdminClient({
  clients,
  totalClients,
}: {
  clients: AdminClient[];
  totalClients: number;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    clients[0]?.id,
  );

  const selected = useMemo(
    () => clients.find((c) => c.id === selectedId),
    [clients, selectedId],
  );

  return (
    <div className="mt-5 grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <ClientsTable
        clients={clients}
        totalClients={totalClients}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <ClientDetailPanel client={selected} />
    </div>
  );
}
