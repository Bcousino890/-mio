import "server-only";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const apiUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.API_URL || "http://localhost:3000";

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response(
      JSON.stringify({ error: "CRON_SECRET no configurado" }),
      { status: 500 }
    );
  }

  try {
    const response = await fetch(`${apiUrl}/api/cron/particulares/scrape`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cronSecret}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(
        JSON.stringify({
          error: `Scraper error: HTTP ${response.status}`,
          details: text
        }),
        { status: response.status }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), { status: 200 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500 }
    );
  }
}
