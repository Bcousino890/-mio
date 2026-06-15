"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Database } from "lucide-react";

export function MigrationsManager() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [output, setOutput] = useState("");
  const [migrationCount, setMigrationCount] = useState(0);

  useEffect(() => {
    // Verificar estado de migraciones
    const checkMigrations = async () => {
      try {
        const res = await fetch("/api/admin/migrations/apply");
        const data = await res.json();
        if (data.migrationFiles) {
          setMigrationCount(data.migrationFiles);
        }
      } catch (err) {
        console.error("Error checking migrations:", err);
      }
    };

    checkMigrations();
  }, []);

  const applyMigrations = async () => {
    setLoading(true);
    setStatus("idle");
    setMessage("");
    setOutput("");

    try {
      const res = await fetch("/api/admin/migrations/apply", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Error al aplicar migraciones");
        return;
      }

      setStatus("success");
      setMessage(data.message);
      setOutput(data.output);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Error de conexión"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gold/15 bg-cream-50/85 p-6 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)]">
      <div className="flex items-center gap-2 mb-4">
        <Database size={20} className="text-gold" />
        <h2 className="text-lg font-semibold text-ink">Migraciones de Base de Datos</h2>
      </div>

      <p className="text-sm text-ink/60 mb-4">
        {migrationCount} archivos de migración disponibles. Haz clic para aplicarlos:
      </p>

      {status === "success" && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <CheckCircle2 size={20} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-emerald-800">{message}</p>
            {output && (
              <pre className="mt-2 text-[11px] bg-white p-2 rounded border border-emerald-100 overflow-auto max-h-48 text-emerald-700">
                {output}
              </pre>
            )}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">{message}</p>
            {output && (
              <pre className="mt-2 text-[11px] bg-white p-2 rounded border border-red-100 overflow-auto max-h-48 text-red-700">
                {output}
              </pre>
            )}
          </div>
        </div>
      )}

      <button
        onClick={applyMigrations}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream-50 transition hover:bg-ink-soft disabled:opacity-50"
      >
        {loading && <Loader2 size={16} className="animate-spin" />}
        <span>
          {loading
            ? "Aplicando migraciones..."
            : "Aplicar Migraciones Ahora"}
        </span>
      </button>

      <p className="mt-4 text-[11px] text-ink/55">
        ⚠️ Esta acción aplicará todas las migraciones SQL pendientes en la base de datos.
        Se puede ejecutar múltiples veces sin problemas.
      </p>
    </div>
  );
}
