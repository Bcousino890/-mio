import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdminClient } from "@/lib/db/admin";

// Borrado de marca de agua DINÁMICO para fotos YA almacenadas de una propiedad.
// Para portales donde cada anuncio trae la marca de SU agencia (Idealista,
// Fotocasa), no hay un perfil fijo: el motor estima la marca de las propias
// fotos del anuncio (agrupadas por tamaño) y la quita, con detección para no
// tocar fotos sin marca. Ver scripts/wmrm/wm_remove_dynamic.py.

const BUCKET = "properties-photos";
const PYTHON = process.env.WMRM_PYTHON ?? "/opt/wmrm/bin/python";
const ENGINE = process.env.WMRM_DYNAMIC ?? "/opt/wmrm/wm_remove_dynamic.py";

function storagePath(agencySlug: string, externalId: string, position: number): string {
  return `synced/${agencySlug}/${externalId}/${position}.webp`;
}

/**
 * Re-procesa las fotos almacenadas de una propiedad importada quitándoles la
 * marca dinámica. Se llama en segundo plano tras crear la propiedad. Si el motor
 * no está disponible o algo falla, no rompe nada (deja las fotos como estaban).
 */
export async function cleanDynamicWatermark(params: {
  propertyId: string;
  agencySlug: string;
  externalId: string;
  photoCount: number;
}): Promise<void> {
  const { propertyId, agencySlug, externalId, photoCount } = params;
  if (photoCount < 8) return; // sin fotos suficientes no se puede estimar
  const supabase = createAdminClient();
  const storage = supabase.storage.from(BUCKET);

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "wmd-"));
    const inDir = join(dir, "in");
    const outDir = join(dir, "out");
    await writeFile(join(dir, ".keep"), "");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(inDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    // 1) Descargar las fotos almacenadas a un dir temporal (nombre = posición).
    const positions: number[] = [];
    for (let i = 0; i < photoCount; i++) {
      const { data, error } = await storage.download(
        storagePath(agencySlug, externalId, i),
      );
      if (error || !data) continue;
      const buf = Buffer.from(await data.arrayBuffer());
      await writeFile(join(inDir, `${String(i).padStart(4, "0")}.webp`), buf);
      positions.push(i);
    }
    if (positions.length < 8) return;

    // 2) Motor dinámico: agrupa por tamaño, estima + quita marca, detección.
    await new Promise<void>((resolve, reject) => {
      const ps = spawn(PYTHON, [ENGINE, inDir, outDir], {
        stdio: "ignore",
        timeout: 180_000,
      });
      ps.on("error", reject);
      ps.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`wmd_exit_${code}`)),
      );
    });

    // 3) Subir de vuelta las fotos limpias a su mismo path (upsert).
    const outFiles = await readdir(outDir);
    for (const fn of outFiles) {
      const pos = parseInt(fn, 10);
      if (Number.isNaN(pos)) continue;
      const buf = await readFile(join(outDir, fn));
      await storage.upload(storagePath(agencySlug, externalId, pos), buf, {
        contentType: "image/webp",
        upsert: true,
      });
    }

    // 4) Refrescar last_synced_at para invalidar la caché del proxy de fotos.
    const propsUpd = supabase.from("properties") as unknown as {
      update: (p: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
    };
    await propsUpd
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", propertyId);
  } catch {
    // best-effort: si falla, las fotos quedan con su marca (no se rompe el import)
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
