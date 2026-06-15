import { redirect } from "next/navigation";
import { PerfilClient } from "./perfil-client";
import { createClient } from "@/lib/db/server";
import { getCurrentUser } from "@/lib/db/queries/session";
import type { ClientPreferences, ClientProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
});

export default async function PerfilPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [profileResult, prefsResult, tagResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("client_preferences")
      .select("*")
      .eq("client_id", user.id)
      .maybeSingle(),
    supabase
      .from("client_tag_assignments")
      .select("client_tags(name)")
      .eq("client_id", user.id),
  ]);

  const profileRow = profileResult.data as
    | {
        full_name: string | null;
        email: string;
        phone: string | null;
        created_at: string;
      }
    | null;
  const prefsRow = prefsResult.data as
    | {
        operation: "rent" | "sale" | null;
        stay: "short" | "long" | null;
        min_bedrooms: number | null;
        min_price: number | null;
        max_price: number | null;
        zones: string[];
      }
    | null;
  const tagRows = (tagResult.data ?? []) as Array<{
    client_tags: { name: string } | null;
  }>;

  const fullName = profileRow?.full_name?.trim() || profileRow?.email || "";
  const [firstName, ...rest] = fullName.split(/\s+/);

  const preferences: ClientPreferences = {
    bedrooms: prefsRow?.min_bedrooms ?? undefined,
    budgetMin: prefsRow?.min_price ?? undefined,
    budgetMax: prefsRow?.max_price ?? undefined,
    stayType: prefsRow?.stay === "long" ? "larga" : "corta",
    operation: prefsRow?.operation === "sale" ? "venta" : "alquiler",
    preferredZones: prefsRow?.zones ?? [],
  };

  const profile: ClientProfile = {
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    email: profileRow?.email ?? "",
    phone: profileRow?.phone ?? "",
    preferredLanguage: "es",
    memberSince: profileRow?.created_at
      ? capitalize(
          DATE_FORMATTER.format(new Date(profileRow.created_at)),
        )
      : "—",
    preferences,
    shopperTagKeys: tagRows
      .map((r) => r.client_tags?.name)
      .filter((n): n is string => !!n),
  };

  return <PerfilClient profile={profile} />;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
