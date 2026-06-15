import { NextResponse } from "next/server";

const TEST_URL = "https://www.idealista.com/inmueble/111564879/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function GET() {
  const proxyUrl = process.env.SMARTPROXY_URL;

  // Test directo sin proxy
  let directStatus: number | string = "no probado";
  try {
    const res = await fetch(TEST_URL, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    directStatus = res.status;
  } catch (e) {
    directStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test con proxy
  let proxyStatus: number | string = "no configurado";
  if (proxyUrl) {
    try {
      const { ProxyAgent } = await import("undici");
      const agent = new ProxyAgent(proxyUrl);
      const res = await fetch(TEST_URL, {
        headers: { "User-Agent": UA },
        // @ts-expect-error undici dispatcher
        dispatcher: agent,
        signal: AbortSignal.timeout(15000),
      });
      proxyStatus = res.status;
    } catch (e) {
      proxyStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Test con Playwright
  let playwrightStatus: number | string = "no probado";
  try {
    const { fetchHtmlWithPlaywright } = await import("@/lib/sync/import-by-link/fetch-with-playwright");
    const result = await fetchHtmlWithPlaywright(TEST_URL);
    if (result.ok) {
      playwrightStatus = 200;
    } else {
      playwrightStatus = `error: ${result.error.reason}`;
    }
  } catch (e) {
    playwrightStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({
    proxyConfigured: !!proxyUrl,
    proxyUrl: proxyUrl ? proxyUrl.replace(/:([^@]+)@/, ":***@") : null,
    directStatus,
    proxyStatus,
    playwrightStatus,
  });
}
