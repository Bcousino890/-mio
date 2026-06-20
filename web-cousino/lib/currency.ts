import type { Currency } from "./properties";

// Tipos de cambio de referencia (estático para el MVP).
// TODO: sustituir por una API de tasas en tiempo real (p. ej. Fixer.io) en una fase posterior.
const RATES_TO_EUR: Record<Currency, number> = {
  EUR: 1,
  USD: 0.92,
  CLP: 0.00095,
};

const LOCALE_BY_CURRENCY: Record<Currency, string> = {
  EUR: "es-ES",
  USD: "en-US",
  CLP: "es-CL",
};

export function convert(amount: number, from: Currency, to: Currency): number {
  const inEur = amount * RATES_TO_EUR[from];
  return inEur / RATES_TO_EUR[to];
}

export function formatCurrency(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
