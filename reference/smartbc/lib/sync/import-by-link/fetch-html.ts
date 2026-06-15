import "server-only";
import { ProxyAgent } from "undici";
import { fetchHtmlWithPlaywright } from "./fetch-with-playwright";
import { fetchHtmlWithWayback } from "./fetch-with-wayback";
import { fetchViaCurl } from "./fetch-via-curl";
import type { ImportExtractError } from "./types";

// Hosts donde merece la pena intentar el fallback final de Wayback Machine
// cuando todos los demás métodos fallan. Solo Idealista por ahora — su
// anti-bot DataDome no se pasa ni con proxy residencial + Playwright +
// stealth. Wayback sirve snapshots del HTML que el extractor parsea igual.
const WAYBACK_FALLBACK_HOSTS = ["idealista.com", "www.idealista.com"];

function shouldTryWayback(url: string): boolean {
  try {
    const host = new URL(url).host;
    return WAYBACK_FALLBACK_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}

// Fetcher de HTML para extractores. Manda UA + headers de navegador real
// porque los portales rechazan agresivamente UAs vacíos o bot-friendly.
// Si recibe 403/429, reintenenta automáticamente con proxy residencial.

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: HeadersInit = {
  "User-Agent": BROWSER_UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const TIMEOUT_MS = 20_000;
const PROXY_URL = process.env.SMARTPROXY_URL;

// User-Agent del bot de WhatsApp. DataDome (el anti-bot de Idealista) lo
// tiene en whitelist porque en España se comparten masivamente links de
// Idealista por WhatsApp y bloquear sus previews rompería esa función.
// Resultado: con este UA, un fetch directo (sin proxy ni navegador) pasa
// el anti-bot de Idealista de forma 100% consistente y devuelve el HTML
// SSR completo (con `multimediaCarrousel` y todos los datos). Verificado
// en 5/5 llamadas contra varios pisos.
const WHATSAPP_UA = "WhatsApp/2.23.20.0";

// Hosts donde conviene intentar primero con el UA de WhatsApp.
const WHATSAPP_UA_HOSTS = ["idealista.com", "www.idealista.com"];

function shouldTryWhatsAppUA(url: string): boolean {
  try {
    const host = new URL(url).host;
    return WHATSAPP_UA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Detecta redirects "anti-bot": el portal devuelve 200 OK pero la URL
// final NO conserva el ID numérico de la URL original. Pasa con Fotocasa
// (redirige a `/viviendas/.../todas-las-zonas/l`) y portales similares
// cuando sospechan que somos un bot pero no quieren mandar un 403 limpio.
// Tratamos esto como "blocked" para que el flow caiga al siguiente método
// (proxy → Playwright).
function isAntibotRedirect(originalUrl: string, finalUrl: string): boolean {
  // IDs numéricos de 6+ dígitos. Cubre Idealista, Fotocasa, Inmoweb.
  const inputIds = originalUrl.match(/\/(\d{6,})\b/g);
  if (!inputIds || inputIds.length === 0) return false;
  return !inputIds.some((id) => finalUrl.includes(id));
}

export type FetchHtmlResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; error: ImportExtractError };

async function tryFetch(
  url: string,
  dispatcher?: ProxyAgent,
  // Si se pasa, REEMPLAZA por completo los DEFAULT_HEADERS (no hace merge).
  // Necesario para el UA de WhatsApp: DataDome detecta la incoherencia si
  // ve UA de WhatsApp junto a headers de navegador (Sec-Fetch-*, Accept
  // text/html, Upgrade-Insecure-Requests…). WhatsApp manda un set mínimo.
  customHeaders?: Record<string, string>,
): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: customHeaders ?? DEFAULT_HEADERS,
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      ...(dispatcher && { dispatcher }),
    });
    const finalUrl = res.url || url;

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        return {
          ok: false,
          error: {
            kind: "blocked",
            reason: `HTTP ${res.status}`,
          },
        };
      }
      return {
        ok: false,
        error: {
          kind: "fetch_failed",
          status: res.status,
          reason: `HTTP ${res.status} ${res.statusText}`,
        },
      };
    }

    const ct = res.headers.get("content-type") ?? "";
    if (ct && !ct.toLowerCase().includes("html") && !ct.toLowerCase().includes("xml")) {
      return {
        ok: false,
        error: {
          kind: "fetch_failed",
          status: res.status,
          reason: `respuesta no HTML (${ct})`,
        },
      };
    }

    const html = await res.text();
    if (!html || html.length < 200) {
      return {
        ok: false,
        error: {
          kind: "parse_failed",
          reason: "HTML vacío o demasiado corto",
        },
      };
    }
    // Si el portal nos redirigió silenciosamente a una página de listado
    // (status 200 pero URL distinta sin el ID del anuncio), tratamos
    // como bloqueo para que el caller intente proxy/Playwright.
    if (isAntibotRedirect(url, finalUrl)) {
      return {
        ok: false,
        error: {
          kind: "blocked",
          reason: `redirect anti-bot: → ${finalUrl}`,
        },
      };
    }
    return { ok: true, html, finalUrl };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: {
          kind: "fetch_failed",
          status: 0,
          reason: `timeout tras ${TIMEOUT_MS / 1000}s`,
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "fetch_failed",
        status: 0,
        reason: err instanceof Error ? err.message : "error de red",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// Antes de rendirnos con un "blocked", intentamos Wayback Machine para
// hosts donde sabemos que el anti-bot es prácticamente imposible de
// pasar gratis (Idealista). El HTML del snapshot tiene los mismos
// selectores y nuestro extractor lo parsea sin cambios.
async function maybeTryWayback(
  url: string,
  prevReason: string,
): Promise<FetchHtmlResult> {
  if (!shouldTryWayback(url)) {
    return {
      ok: false,
      error: { kind: "blocked", reason: prevReason },
    };
  }
  console.log(`[fetch-html] Intento 4: Wayback Machine`);
  const waybackResult = await fetchHtmlWithWayback(url);
  if (waybackResult.ok) {
    console.log(`[fetch-html] ✓ Wayback exitoso`);
    return waybackResult;
  }
  console.log(`[fetch-html] ✗ Wayback falló: ${waybackResult.error.reason}`);
  return {
    ok: false,
    error: {
      kind: "blocked",
      reason: `${prevReason} | Wayback: ${waybackResult.error.reason}`,
    },
  };
}

export async function fetchHtml(url: string): Promise<FetchHtmlResult> {
  console.log(`[fetch-html] Iniciando para ${url}`);

  // Intento 0 (solo Idealista): fetch directo con el UA de WhatsApp, que
  // DataDome deja pasar. Es lo más rápido y fiable — evita proxy/Playwright/
  // Wayback por completo cuando funciona (que es casi siempre).
  if (shouldTryWhatsAppUA(url)) {
    console.log(`[fetch-html] Intento 0: UA WhatsApp vía curl (Idealista)`);
    // Vía curl (no fetch/undici): DataDome valida el TLS fingerprint además
    // del UA. El JA3 de curl + UA WhatsApp pasa; el de undici no.
    const curlResult = await fetchViaCurl(url, WHATSAPP_UA, {
      proxyUrl: PROXY_URL,
    });
    if (curlResult.ok) {
      console.log(`[fetch-html] ✓ UA WhatsApp (curl) exitoso`);
      return { ok: true, html: curlResult.html, finalUrl: url };
    }
    console.log(
      `[fetch-html] ✗ UA WhatsApp (curl) falló: ${curlResult.reason}`,
    );
  }

  // Intento 1: fetch directo (sin proxy)
  console.log(`[fetch-html] Intento 1: fetch directo`);
  const directResult = await tryFetch(url);
  if (directResult.ok) {
    console.log(`[fetch-html] ✓ Fetch directo exitoso`);
    return directResult;
  }

  console.log(`[fetch-html] ✗ Fetch directo falló: ${directResult.error.reason}`);

  // Si recibe 403/429 y tenemos proxy, reintentar con proxy
  const isBlocked =
    directResult.error.kind === "blocked" && PROXY_URL;
  if (isBlocked) {
    try {
      console.log(`[fetch-html] Intento 2: proxy Smartproxy`);
      const proxyAgent = new ProxyAgent(PROXY_URL);
      const proxyResult = await tryFetch(url, proxyAgent);
      if (proxyResult.ok) {
        console.log(`[fetch-html] ✓ Proxy Smartproxy exitoso`);
        return proxyResult;
      }

      console.log(`[fetch-html] ✗ Proxy falló: ${proxyResult.error.reason}`);

      // Si el proxy también falla, intentar Playwright como último recurso
      console.log(`[fetch-html] Intento 3: Playwright (navegador real)`);
      try {
        const playwrightResult = await fetchHtmlWithPlaywright(url);
        if (playwrightResult.ok) {
          console.log(`[fetch-html] ✓ Playwright exitoso`);
          return playwrightResult;
        }
        console.log(`[fetch-html] ✗ Playwright falló: ${playwrightResult.error.reason}`);
        // Si Playwright también falla, intentar Wayback (solo Idealista).
        return maybeTryWayback(
          url,
          `Direct: ${directResult.error.reason} | Proxy: ${proxyResult.error.reason} | Playwright: ${playwrightResult.error.reason}`,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "error desconocido";
        console.log(`[fetch-html] ✗ Playwright error: ${errMsg}`);
        return maybeTryWayback(
          url,
          `Direct: ${directResult.error.reason} | Proxy: ${proxyResult.error.reason} | Playwright: ${errMsg}`,
        );
      }
    } catch (err) {
      // Error al crear el proxy agent, intentar Playwright
      const errMsg = err instanceof Error ? err.message : "error desconocido";
      console.log(`[fetch-html] Error al crear proxy: ${errMsg}. Intentando Playwright...`);
      try {
        console.log(`[fetch-html] Intento 3: Playwright (sin proxy disponible)`);
        const playwrightResult = await fetchHtmlWithPlaywright(url);
        if (playwrightResult.ok) {
          console.log(`[fetch-html] ✓ Playwright exitoso (sin proxy)`);
          return playwrightResult;
        }
        console.log(`[fetch-html] ✗ Playwright falló: ${playwrightResult.error.reason}`);
        return maybeTryWayback(
          url,
          `Direct: ${directResult.error.reason} | Proxy error: ${errMsg} | Playwright: ${playwrightResult.error.reason}`,
        );
      } catch (playwrightErr) {
        const pwErrMsg = playwrightErr instanceof Error ? playwrightErr.message : "error desconocido";
        console.log(`[fetch-html] ✗ Playwright error: ${pwErrMsg}`);
        return maybeTryWayback(
          url,
          `Direct: ${directResult.error.reason} | Proxy error: ${errMsg} | Playwright error: ${pwErrMsg}`,
        );
      }
    }
  }

  // Si no es bloqueo, devolver error original
  return directResult;
}
