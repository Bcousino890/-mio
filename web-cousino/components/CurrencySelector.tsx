"use client";

import { useCurrency } from "@/lib/currency-context";
import type { Currency } from "@/lib/properties";

const OPTIONS: { value: Currency; label: string }[] = [
  { value: "EUR", label: "EUR €" },
  { value: "USD", label: "USD $" },
  { value: "CLP", label: "CLP $" },
];

export default function CurrencySelector() {
  const { currency, setCurrency } = useCurrency();

  return (
    <label className="flex items-center gap-1.5 text-sm font-medium text-navy">
      <span className="sr-only">Moneda</span>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as Currency)}
        aria-label="Seleccionar moneda"
        className="cursor-pointer rounded-full border border-navy/20 bg-transparent px-3 py-1.5 text-sm font-medium text-navy focus:border-navy focus:outline-none"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
