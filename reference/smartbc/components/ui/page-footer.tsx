"use client";

import { ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/provider";

type Props = {
  /**
   * i18n key for the footer text. Common values:
   *  - "login.footer" (cliente pages)
   *  - "admin.realtime.footer" (admin pages)
   *  - "detail.footer" (property detail)
   */
  textKey: string;
  /**
   * Visual variant:
   *  - "stacked"  → shield on its own line, text below (default for cliente pages)
   *  - "inline"   → small shield + text on the same line (default for admin pages)
   */
  variant?: "stacked" | "inline";
  className?: string;
};

export function PageFooter({ textKey, variant = "stacked", className }: Props) {
  const t = useT();

  if (variant === "inline") {
    return (
      <div
        className={
          className ??
          "mt-10 flex flex-col items-center border-t border-gold/15 pt-5"
        }
      >
        <div className="flex items-center gap-2 text-[12px] text-ink/55">
          <ShieldCheck size={14} strokeWidth={1.5} className="text-gold" />
          <span>{t(textKey)}</span>
        </div>
      </div>
    );
  }

  // stacked
  return (
    <div
      className={
        className ??
        "mt-12 flex flex-col items-center border-t border-gold/15 pt-6"
      }
    >
      <ShieldCheck size={16} strokeWidth={1.5} className="text-gold" />
      <p className="mt-2 text-center text-xs text-ink/55">{t(textKey)}</p>
    </div>
  );
}
