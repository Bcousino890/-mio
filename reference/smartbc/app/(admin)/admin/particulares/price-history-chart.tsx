"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { formatPrice } from "@/lib/format";

interface PriceHistoryChartProps {
  priceHistory: Array<{ date: string; price: number }>;
}

/**
 * Formats date to short format (e.g., "27 Nov")
 */
function formatDateShort(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}

/**
 * Calculates statistics from price history
 */
function calculateStats(data: Array<{ date: string; price: number }>) {
  if (data.length === 0) {
    return { min: 0, max: 0, avg: 0, percentChange: 0, isIncrease: false };
  }

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const percentChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  const isIncrease = percentChange >= 0;

  return { min, max, avg, percentChange, isIncrease };
}

export default function PriceHistoryChart({ priceHistory }: PriceHistoryChartProps) {
  const chartData = useMemo(
    () =>
      priceHistory.map((item) => ({
        date: item.date,
        dateLabel: formatDateShort(item.date),
        price: item.price,
      })),
    [priceHistory],
  );

  const stats = useMemo(() => calculateStats(priceHistory), [priceHistory]);

  if (chartData.length === 0) {
    return (
      <div className="rounded-lg border border-ink/10 bg-cream-50 p-6 text-center text-ink/50">
        <p className="text-sm">No hay historial de precios disponible</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Percentage change badge */}
      <div className="flex items-center justify-start">
        <div
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
            stats.isIncrease
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          <span className="text-lg">{stats.isIncrease ? "↑" : "↓"}</span>
          <span>{Math.abs(stats.percentChange).toFixed(1)}%</span>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-ink/10 bg-white p-4">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(10, 10, 10, 0.05)" />
            <XAxis
              dataKey="dateLabel"
              stroke="rgba(10, 10, 10, 0.4)"
              style={{ fontSize: "12px" }}
            />
            <YAxis
              stroke="rgba(10, 10, 10, 0.4)"
              style={{ fontSize: "12px" }}
              tickFormatter={(value) => `€${formatPrice(value)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(251, 248, 243, 0.95)",
                border: "1px solid rgba(10, 10, 10, 0.1)",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(40, 28, 10, 0.15)",
              }}
              labelStyle={{ color: "#0a0a0a" }}
              formatter={(value: unknown) => {
                if (typeof value === "number") {
                  return [`€${formatPrice(value)}`, "Precio"];
                }
                return ["N/A", "Precio"];
              }}
              labelFormatter={(label) => {
                const item = chartData.find((d) => d.dateLabel === label);
                return item ? new Date(item.date).toLocaleDateString("es-ES") : label;
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "12px" }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="url(#goldGradient)"
              strokeWidth={3}
              dot={false}
              isAnimationActive={true}
              name="Precio"
            />
            <defs>
              <linearGradient
                id="goldGradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor="#c9a96e" stopOpacity={1} />
                <stop offset="100%" stopColor="#d9bf8a" stopOpacity={1} />
              </linearGradient>
            </defs>
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3">
        {/* Min price card */}
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/50">
            Precio mín
          </p>
          <p className="mt-2 font-serif text-xl font-semibold text-ink">
            €{formatPrice(stats.min)}
          </p>
        </div>

        {/* Avg price card */}
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/50">
            Precio medio
          </p>
          <p className="mt-2 font-serif text-xl font-semibold text-ink">
            €{formatPrice(Math.round(stats.avg))}
          </p>
        </div>

        {/* Max price card */}
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/50">
            Precio máx
          </p>
          <p className="mt-2 font-serif text-xl font-semibold text-ink">
            €{formatPrice(stats.max)}
          </p>
        </div>
      </div>
    </div>
  );
}
