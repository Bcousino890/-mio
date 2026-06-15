"use server";

import { requireStaff } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";

export type ImportFromUrlInput = {
  url: string;
};

export type ImportFromUrlResult =
  | { ok: true; slug: string; id: string }
  | { ok: false; error: string };

// Hosts soportados o reconocidos por el importador automático. Vacío hoy
// (no hay scrapers genéricos por URL aún). Cuando se implemente uno
// (idealista, fotocasa, etc.), añadirlo aquí + en el switch de abajo.
const SUPPORTED_HOSTS: ReadonlyArray<string> = [];

function detectSource(rawUrl: string): { host: string } | null {
  try {
    const u = new URL(rawUrl);
    return { host: u.host.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

/**
 * Importa una propiedad a partir de un enlace público (Idealista, Fotocasa,
 * web de agencia, etc.). Actualmente solo valida la URL y devuelve un error
 * "not_implemented" — el frontend muestra ese estado como "próximamente".
 *
 * Cuando se implemente el scraping por host, sustituir la sección marcada
 * con `// TODO: implementar` por la lógica concreta y devolver `{ ok: true }`.
 */
export async function importPropertyFromUrl(
  input: ImportFromUrlInput,
): Promise<ImportFromUrlResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const url = input.url.trim();
  if (!url) return { ok: false, error: "url_required" };

  const detected = detectSource(url);
  if (!detected) return { ok: false, error: "invalid_url" };

  // TODO: implementar — switch por `detected.host` para enrutar a un
  // scraper específico (idealista, fotocasa, …) que devuelva un
  // RawProperty, luego normalizar + insertar en BD.
  void SUPPORTED_HOSTS;

  // Por ahora devolvemos un error reconocible que el modal muestra como
  // "funcionalidad próxima". No tocamos BD.
  return { ok: false, error: "not_implemented" };
}
