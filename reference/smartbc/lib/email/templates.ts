/**
 * Plantillas de correo de marca para SmartBC — Benjamín Cousiño Propiedades.
 *
 * Genera HTML seguro para clientes de correo:
 * - Layout basado en tablas (sin flexbox) con ancho máximo de 600px.
 * - Solo estilos inline (sin CSS externo ni <style>).
 * - Cabecera de marca, botón CTA opcional y pie de página estándar.
 */

// Paleta de marca
const INK = "#2a1f10"; // tinta oscura
const CREAM = "#fbf8f3"; // crema de fondo
const GOLD = "#c9a96e"; // acento dorado
const MUTED = "#8a7c66"; // texto secundario
const BORDER = "#e8dfd0"; // bordes suaves

const SERIF_FONT = "Georgia, 'Times New Roman', Times, serif";
const SANS_FONT = "Arial, Helvetica, sans-serif";

export interface RenderEmailLayoutOptions {
  /** Título principal del correo (se muestra como encabezado del contenido). */
  title: string;
  /** Cuerpo del correo en HTML (párrafos, etc.). Debe ser HTML de confianza. */
  bodyHtml: string;
  /** Texto del botón CTA (opcional; requiere ctaUrl). */
  ctaLabel?: string;
  /** URL del botón CTA (opcional; requiere ctaLabel). */
  ctaUrl?: string;
}

/**
 * Escapa caracteres especiales de HTML en texto plano.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renderiza el layout de correo de marca completo (documento HTML).
 */
export function renderEmailLayout({
  title,
  bodyHtml,
  ctaLabel,
  ctaUrl,
}: RenderEmailLayoutOptions): string {
  const ctaBlock =
    ctaLabel && ctaUrl
      ? `
              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 28px auto;">
                <tr>
                  <td align="center" bgcolor="${GOLD}" style="border-radius: 8px;">
                    <a href="${ctaUrl}" target="_blank" style="display: inline-block; padding: 14px 36px; font-family: ${SANS_FONT}; font-size: 16px; font-weight: bold; color: ${INK}; text-decoration: none; border-radius: 8px; background-color: ${GOLD};">${escapeHtml(ctaLabel)}</a>
                  </td>
                </tr>
              </table>
              <!-- Enlace alternativo en texto plano -->
              ${renderFallbackUrl(ctaUrl)}`
      : "";

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${CREAM};">
    <!-- Contenedor exterior -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CREAM}" style="background-color: ${CREAM};">
      <tr>
        <td align="center" style="padding: 24px 12px;">
          <!-- Contenedor principal 600px -->
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
            <!-- Cabecera de marca -->
            <tr>
              <td align="center" style="padding: 28px 24px 20px 24px;">
                <span style="font-family: ${SERIF_FONT}; font-size: 24px; font-weight: bold; color: ${INK}; letter-spacing: 1px;">Benjam&iacute;n Cousi&ntilde;o Propiedades</span>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top: 12px;">
                  <tr>
                    <td width="60" height="3" bgcolor="${GOLD}" style="font-size: 0; line-height: 0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Tarjeta de contenido -->
            <tr>
              <td bgcolor="#ffffff" style="background-color: #ffffff; border: 1px solid ${BORDER}; border-radius: 10px; padding: 36px 40px;">
                <h1 style="margin: 0 0 18px 0; font-family: ${SERIF_FONT}; font-size: 22px; font-weight: bold; color: ${INK};">${escapeHtml(title)}</h1>
                <div style="font-family: ${SANS_FONT}; font-size: 15px; line-height: 1.6; color: ${INK};">
                  ${bodyHtml}
                </div>${ctaBlock}
              </td>
            </tr>
            <!-- Pie de página -->
            <tr>
              <td align="center" style="padding: 24px 24px 8px 24px;">
                <p style="margin: 0 0 6px 0; font-family: ${SANS_FONT}; font-size: 12px; color: ${MUTED};">&copy; Benjam&iacute;n Cousi&ntilde;o Propiedades &middot; Madrid</p>
                <p style="margin: 0; font-family: ${SANS_FONT}; font-size: 12px; color: ${MUTED};">Si no solicitaste este correo, puedes ignorarlo.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Bloque auxiliar para mostrar una URL en texto plano como alternativa al CTA.
 */
export function renderFallbackUrl(url: string): string {
  return `
    <p style="margin: 16px 0 6px 0; font-family: ${SANS_FONT}; font-size: 13px; color: ${MUTED};">Si el bot&oacute;n no funciona, copia y pega este enlace en tu navegador:</p>
    <p style="margin: 0; padding: 10px 12px; background-color: ${CREAM}; border: 1px solid ${BORDER}; border-radius: 6px; font-family: ${SANS_FONT}; font-size: 12px; color: ${INK}; word-break: break-all;"><a href="${url}" target="_blank" style="color: ${INK}; text-decoration: underline;">${escapeHtml(url)}</a></p>`;
}
