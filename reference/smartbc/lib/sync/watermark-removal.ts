import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Borrado de marcas de agua CONSTANTES (mismo logo/posición en todas las fotos
// de una fuente). Cada fuente tiene un "perfil" (alpha matte horneado en el VPS
// en /opt/wmrm/profiles/<perfil>.npy). El motor Python invierte la mezcla y
// recupera el contenido real de debajo de la marca.
//
// Para añadir una plataforma nueva: hornear su perfil en el VPS y añadir aquí
// su patrón de URL de foto. Nada más.
const PROFILES: Array<{ pattern: RegExp; profile: string }> = [
  // Clikalia sirve sus fotos desde este bucket de Google Cloud con la marca
  // "clikalia" estampada en el centro.
  { pattern: /es-api-clikoffice-infra-esp-pro/i, profile: "clikalia" },
];

const PYTHON = process.env.WMRM_PYTHON ?? "/opt/wmrm/bin/python";
const SCRIPT = process.env.WMRM_SCRIPT ?? "/opt/wmrm/wm_remove.py";

function profileFor(url: string): string | null {
  for (const p of PROFILES) if (p.pattern.test(url)) return p.profile;
  return null;
}

/**
 * Si la foto viene de una fuente con marca registrada, le quita la marca con el
 * CLI Python del VPS. Si no hay perfil, el motor no está disponible (p.ej. en
 * dev local) o algo falla, devuelve el buffer ORIGINAL sin tocar — nunca rompe
 * el import por esto.
 */
export async function removeKnownWatermark(
  sourceUrl: string,
  buf: Buffer,
): Promise<Buffer> {
  const profile = profileFor(sourceUrl);
  if (!profile) return buf;

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "wmrm-"));
    const inPath = join(dir, "in.jpg");
    const outPath = join(dir, "out.jpg");
    await writeFile(inPath, buf);

    await new Promise<void>((resolve, reject) => {
      const ps = spawn(PYTHON, [SCRIPT, profile, inPath, outPath], {
        stdio: "ignore",
        timeout: 30_000,
      });
      ps.on("error", reject);
      ps.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`wm_remove_exit_${code}`)),
      );
    });

    return await readFile(outPath);
  } catch {
    return buf;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
