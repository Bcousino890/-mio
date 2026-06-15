import "server-only";
import { execSync } from "child_process";
import { getCurrentProfile } from "@/lib/db/queries/session";

/**
 * API para aplicar migraciones desde el panel de admin
 * Solo accesible por owner/admin
 * POST /api/admin/migrations/apply
 */
export async function POST(req: Request) {
  const profile = await getCurrentProfile();

  // Solo owner puede aplicar migraciones
  if (!profile || !["owner", "admin"].includes(profile.role)) {
    return Response.json(
      { error: "Unauthorized - solo Owner/Admin" },
      { status: 403 }
    );
  }

  try {
    console.log("🚀 Iniciando aplicación de migraciones...");

    // Ejecutar el script post-deploy
    const output = execSync("bash scripts/post-deploy.sh", {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: "pipe",
    });

    console.log("✅ Migraciones aplicadas:");
    console.log(output);

    return Response.json({
      ok: true,
      message: "Migraciones aplicadas exitosamente",
      output: output,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Error aplicando migraciones:", errorMessage);

    return Response.json(
      {
        ok: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

/**
 * GET para verificar el estado actual de las migraciones
 */
export async function GET() {
  const profile = await getCurrentProfile();

  if (!profile || !["owner", "admin"].includes(profile.role)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 403 }
    );
  }

  try {
    // Contar archivos de migración
    const output = execSync("ls -1 supabase/migrations/*.sql 2>/dev/null | wc -l", {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    const count = parseInt(output.trim(), 10);

    return Response.json({
      migrationFiles: count,
      status: "ready",
      message: `${count} archivos de migración disponibles`,
    });
  } catch (error) {
    return Response.json(
      {
        error: "No se pudo verificar migraciones",
      },
      { status: 500 }
    );
  }
}
