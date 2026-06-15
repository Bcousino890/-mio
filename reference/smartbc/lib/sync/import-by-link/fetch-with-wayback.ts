import "server-only";
import type { ImportExtractError } from "./types";

// Fallback final para portales con anti-bot fuerte (Idealista/DataDome).
// Pide el HTML al snapshot de Wayback Machine en lugar de al sitio original.
// El HTML llega completo (las páginas dinámicas se renderizaron cuando el
// crawler las archivó), así que el extractor puede parsearlo sin cambios.
// Limpiamos las URLs de assets para que apunten al CDN público original
// (Idealista expone las fotos en `img4.idealista.com/blur/...` sin DataDome).
//
// Limitaciones:
// - Snapshot puede ser viejo (precio/disponibilidad desactualizados).
// - Save-on-demand puede fallar si Wayback recibe 403 al archivar.
// - No todas las propiedades tienen snapshot disponible.

const WAYBACK_AVAILABLE_API = "https://archive.org/wayback/available";
const WAYBACK_SAVE_BASE = "https://web.archive.org/save";
const TIMEOUT_MS = 30_000;
const SAVE_TIMEOUT_MS = 60_000;

export type WaybackFetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; error: ImportExtractError };

// Elimina los prefijos que Wayback inyecta en las URLs de assets dentro del
// HTML archivado. Ejemplos:
//   https://web.archive.org/web/20260527162514im_/https://img4.idealista.com/...
//   → https://img4.idealista.com/...
//   https://web.archive.org/web/20260527162514/https://www.idealista.com/...
//   → https://www.idealista.com/...
function stripWaybackPrefixes(html: string): string {
  // Wayback usa sufijos `im_`, `cs_`, `js_`, etc. tras el timestamp para
  // distinguir tipo de recurso. Capturamos todos.
  return html.replace(
    /https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\//g,
    "",
  );
}

async function fetchHtmlText(
  url: string,
  timeoutMs: number,
): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; reason: string; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "smartbc-bot/1.0 (contacto@bcousinoprop.com)",
      },
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}`, status: res.status };
    }
    const html = await res.text();
    if (!html || html.length < 200) {
      return { ok: false, reason: "HTML vacío" };
    }
    return { ok: true, html, finalUrl: res.url || url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error de red";
    return { ok: false, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHtmlWithWayback(
  url: string,
): Promise<WaybackFetchResult> {
  console.log(`[wayback] Intentando snapshot para ${url}`);

  // 1) Consultar si existe snapshot reciente.
  const apiUrl = `${WAYBACK_AVAILABLE_API}?url=${encodeURIComponent(url)}`;
  let snapshotUrl: string | null = null;
  try {
    const apiRes = await fetch(apiUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (apiRes.ok) {
      const data = (await apiRes.json()) as {
        archived_snapshots?: { closest?: { url?: string; available?: boolean } };
      };
      const closest = data.archived_snapshots?.closest;
      if (closest?.available && closest.url) {
        snapshotUrl = closest.url;
        console.log(`[wayback] Snapshot existente: ${snapshotUrl}`);
      }
    }
  } catch (err) {
    console.log(
      `[wayback] Error consultando API: ${err instanceof Error ? err.message : "desconocido"}`,
    );
  }

  // 2) Si no hay snapshot, pedir save-on-demand. Wayback intenta archivar
  //    la URL en ese momento; puede fallar si el portal le devuelve 403.
  if (!snapshotUrl) {
    console.log(`[wayback] Sin snapshot, intentando save-on-demand`);
    const saveUrl = `${WAYBACK_SAVE_BASE}/${url}`;
    const saveRes = await fetchHtmlText(saveUrl, SAVE_TIMEOUT_MS);
    if (!saveRes.ok) {
      console.log(`[wayback] ✗ save-on-demand falló: ${saveRes.reason}`);
      return {
        ok: false,
        error: {
          kind: "blocked",
          reason: `wayback: sin snapshot y save-on-demand falló (${saveRes.reason})`,
        },
      };
    }
    // El save-on-demand redirige al snapshot recién creado; tomamos esa URL.
    snapshotUrl = saveRes.finalUrl;
    console.log(`[wayback] ✓ save-on-demand creó snapshot: ${snapshotUrl}`);
    // Limpieza + devolver inmediato; ya tenemos el HTML.
    return {
      ok: true,
      html: stripWaybackPrefixes(saveRes.html),
      finalUrl: url,
    };
  }

  // 3) Descargar el HTML del snapshot.
  const snapRes = await fetchHtmlText(snapshotUrl, TIMEOUT_MS);
  if (!snapRes.ok) {
    console.log(`[wayback] ✗ snapshot descarga falló: ${snapRes.reason}`);
    return {
      ok: false,
      error: {
        kind: "fetch_failed",
        status: snapRes.status ?? 0,
        reason: `wayback: ${snapRes.reason}`,
      },
    };
  }
  console.log(`[wayback] ✓ HTML descargado (${snapRes.html.length} bytes)`);
  return {
    ok: true,
    html: stripWaybackPrefixes(snapRes.html),
    finalUrl: url,
  };
}
