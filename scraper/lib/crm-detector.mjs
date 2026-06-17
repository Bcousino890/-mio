// ─────────────────────────────────────────────────────────────────────────────
// crm-detector.mjs
//
// Detecta automáticamente qué CRM usa una agencia basándose en el patrón de URL.
// Extrae la referencia del anuncio en esa plataforma CRM.
//
// Uso:
//   detectCRMFromUrl("https://www.housingo.es/Mobilia/VerInmueble/1338678/Ficha.html")
//   => { crm: 'MOBILIA', referenceId: '1338678', agencyDomain: 'housingo.es' }
// ─────────────────────────────────────────────────────────────────────────────

// Patrones de detección por CRM. El orden importa: primero patrones más específicos.
const CRM_PATTERNS = [
  {
    name: 'MOBILIA',
    // www.[domain]/Mobilia/VerInmueble/[ID]/...
    pattern: /^https?:\/\/([^\/]+)\/Mobilia\/VerInmueble\/(\d+)\//,
    referenceIdGroup: 2,
  },
  {
    name: 'INMOWEB',
    // www.[domain]/inmuebles/[ID]/...
    pattern: /^https?:\/\/([^\/]+)\/inmuebles\/(\d+)\/?/,
    referenceIdGroup: 2,
  },
  {
    name: 'LEVEL',
    // www.[domain]/property/[ID]/... o /listings/[ID]/...
    pattern: /^https?:\/\/([^\/]+)\/(property|listings)\/(\d+)\/?/,
    referenceIdGroup: 3,
  },
  {
    name: 'FOTOCASA',
    // www.[domain]/casa/[ID]/... o www.[domain]/piso/[ID]/...
    pattern: /^https?:\/\/([^\/]+)\/(casa|piso|propiedad)\/([^\/]+)\/?/,
    referenceIdGroup: 3,
  },
  {
    name: 'IDEALISTA',
    // www.[domain]/inmueble/[ID]/ (aunque normalmente es idealista.com, puede ser en agencia)
    pattern: /^https?:\/\/([^\/]+)\/inmueble\/(\d+)\/?/,
    referenceIdGroup: 2,
  },
  {
    name: 'VIVANUNCIOS',
    // www.[domain]/anuncio-[ID] o /anuncios/[ID]/
    pattern: /^https?:\/\/([^\/]+)\/(?:anuncio-|anuncios\/)([^\/]+)\/?/,
    referenceIdGroup: 2,
  },
];

/**
 * Detecta el CRM usado por una agencia a partir de la URL del anuncio.
 * Devuelve { crm, referenceId, agencyDomain } o null si no se detecta.
 *
 * @param {string} url - URL del anuncio (típicamente el "enlace adicional" de Idealista)
 * @returns {{crm: string, referenceId: string, agencyDomain: string} | null}
 */
export function detectCRMFromUrl(url) {
  if (!url || typeof url !== 'string') return null;

  for (const crmPattern of CRM_PATTERNS) {
    const match = url.match(crmPattern.pattern);
    if (match) {
      return {
        crm: crmPattern.name,
        agencyDomain: match[1],
        referenceId: match[crmPattern.referenceIdGroup],
      };
    }
  }

  return null;
}

/**
 * Extrae la URL del "enlace adicional" del HTML parseado de Idealista.
 * Busca el div con id="aditional-link" y retorna el href.
 *
 * Estructura esperada:
 *   <div id="aditional-link" class="aditional-link">
 *     <a ... href="https://www.housingo.es/Mobilia/VerInmueble/1338678/Ficha.html">...</a>
 *   </div>
 *
 * @param {string} html - HTML de la ficha de Idealista
 * @returns {string | null} URL del enlace adicional o null
 */
export function extractAdditionalLink(html) {
  if (!html) return null;

  // Busca el div con id="aditional-link" y extrae el href del primer <a>
  const match = html.match(
    /id="aditional-link"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i
  );

  return match ? match[1] : null;
}

/**
 * Extrae la referencia del anuncio visible en el HTML (div con class="ref-help").
 * Esta referencia puede usarse para validar/machear contra el CRM detectado.
 *
 * @param {string} html - HTML de la ficha
 * @returns {string | null} Referencia mostrada o null
 */
export function extractListingReference(html) {
  if (!html) return null;

  // Busca algo como:
  //   <div class="ref-help">Referencia del anuncio</div>
  //   <span>ABC123</span>
  // O simplemente el contenido del div ref-help
  const match = html.match(
    /(?:class="ref-help"[^>]*>[\s\S]*?<span[^>]*>|ref-help[^>]*>)([^\<]+)/i
  );

  return match ? match[1].trim() : null;
}

/**
 * Combina todo: dado el HTML de la ficha de Idealista, detecta:
 * 1. El enlace adicional (agency URL)
 * 2. El CRM usado por esa agencia
 * 3. La referencia del anuncio (si está disponible)
 *
 * @param {string} html - HTML completo de la ficha
 * @returns {{agencyUrl: string, crm: string, referenceId: string, agencyDomain: string, listingRef: string | null} | null}
 */
export function detectCRMFromDetailPage(html) {
  const agencyUrl = extractAdditionalLink(html);
  if (!agencyUrl) return null;

  const detection = detectCRMFromUrl(agencyUrl);
  if (!detection) return null;

  return {
    agencyUrl,
    crm: detection.crm,
    referenceId: detection.referenceId,
    agencyDomain: detection.agencyDomain,
    listingRef: extractListingReference(html),
  };
}

export default {
  detectCRMFromUrl,
  extractAdditionalLink,
  extractListingReference,
  detectCRMFromDetailPage,
  CRM_PATTERNS,
};
