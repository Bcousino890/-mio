import "server-only";
import { createClient } from "../server";

export async function getFavoriteSlugs(clientId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("favorites")
    .select("properties(slug)")
    .eq("client_id", clientId);

  if (error) throw error;
  return ((data ?? []) as Array<{ properties: { slug: string } | null }>)
    .map((r) => r.properties?.slug)
    .filter((s): s is string => !!s);
}

export async function getFavoriteProperties(clientId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("favorites")
    .select(
      "created_at, properties(*, agencies(name, slug), property_photos(url, is_cover, position))",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}
