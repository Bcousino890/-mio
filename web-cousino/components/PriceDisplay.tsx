"use client";

import { convert, formatCurrency } from "@/lib/currency";
import { useCurrency } from "@/lib/currency-context";
import type { Currency } from "@/lib/properties";

export default function PriceDisplay({
  amount,
  currency: originalCurrency,
  className,
}: {
  amount: number;
  currency: Currency;
  className?: string;
}) {
  const { currency: selected } = useCurrency();
  const displayAmount = convert(amount, originalCurrency, selected);

  return (
    <span className={className}>
      {formatCurrency(displayAmount, selected)}
      {selected !== originalCurrency && (
        <span className="ml-1.5 text-xs font-normal text-navy/40">
          ({formatCurrency(amount, originalCurrency)})
        </span>
      )}
    </span>
  );
}
