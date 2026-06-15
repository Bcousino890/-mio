// Slug público del SmartLink con la referencia BC al inicio, para que la URL
// que se comparte identifique el piso: "bc0871-alquiler-de-piso-en-…".
// La ruta /compartir/[slug] resuelve quitando este prefijo, así que los links
// VIEJOS (sin prefijo) siguen funcionando.

// "BC-0871" → "bc0871"
function cleanRef(bcReference: string): string {
  return bcReference.replace(/-/g, "").toLowerCase();
}

// (slug, "BC-0871") → "bc0871-{slug}". Sin referencia, devuelve el slug tal cual.
export function shareSlug(slug: string, bcReference?: string | null): string {
  if (!bcReference) return slug;
  return `${cleanRef(bcReference)}-${slug}`;
}

// "bc0871-alquiler-de-piso-…" → "alquiler-de-piso-…" (el slug almacenado).
// Si no lleva prefijo de referencia, devuelve el valor tal cual.
export function storedSlugFromShare(param: string): string {
  const m = param.match(/^bc\d+-(.+)$/i);
  return m ? m[1] : param;
}
