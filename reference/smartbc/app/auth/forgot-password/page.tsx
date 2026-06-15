"use client";

import { useState } from "react";
import { Loader2, AlertCircle, CheckCircle, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("Introduce tu correo electrónico");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Error al procesar la solicitud");
        return;
      }

      setSubmitted(true);
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cream-50 to-cream-100 p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl border border-gold/15 shadow-lg p-8">
          {!submitted ? (
            <>
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-gold/10 rounded-full">
                  <Mail size={32} className="text-gold" />
                </div>
              </div>

              <h1 className="font-serif text-2xl font-medium text-center text-ink mb-2">
                Recuperar contraseña
              </h1>
              <p className="text-center text-ink/55 text-sm mb-6">
                Introduce tu correo electrónico y te enviaremos un enlace para restablecer tu contraseña.
              </p>

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-ink/65 mb-1.5 block">
                    Correo electrónico
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    className="w-full px-4 py-2 border border-ink/10 rounded-lg bg-white/85 text-ink focus:border-gold/55 focus:outline-none"
                    disabled={loading}
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-6 bg-ink text-cream-50 py-2 px-4 rounded-lg hover:bg-ink/80 transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  <span>{loading ? "Enviando…" : "Enviar enlace"}</span>
                </button>
              </form>

              <p className="text-center text-ink/55 text-xs mt-6">
                ¿Recuerdas tu contraseña?{" "}
                <a href="/login" className="text-gold hover:underline font-medium">
                  Volver al inicio de sesión
                </a>
              </p>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-green-100 rounded-full">
                  <CheckCircle size={32} className="text-green-600" />
                </div>
              </div>

              <h1 className="font-serif text-2xl font-medium text-center text-ink mb-2">
                Revisa tu correo
              </h1>
              <p className="text-center text-ink/55 text-sm mb-4">
                Hemos enviado un enlace de recuperación a <strong>{email || "tu correo"}</strong>.
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700 mb-6">
                <p>
                  Si no ves el correo, comprueba la carpeta de spam o inténtalo con otra dirección.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => setSubmitted(false)}
                  className="w-full bg-ink text-cream-50 py-2 px-4 rounded-lg hover:bg-ink/80 transition font-medium"
                >
                  Intentar con otro correo
                </button>
                <a
                  href="/login"
                  className="block text-center border border-ink/15 text-ink py-2 px-4 rounded-lg hover:bg-ink/5 transition font-medium"
                >
                  Volver al inicio de sesión
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
