import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  detectAdvertiserFromHtml,
  fetchIdealistaPhoneViaAjax,
  normalizeSpanishPhone,
} from "@/lib/sync/particulares/idealista-advertiser-detector";
import { fetchViaCurl } from "@/lib/sync/import-by-link/fetch-via-curl";
import { getCurrentProfile } from "@/lib/db/queries/session";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — hasta 100 fichas por llamada

// Re-verificación de teléfonos de particulares. Tres modos:
// - mode=all      → re-scrapea anuncios ACTIVOS (tengan o no teléfono), los
//                   menos verificados primero (updated_at asc).
// - mode=missing  → solo activos sin teléfono (phone IS NULL).
// - mode=normalize → NO scrapea: recorre TODA la tabla y reescribe los
//                   teléfonos guardados al formato canónico +34XXXXXXXXX.
//
// Auth doble: sesión de staff (botón en el admin) O Bearer CRON_SECRET
// (cron/scripts del VPS).

// Tipo laxo para el cliente Supabase (mismo criterio que el cron de scrape:
// los genéricos del SDK no aportan aquí y casteamos puntualmente).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

// UA de WhatsApp: DataDome lo deja pasar (whitelist por los previews de
// links compartidos por WhatsApp).
const WHATSAPP_UA = "WhatsApp/2.23.20.0";

const STAFF_ROLES = [
  "owner",
  "admin",
  "advisor",
  "agent_admin",
  "agent_senior",
  "agent_junior",
];

// ─── Degradación elegante para la migración 0035 ─────────────────────────────
// La columna `phone_confidence` se añade en la migración 0035, que puede NO
// estar aplicada todavía en el VPS. Si el update falla por columna
// inexistente, reintenta UNA vez sin esa clave. (Mismo patrón que el helper
// withMigration0035Fallback del cron de scrape — duplicado aquí porque un
// route.ts de Next solo puede exportar los campos de ruta válidos.)

function isMissingPhoneConfidenceError(
  error: { message?: string } | null | undefined,
): boolean {
  const msg = error?.message ?? "";
  return (
    /column|does not exist|schema cache/i.test(msg) &&
    msg.includes("phone_confidence")
  );
}

async function updateWithMigration0035Fallback(
  supabase: SupabaseLike,
  id: string,
  values: Record<string, unknown>,
): Promise<{ error: { message?: string } | null }> {
  const first = await supabase.from("particulares").update(values).eq("id", id);
  if (first.error && isMissingPhoneConfidenceError(first.error)) {
    console.warn(
      "[verify-phones] Migración 0035 no aplicada — reintentando sin phone_confidence",
    );
    const stripped = { ...values };
    delete stripped.phone_confidence;
    return supabase.from("particulares").update(stripped).eq("id", id);
  }
  return first;
}

// ─── Auth: sesión de staff O Bearer CRON_SECRET ──────────────────────────────

async function isAuthorized(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`
  ) {
    return true;
  }
  try {
    const profile = await getCurrentProfile();
    return !!profile && STAFF_ROLES.includes(profile.role as string);
  } catch {
    return false;
  }
}

type VerifyResponse = {
  ok: boolean;
  mode: string;
  checked: number;
  updated: number;
  normalized?: number;
  withPhone: number;
  chatOnly: number;
  errors: number;
  // Teléfono encontrado (solo en verificación de un anuncio concreto, para
  // que el cliente actualice la UI sin recargar).
  foundPhone?: string | null;
};

type ParticularRow = {
  id: string;
  source_url: string;
  phone: string | null;
};

// ─── mode=all / mode=missing: re-scrapear y actualizar ───────────────────────

async function verifyByScraping(
  supabase: SupabaseLike,
  mode: "all" | "missing",
  limit: number,
  onlyId?: string | null,
): Promise<VerifyResponse> {
  // Activos, los menos verificados primero (updated_at asc). En "missing"
  // solo los que no tienen teléfono. Con `onlyId`, ese anuncio concreto
  // (botón "Verificar teléfono" del modal).
  let query = supabase
    .from("particulares")
    .select("id, source_url, phone")
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (onlyId) {
    query = query.eq("id", onlyId);
  } else {
    query = query.eq("is_active", true);
    if (mode === "missing") {
      query = query.is("phone", null);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[verify-phones] Error listando particulares:", error);
    return {
      ok: false,
      mode,
      checked: 0,
      updated: 0,
      withPhone: 0,
      chatOnly: 0,
      errors: 1,
    };
  }

  const rows = (data ?? []) as ParticularRow[];
  const result: VerifyResponse = {
    ok: true,
    mode,
    checked: 0,
    updated: 0,
    withPhone: 0,
    chatOnly: 0,
    errors: 0,
  };

  for (const row of rows) {
    result.checked++;
    const now = new Date().toISOString();

    try {
      const res = await fetchViaCurl(row.source_url, WHATSAPP_UA, {
        proxyUrl: process.env.SMARTPROXY_URL,
      });
      if (!res.ok) {
        console.warn(
          `[verify-phones] fetch ${row.source_url} -> ${res.reason}`,
        );
        result.errors++;
        continue;
      }

      const info = detectAdvertiserFromHtml(res.html);
      // El detector ya devuelve el teléfono normalizado a +34XXXXXXXXX;
      // re-normalizamos por si acaso (idempotente).
      let phone = normalizeSpanishPhone(info.phone);
      let confidence = info.phone_confidence ?? null;

      // Fallback "Ver teléfono": muchos anuncios NO traen el teléfono en el
      // HTML — solo se revela vía AJAX al pulsar el botón. Si el HTML no dio
      // teléfono, llamamos a los endpoints AJAX de contacto de Idealista
      // (vía curl, mismo bypass de DataDome).
      if (!phone) {
        const adIdMatch = row.source_url.match(/\/inmueble\/(\d+)/);
        if (adIdMatch?.[1]) {
          const ajax = await fetchIdealistaPhoneViaAjax(adIdMatch[1], {
            proxyUrl: process.env.SMARTPROXY_URL,
          });
          if (ajax.phone) {
            phone = ajax.phone;
            confidence = ajax.phone_confidence;
          }
        }
      }

      let values: Record<string, unknown>;
      if (phone) {
        // Teléfono encontrado → guardar normalizado con su confianza.
        values = {
          phone,
          phone_confidence: confidence,
          chat_only: false,
          updated_at: now,
        };
        result.withPhone++;
        result.foundPhone = phone;
      } else if (!row.phone) {
        // Sin teléfono ahora ni antes → solo contactable por chat del portal.
        values = { chat_only: true, updated_at: now };
        result.chatOnly++;
      } else {
        // No se encontró pero ya tenía → conservar el existente, solo
        // refrescar updated_at para que rote al final de la cola.
        values = { updated_at: now };
      }

      const { error: updateError } = await updateWithMigration0035Fallback(
        supabase,
        row.id,
        values,
      );
      if (updateError) {
        console.error("[verify-phones] Error actualizando:", updateError);
        result.errors++;
        continue;
      }
      // Cuenta como actualizado si escribimos algo material (teléfono nuevo
      // o chat_only); el refresco de solo updated_at no cuenta.
      if (phone || !row.phone) {
        result.updated++;
      }
      // Historial: teléfono descubierto en un anuncio que no lo tenía.
      if (phone && !row.phone) {
        await supabase.from("particulares_changes").insert({
          particular_id: row.id,
          change_type: "phone_added",
          old_value: null,
          new_value: { phone },
          changed_at: now,
        });
      }
    } catch (err) {
      console.error(
        `[verify-phones] Error procesando ${row.source_url}:`,
        err,
      );
      result.errors++;
    }
  }

  return result;
}

// ─── mode=normalize: reescribir los teléfonos guardados a +34 ────────────────
// No scrapea nada: recorre TODA la tabla por lotes de 1000 (límite de filas
// de PostgREST) y reescribe cada phone al formato canónico. Si un teléfono
// guardado no es normalizable (basura, referencia…), se deja como está.

async function normalizeStoredPhones(
  supabase: SupabaseLike,
): Promise<VerifyResponse> {
  const result: VerifyResponse = {
    ok: true,
    mode: "normalize",
    checked: 0,
    updated: 0,
    normalized: 0,
    withPhone: 0,
    chatOnly: 0,
    errors: 0,
  };

  const BATCH = 1000;
  for (let offset = 0; ; offset += BATCH) {
    const { data, error } = await supabase
      .from("particulares")
      .select("id, phone")
      .not("phone", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) {
      console.error("[verify-phones] Error paginando particulares:", error);
      result.ok = false;
      result.errors++;
      break;
    }

    const rows = (data ?? []) as Array<{ id: string; phone: string | null }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      result.checked++;
      if (row.phone) result.withPhone++;

      const normalized = normalizeSpanishPhone(row.phone);
      // No normalizable (basura/referencia) o ya canónico → no tocar.
      if (!normalized || normalized === row.phone) continue;

      const { error: updateError } = await supabase
        .from("particulares")
        .update({ phone: normalized, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updateError) {
        console.error("[verify-phones] Error normalizando:", updateError);
        result.errors++;
        continue;
      }
      result.updated++;
      result.normalized = (result.normalized ?? 0) + 1;
    }

    if (rows.length < BATCH) break;
  }

  return result;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const modeParam = searchParams.get("mode") ?? "all";
  if (!["all", "missing", "normalize"].includes(modeParam)) {
    return Response.json(
      { ok: false, error: "mode debe ser all | missing | normalize" },
      { status: 400 },
    );
  }
  // Nº de anuncios a scrapear por llamada (no aplica a normalize).
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "30", 10) || 30),
  );
  // Verificación de UN anuncio concreto (botón del modal en el admin).
  const onlyId = searchParams.get("id");
  // Modo diagnóstico: ?debug=1&id=<uuid> devuelve lo que respondió cada
  // endpoint AJAX de Idealista (status + trozo del cuerpo) SIN guardar nada.
  const debug = searchParams.get("debug") === "1";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // ── Diagnóstico de un anuncio: ver qué devuelven los endpoints AJAX ──
  if (debug && onlyId) {
    const { data } = await supabase
      .from("particulares")
      .select("id, source_url, phone")
      .eq("id", onlyId)
      .maybeSingle();
    const sourceUrl = (data as { source_url?: string } | null)?.source_url;
    const adId = sourceUrl?.match(/\/inmueble\/(\d+)/)?.[1];
    if (!adId) {
      return Response.json(
        { ok: false, error: "no_ad_id", sourceUrl },
        { status: 200 },
      );
    }
    const ajax = await fetchIdealistaPhoneViaAjax(adId, {
      proxyUrl: process.env.SMARTPROXY_URL,
      debug: true,
    });
    return Response.json(
      {
        ok: true,
        adId,
        sourceUrl,
        phoneFound: ajax.phone,
        attempts: ajax.debug ?? [],
      },
      { status: 200 },
    );
  }

  try {
    console.log(
      `[verify-phones] Iniciando mode=${modeParam}${modeParam === "normalize" ? "" : ` limit=${limit}`}`,
    );
    const result =
      modeParam === "normalize"
        ? await normalizeStoredPhones(supabase)
        : await verifyByScraping(
            supabase,
            modeParam as "all" | "missing",
            limit,
            onlyId,
          );

    return Response.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    console.error("[verify-phones] Error:", error);
    return Response.json(
      {
        ok: false,
        mode: modeParam,
        checked: 0,
        updated: 0,
        withPhone: 0,
        chatOnly: 0,
        errors: 1,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
