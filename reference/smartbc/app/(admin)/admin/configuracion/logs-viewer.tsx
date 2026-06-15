"use client";

import { ChevronDown, Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

export function LogsViewer() {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  async function loadLogs() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/logs");
      const data = await res.json();

      if (data.ok) {
        setLogs(data.logs || []);
        setSource(data.source || "unknown");
      } else {
        setError(data.error || "Failed to load logs");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Auto-load logs when component mounts
    loadLogs();
    // Auto-refresh every 10 seconds
    const interval = setInterval(loadLogs, 10000);
    return () => clearInterval(interval);
  }, []);

  const displayLogs = logs.filter((line) => line.trim().length > 0);

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 font-semibold text-ink hover:text-ink/75 transition"
        >
          <ChevronDown
            size={18}
            strokeWidth={2}
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          Logs del servidor {source && `(${source})`}
        </button>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm transition hover:border-gold/40 hover:bg-gold/5 disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refrescar
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {expanded && (
        <div className="space-y-2">
          {displayLogs.length === 0 ? (
            <p className="text-sm text-ink/50 py-4 text-center">No logs available</p>
          ) : (
            <>
              <div className="max-h-[400px] overflow-y-auto bg-ink/3 rounded-lg border border-ink/10 p-3 font-mono text-[11px] text-ink/75">
                {displayLogs.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    {line}
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(displayLogs.join("\n"));
                }}
                className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm transition hover:border-gold/40 hover:bg-gold/5"
              >
                <Copy size={14} />
                Copiar logs
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
