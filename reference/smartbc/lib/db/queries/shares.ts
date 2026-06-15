import "server-only";
import { createAdminClient } from "../admin";

export type ShareWithStats = {
  id: string;
  token: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  opens_count: number;
  last_opened_at: string | null;
};

// Lista los SmartLinks de una propiedad con su contador de aperturas y
// la última apertura. Hacemos dos queries (shares + opens) y agregamos
// en memoria; es mucho más simple que SQL con joins agregados y para
// volúmenes pequeños (decenas de links por propiedad) es perfecto.
export async function getSharesForProperty(
  propertyId: string,
): Promise<ShareWithStats[]> {
  const supabase = createAdminClient();

  const sharesRes = await supabase
    .from("property_shares")
    .select("id, token, label, created_at, expires_at")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });
  if (sharesRes.error) throw new Error(sharesRes.error.message);
  const shares = (sharesRes.data ?? []) as Array<{
    id: string;
    token: string;
    label: string | null;
    created_at: string;
    expires_at: string | null;
  }>;
  if (shares.length === 0) return [];

  const opensRes = await supabase
    .from("property_share_opens")
    .select("share_id, opened_at")
    .in(
      "share_id",
      shares.map((s) => s.id),
    );
  if (opensRes.error) throw new Error(opensRes.error.message);
  const opens = (opensRes.data ?? []) as Array<{
    share_id: string;
    opened_at: string;
  }>;

  const counts = new Map<string, { count: number; last: string | null }>();
  for (const o of opens) {
    const entry = counts.get(o.share_id) ?? { count: 0, last: null };
    entry.count++;
    if (!entry.last || o.opened_at > entry.last) entry.last = o.opened_at;
    counts.set(o.share_id, entry);
  }

  return shares.map((s) => ({
    ...s,
    opens_count: counts.get(s.id)?.count ?? 0,
    last_opened_at: counts.get(s.id)?.last ?? null,
  }));
}

// Resolver un token a la propiedad asociada. Pública (sin auth) — se usa
// en la ruta /c/[token]. Devuelve también el share_id para registrar la
// apertura. Filtra shares expirados.
export async function getPropertyByShareToken(
  token: string,
): Promise<{
  shareId: string;
  property: Record<string, unknown>;
} | null> {
  const supabase = createAdminClient();

  const shareRes = await supabase
    .from("property_shares")
    .select("id, property_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (shareRes.error) throw new Error(shareRes.error.message);
  const share = shareRes.data as {
    id: string;
    property_id: string;
    expires_at: string | null;
  } | null;
  if (!share) return null;
  if (share.expires_at && new Date(share.expires_at) < new Date()) return null;

  const propRes = await supabase
    .from("properties")
    .select("*, property_photos(*), agencies(name, slug, logo_url)")
    .eq("id", share.property_id)
    .is("archived_at", null)
    .neq("status", "archived")
    .maybeSingle();
  if (propRes.error) throw new Error(propRes.error.message);
  if (!propRes.data) return null;

  return { shareId: share.id, property: propRes.data };
}

// Registrar una apertura. Llamado desde /c/[token] tras resolver el
// token. Async-fire: no bloqueamos el render si falla.
export async function recordShareOpen(params: {
  shareId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const supabase = createAdminClient();
  const opensTbl = supabase.from("property_share_opens") as unknown as {
    insert: (payload: Record<string, unknown>) => Promise<{
      error: { message: string } | null;
    }>;
  };
  await opensTbl.insert({
    share_id: params.shareId,
    ip: params.ip,
    user_agent: params.userAgent,
  });
}
