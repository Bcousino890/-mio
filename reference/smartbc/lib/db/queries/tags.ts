import "server-only";
import { createClient } from "../server";

export async function getTags() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_tags")
    .select("*")
    .order("category", { nullsFirst: true })
    .order("name");

  if (error) throw error;
  return data;
}
