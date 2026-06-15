import type { Operation, Property } from "@/lib/types";

/**
 * Format a numeric value using Spanish (es-ES) thousands separator.
 * Used for prices and counts shown in the UI.
 */
export function formatPrice(value: number, locale = "es-ES"): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Returns the price plus the localized "/mes" suffix when the property
 * is for rent. For sales we just return the formatted total.
 *
 * Centralizes the "rent uses /mes, sale doesn't" rule in one place so
 * the rest of the app doesn't have to think about it.
 */
export function formatPropertyPrice(
  property: Pick<Property, "price" | "operation">,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const formatted = `${formatPrice(property.price)} €`;
  if (property.operation === "alquiler") {
    return `${formatted}${t("common.priceUnit")}`;
  }
  return formatted;
}

/**
 * Translation-aware suffix for a price:
 *   alquiler → "/mes" (translated)
 *   venta    → ""
 */
export function priceSuffix(
  operation: Operation,
  t: (key: string) => string,
): string {
  return operation === "alquiler" ? t("common.priceUnit") : "";
}
