import type { Metadata } from "next";
import InquiryForm from "@/components/InquiryForm";

export const metadata: Metadata = {
  title: "Contacto | Benjamín Cousiño Propiedades",
  description:
    "Solicite una consulta privada con nuestro equipo de asesores inmobiliarios en España y Chile.",
};

export default function ContactoPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 lg:px-10">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-gold">
        Contacto
      </p>
      <h1 className="font-serif-display mt-2 text-3xl text-navy sm:text-4xl">
        Solicitar Consulta Privada
      </h1>
      <p className="mt-3 text-navy/70">
        Cuéntenos qué busca y un asesor especializado en clientes
        internacionales se pondrá en contacto bajo estricta confidencialidad.
      </p>

      <div className="mt-10 rounded-lg border border-navy/10 p-6 sm:p-8">
        <InquiryForm />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-navy">España</p>
          <p className="mt-1 text-sm text-navy/70">
            Madrid · Barcelona · Marbella · Ibiza · Palma de Mallorca
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-navy">Chile</p>
          <p className="mt-1 text-sm text-navy/70">
            Santiago · Viña del Mar · Sausalito · La Calera
          </p>
        </div>
      </div>
    </div>
  );
}
