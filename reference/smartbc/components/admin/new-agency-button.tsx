"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { NewAgencyModal } from "@/components/admin/new-agency-modal";
import { useT } from "@/lib/i18n/provider";

export function NewAgencyButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-[13px] font-medium text-cream-50 transition hover:bg-ink-soft"
      >
        <Plus size={15} strokeWidth={1.75} className="text-gold" />
        <span>{t("agencias.new.button")}</span>
      </button>

      <NewAgencyModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
