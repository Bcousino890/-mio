import "server-only";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { execSync } from "child_process";
import path from "path";
import { readFileSync } from "fs";

export async function GET(req: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || profile.role !== "admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Intentar obtener logs de PM2 (si está en producción)
    try {
      const logs = execSync("pm2 logs smartbc --nostream --lines 200 2>/dev/null || echo ''", {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      if (logs) {
        return Response.json({
          ok: true,
          source: "pm2",
          logs: logs.split("\n"),
        });
      }
    } catch {
      // PM2 no disponible, continuar
    }

    // Fallback: intentar leer de archivo de log si existe
    try {
      const logFile = path.join(process.cwd(), ".pm2", "smartbc.log");
      const logs = readFileSync(logFile, "utf-8");
      const lines = logs.split("\n").slice(-200); // Últimas 200 líneas

      return Response.json({
        ok: true,
        source: "file",
        logs: lines,
      });
    } catch {
      // Archivo no existe
    }

    // Si no hay PM2 ni archivo, devolver mensaje
    return Response.json({
      ok: true,
      source: "none",
      logs: ["No logs available. Running in development or logs not persisted to disk."],
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
