"use client";

import {
  Check,
  Info,
  Loader2,
  Shield,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Status = "idle" | "connecting" | "connected" | "error";

type Log = {
  type: "info" | "success" | "error";
  message: string;
  time: string;
};

export function IdealistaConfigClient({
  initialConfig,
}: {
  initialConfig: {
    feedKey: string;
    clientId: string;
    clientSecret: string;
    sandboxMode: boolean;
  } | null;
}) {
  const [feedKey, setFeedKey] = useState(initialConfig?.feedKey ?? "");
  const [clientId, setClientId] = useState(initialConfig?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(initialConfig?.clientSecret ?? "");
  const [sandboxMode, setSandboxMode] = useState(initialConfig?.sandboxMode ?? true);

  const [isSaving, setIsSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState<"save" | "saved">("save");
  const [status, setStatus] = useState<Status>("idle");
  const [tokenInfo, setTokenInfo] = useState<{
    accessToken: string;
    expiresIn: number;
    scope: string;
    sandbox: boolean;
    feedKey: string;
  } | null>(null);
  const [publishInfo, setPublishInfo] = useState<{
    publishedAds: number;
    maxPublishedAds: number;
  } | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);

  const addLog = (type: Log["type"], message: string) =>
    setLogs((prev) => [
      ...prev,
      { type, message, time: new Date().toLocaleTimeString("es-ES") },
    ]);

  const saveConfig = async () => {
    setIsSaving(true);
    try {
      await fetch("/api/admin/idealista/save-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedKey, clientId, clientSecret, sandboxMode }),
      });
      setSaveLabel("saved");
      setTimeout(() => setSaveLabel("save"), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    setStatus("connecting");
    setTokenInfo(null);
    setPublishInfo(null);
    setLogs([]);

    addLog("info", "Guardando configuración...");
    await saveConfig();

    const env = sandboxMode ? "SANDBOX" : "PRODUCCIÓN";
    addLog("info", `Conectando a ${env} (partners-sandbox.idealista.com)...`);
    addLog("info", "POST /oauth/token → solicitando Bearer token");

    try {
      const authRes = await fetch("/api/admin/idealista/test-connection", {
        method: "POST",
      });
      const authData = await authRes.json();

      if (!authRes.ok) {
        setStatus("error");
        addLog("error", `Error de autenticación: ${authData.error}`);
        if (authData.details) addLog("error", `Detalle: ${authData.details}`);
        return;
      }

      setTokenInfo(authData);
      setStatus("connected");
      addLog(
        "success",
        `Token OK · scope: ${authData.scope} · expira en ${authData.expiresIn}s`
      );
      addLog("info", "GET /v1/customer/publishinfo → consultando slots");

      const infoRes = await fetch("/api/admin/idealista/publish-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: authData.accessToken,
          feedKey: authData.feedKey,
          sandbox: authData.sandbox,
        }),
      });
      const infoData = await infoRes.json();

      if (infoRes.ok && infoData.publishInfo) {
        setPublishInfo(infoData.publishInfo);
        addLog(
          "success",
          `Slots: ${infoData.publishInfo.publishedAds} publicados de ${infoData.publishInfo.maxPublishedAds} máx.`
        );
      } else {
        addLog("error", `Error en publishinfo: ${infoData.error ?? "desconocido"}`);
      }
    } catch {
      setStatus("error");
      addLog("error", "Error de red. Revisa la conexión.");
    }
  };

  const canTest = feedKey.length > 0 && clientId.length > 0 && clientSecret.length > 0;

  return (
    <div className="space-y-6">
      {/* Credenciales */}
      <div className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] md:p-6">
        <div className="mb-5 flex items-center gap-2">
          <Shield size={18} className="text-gold" />
          <h3 className="font-serif text-base font-semibold text-ink">
            Credenciales API
          </h3>
        </div>

        {/* Sandbox toggle */}
        <div className="mb-5 flex items-center justify-between rounded-xl border border-amber-200/60 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-amber-800">Modo Sandbox</p>
            <p className="mt-0.5 text-xs text-amber-700/80">
              {sandboxMode
                ? "partners-sandbox.idealista.com — sin publicar anuncios reales"
                : "partners.idealista.com — PRODUCCIÓN, anuncios reales"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSandboxMode((v) => !v)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
              sandboxMode ? "bg-amber-400" : "bg-emerald-500"
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                sandboxMode ? "translate-x-1" : "translate-x-6"
              )}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink/50">
              Feed Key
            </label>
            <input
              type="text"
              value={feedKey}
              onChange={(e) => setFeedKey(e.target.value)}
              placeholder="ilcxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              maxLength={43}
              className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2 font-mono text-sm text-ink placeholder:text-ink/30 focus:border-gold/55 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-ink/45">
              43 caracteres, empieza por "ilc". Lo encuentras en idealista → Herramientas → Configuración.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink/50">
              Client ID
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="tu-client-id"
              className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2 font-mono text-sm text-ink placeholder:text-ink/30 focus:border-gold/55 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink/50">
              Client Secret
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="••••••••••••"
              className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2 font-mono text-sm text-ink placeholder:text-ink/30 focus:border-gold/55 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveConfig}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink/5 disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saveLabel === "saved" ? (
              <Check size={14} className="text-emerald-600" />
            ) : (
              <Check size={14} />
            )}
            {saveLabel === "saved" ? "Guardado" : "Guardar credenciales"}
          </button>

          <button
            type="button"
            onClick={testConnection}
            disabled={status === "connecting" || !canTest}
            className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-cream-50 transition hover:bg-ink/80 disabled:opacity-50"
          >
            {status === "connecting" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : status === "connected" ? (
              <Wifi size={14} />
            ) : (
              <WifiOff size={14} />
            )}
            Probar conexión
          </button>
        </div>
      </div>

      {/* Estado de conexión + logs */}
      {status !== "idle" && (
        <div
          className={cn(
            "rounded-2xl border p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] md:p-6",
            status === "connected"
              ? "border-emerald-200 bg-emerald-50/60"
              : status === "error"
                ? "border-red-200 bg-red-50/50"
                : "border-gold/15 bg-cream-50/85"
          )}
        >
          <div className="mb-4 flex items-center gap-2">
            {status === "connecting" && (
              <Loader2 size={18} className="animate-spin text-gold" />
            )}
            {status === "connected" && (
              <Wifi size={18} className="text-emerald-600" />
            )}
            {status === "error" && (
              <WifiOff size={18} className="text-red-600" />
            )}
            <h3 className="font-serif text-base font-semibold text-ink">
              {status === "connecting"
                ? "Conectando..."
                : status === "connected"
                  ? "Conectado correctamente"
                  : "Error de conexión"}
            </h3>
          </div>

          {/* Info de token y slots */}
          {tokenInfo && status === "connected" && (
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-white/60 p-3">
                <p className="text-xs text-ink/50">Entorno</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">
                  {tokenInfo.sandbox ? "Sandbox" : "Producción"}
                </p>
              </div>
              <div className="rounded-lg bg-white/60 p-3">
                <p className="text-xs text-ink/50">Scope</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">
                  {tokenInfo.scope}
                </p>
              </div>
              <div className="rounded-lg bg-white/60 p-3">
                <p className="text-xs text-ink/50">Token expira</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">
                  {tokenInfo.expiresIn}s
                </p>
              </div>
              {publishInfo && (
                <div className="rounded-lg bg-white/60 p-3">
                  <p className="text-xs text-ink/50">Slots publicación</p>
                  <p className="mt-0.5 text-sm font-semibold text-ink">
                    {publishInfo.publishedAds} / {publishInfo.maxPublishedAds}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Terminal de logs */}
          {logs.length > 0 && (
            <div className="rounded-xl bg-ink p-4 font-mono text-xs">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-cream-50/30">{log.time}</span>
                  <span
                    className={
                      log.type === "success"
                        ? "text-emerald-400"
                        : log.type === "error"
                          ? "text-red-400"
                          : "text-cream-50/60"
                    }
                  >
                    {log.type === "success" ? "✓" : log.type === "error" ? "✗" : "›"}
                  </span>
                  <span
                    className={
                      log.type === "success"
                        ? "text-emerald-300"
                        : log.type === "error"
                          ? "text-red-300"
                          : "text-cream-50/80"
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Guía */}
      <div className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] md:p-6">
        <div className="mb-3 flex items-center gap-2">
          <Info size={16} className="text-gold" />
          <h3 className="font-serif text-base font-semibold text-ink">
            Cómo obtener las credenciales
          </h3>
        </div>
        <ul className="space-y-2 text-sm text-ink/65">
          <li>
            <strong className="text-ink/80">Feed Key</strong>: En tu cuenta de Idealista, ve a{" "}
            <em>Herramientas → Configuración</em>. Es una cadena de 43 caracteres que empieza por "ilc".
          </li>
          <li>
            <strong className="text-ink/80">Client ID y Client Secret</strong>: Los proporciona el gestor de cuenta de Idealista al activar el acceso a la Partner API.
          </li>
          <li>
            <strong className="text-ink/80">Sandbox</strong>: Usa siempre sandbox para probar. Cambia a producción solo cuando el flujo esté validado.
          </li>
          <li>
            <strong className="text-ink/80">OAuth tokens</strong>: Caducan a los 300 segundos. El sistema los renueva automáticamente antes de cada publicación.
          </li>
          <li>
            <strong className="text-ink/80">Rate limits</strong>: Properties: 1000 req/min · Images: 5000 req/min · Contacts: 1000 req/min.
          </li>
        </ul>
      </div>

      {/* Endpoints disponibles (referencia) */}
      <div className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] md:p-6">
        <h3 className="mb-4 font-serif text-base font-semibold text-ink">
          Endpoints disponibles
        </h3>
        <div className="space-y-2 font-mono text-xs">
          {[
            { method: "POST", path: "/oauth/token", label: "Obtener Bearer token" },
            { method: "GET", path: "/v1/properties", label: "Listar propiedades" },
            { method: "POST", path: "/v1/properties", label: "Crear propiedad" },
            { method: "PUT", path: "/v1/properties/{id}", label: "Actualizar propiedad" },
            { method: "POST", path: "/v1/properties/{id}/deactivate", label: "Desactivar" },
            { method: "POST", path: "/v1/properties/{id}/reactivate", label: "Reactivar" },
            { method: "PUT", path: "/v1/properties/{id}/images", label: "Subir imágenes" },
            { method: "POST", path: "/v1/properties/{id}/videos", label: "Subir video" },
            { method: "GET", path: "/v1/customer/publishinfo", label: "Slots de publicación" },
            { method: "GET", path: "/v1/contacts", label: "Listar contactos" },
            { method: "POST", path: "/v1/contacts", label: "Crear contacto" },
          ].map(({ method, path, label }) => (
            <div key={path} className="flex items-center gap-3">
              <span
                className={cn(
                  "w-12 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold",
                  method === "GET"
                    ? "bg-blue-100 text-blue-700"
                    : method === "POST"
                      ? "bg-emerald-100 text-emerald-700"
                      : method === "PUT"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-red-100 text-red-700"
                )}
              >
                {method}
              </span>
              <span className="text-ink/60">{path}</span>
              <span className="text-ink/40">— {label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
