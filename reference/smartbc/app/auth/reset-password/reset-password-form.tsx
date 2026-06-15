"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle } from "lucide-react";

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Enlace de recuperación inválido o faltante");
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!password || !confirmPassword) {
      setError("Completa todos los campos");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Error al restablecer la contraseña");
        return;
      }

      setSuccess(true);
      setPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cream-50 to-cream-100 p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl border border-gold/15 shadow-lg p-8">
            <div className="flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-600" />
            </div>
            <h1 className="font-serif text-2xl font-medium text-center text-ink mb-4">
              Enlace inválido
            </h1>
            <p className="text-center text-ink/55 mb-6">
              Este enlace de recuperación es inválido o ha caducado. Solicita uno nuevo.
            </p>
            <a
              href="/auth/forgot-password"
              className="block text-center bg-ink text-cream-50 py-2 px-4 rounded-lg hover:bg-ink/80 transition font-medium"
            >
              Solicitar nuevo enlace
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cream-50 to-cream-100 p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl border border-gold/15 shadow-lg p-8">
          <h1 className="font-serif text-2xl font-medium text-center text-ink mb-2">
            Nueva contraseña
          </h1>
          <p className="text-center text-ink/55 text-sm mb-6">
            Introduce tu nueva contraseña a continuación.
          </p>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 mb-4">
              <CheckCircle size={16} />
              <span>¡Contraseña restablecida correctamente! Redirigiendo al inicio de sesión…</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-ink/65 mb-1.5 block">
                Nueva contraseña
              </span>
              <div className="relative flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2 border border-ink/10 rounded-lg bg-white/85 text-ink focus:border-gold/55 focus:outline-none"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-ink/55 hover:text-ink"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-ink/65 mb-1.5 block">
                Confirmar contraseña
              </span>
              <div className="relative flex items-center">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2 border border-ink/10 rounded-lg bg-white/85 text-ink focus:border-gold/55 focus:outline-none"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 text-ink/55 hover:text-ink"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading || success}
              className="w-full mt-6 bg-ink text-cream-50 py-2 px-4 rounded-lg hover:bg-ink/80 transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              <span>{loading ? "Guardando…" : "Establecer contraseña"}</span>
            </button>
          </form>

          <p className="text-center text-ink/55 text-xs mt-6">
            ¿Recuerdas tu contraseña?{" "}
            <a href="/login" className="text-gold hover:underline font-medium">
              Volver al inicio de sesión
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
