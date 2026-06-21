/**
 * Currency formatter for CLP and UF (Unidades de Fomento)
 * Default UF value can be overridden via environment variable UF_VALUE
 */

// Default UF value in CLP (approximately 36,500 CLP per UF as of 2024-2025)
// Can be overridden via environment variable UF_VALUE
const DEFAULT_UF_VALUE = process.env.UF_VALUE ? parseFloat(process.env.UF_VALUE) : 36500;

/**
 * Get the current UF value in CLP
 * @returns The UF value in CLP
 */
export function getUFValue(): number {
  return DEFAULT_UF_VALUE;
}

/**
 * Format a value in pesos CLP as a string
 * @param value - Amount in CLP
 * @returns Formatted string like "$ 50.000" or "—" if null
 */
export function formatCLP(value: number | null): string {
  if (!value) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  return `$${value.toLocaleString('es-CL')}`;
}

/**
 * Convert CLP value to UF
 * @param clpValue - Amount in CLP
 * @returns Amount in UF
 */
export function clpToUF(clpValue: number): number {
  return clpValue / getUFValue();
}

/**
 * Convert UF value to CLP
 * @param ufValue - Amount in UF
 * @returns Amount in CLP
 */
export function ufToCLP(ufValue: number): number {
  return ufValue * getUFValue();
}

/**
 * Format a value in pesos CLP as UF string
 * @param clpValue - Amount in CLP
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string like "50,00 UF" or "—" if null
 */
export function formatUF(clpValue: number | null, decimals: number = 2): string {
  if (!clpValue) return '—';
  const ufValue = clpToUF(clpValue);
  const separator = decimals > 0 ? ',' : '';
  const formattedValue = ufValue.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formattedValue} UF`;
}

/**
 * Format currency value in both CLP and UF formats
 * Returns object with both formats for flexible display
 * @param clpValue - Amount in CLP
 * @param decimalsUF - Number of decimal places for UF (default: 2)
 * @returns Object with both formats
 */
export function formatCurrency(
  clpValue: number | null,
  decimalsUF: number = 2
): { clp: string; uf: string } {
  return {
    clp: formatCLP(clpValue),
    uf: formatUF(clpValue, decimalsUF),
  };
}

/**
 * Format currency for display with both units shown
 * @param clpValue - Amount in CLP
 * @param displayUF - Whether to show UF value (default: false shows only CLP)
 * @param decimalsUF - Number of decimal places for UF (default: 2)
 * @returns Formatted string with primary and secondary unit
 */
export function formatCurrencyDual(
  clpValue: number | null,
  displayUF: boolean = false,
  decimalsUF: number = 2
): string {
  if (!clpValue) return '—';

  if (displayUF) {
    // Show UF as primary, CLP in gray
    const ufFormatted = formatUF(clpValue, decimalsUF);
    return ufFormatted;
  } else {
    // Show CLP as primary
    return formatCLP(clpValue);
  }
}
