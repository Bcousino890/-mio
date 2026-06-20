"use client";

import { useState } from "react";

export default function InquiryForm({
  propertySlug,
  propertyTitle,
}: {
  propertySlug?: string;
  propertyTitle?: string;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");

    const formData = new FormData(e.currentTarget);
    const payload = {
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      country: formData.get("country"),
      purpose: formData.get("purpose"),
      message: formData.get("message"),
      nda: formData.get("nda") === "on",
      propertySlug,
    };

    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-lg border border-gold/40 bg-gold/10 p-6 text-center">
        <p className="font-medium text-navy">Gracias por su interés.</p>
        <p className="mt-1 text-sm text-navy/70">
          Un asesor se pondrá en contacto con usted bajo estricta
          confidencialidad en las próximas 24 horas.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {propertyTitle && (
        <p className="text-sm text-navy/60">
          Consulta sobre: <span className="font-medium">{propertyTitle}</span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <input
          name="name"
          required
          placeholder="Nombre completo"
          className="rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <input
          name="phone"
          placeholder="Teléfono"
          className="rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
        />
        <input
          name="country"
          placeholder="País de residencia"
          className="rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
        />
      </div>

      <select
        name="purpose"
        defaultValue=""
        className="w-full rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
      >
        <option value="" disabled>
          Propósito de la consulta
        </option>
        <option value="uso-personal">Uso personal</option>
        <option value="inversion">Inversión</option>
        <option value="alquiler">Alquiler</option>
      </select>

      <textarea
        name="message"
        rows={4}
        placeholder="Mensaje (opcional)"
        className="w-full rounded-md border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
      />

      <label className="flex items-start gap-2 text-xs text-navy/60">
        <input type="checkbox" name="nda" className="mt-0.5" />
        Acepto recibir comunicaciones bajo estricta confidencialidad (NDA).
      </label>

      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full rounded-full bg-navy px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === "sending" ? "Enviando..." : "Solicitar Consulta Privada"}
      </button>

      {status === "error" && (
        <p className="text-sm text-red-600">
          Ocurrió un error al enviar la consulta. Intente nuevamente.
        </p>
      )}
    </form>
  );
}
