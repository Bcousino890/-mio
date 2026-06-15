"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { AdminMensajesClient, type AdminConversation } from "./mensajes-admin-client";
import { TeamChat } from "./team-chat";

export function MensajesTabs({
  activeTab,
  conversations,
  activeId,
  messages,
  currentUserId,
}: {
  activeTab: "clientes" | "equipo";
  conversations: AdminConversation[];
  activeId: string | null;
  messages: NonNullable<AdminConversation["messages"]>;
  currentUserId: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-gold/15 bg-cream-50/60 p-1 w-fit">
        <Link
          href="/admin/mensajes"
          className={cn(
            "rounded-lg px-4 py-1.5 text-sm font-medium transition",
            activeTab === "clientes"
              ? "bg-ink text-cream-50 shadow-sm"
              : "text-ink/60 hover:text-ink hover:bg-white/60"
          )}
        >
          Clientes
        </Link>
        <Link
          href="/admin/mensajes?tab=equipo"
          className={cn(
            "rounded-lg px-4 py-1.5 text-sm font-medium transition",
            activeTab === "equipo"
              ? "bg-ink text-cream-50 shadow-sm"
              : "text-ink/60 hover:text-ink hover:bg-white/60"
          )}
        >
          Equipo
        </Link>
      </div>

      {/* Content */}
      {activeTab === "clientes" ? (
        <AdminMensajesClient
          conversations={conversations}
          activeId={activeId}
          messages={messages}
        />
      ) : (
        <TeamChat currentUserId={currentUserId} />
      )}
    </div>
  );
}
