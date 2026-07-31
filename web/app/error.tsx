'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Red de seguridad de la app.
//
// Sin un error.tsx, CUALQUIER excepción de render en cualquier página caía en el
// límite global de Next: pantalla negra con "Application error: a client-side
// exception has occurred" y sin sidebar, sin volver atrás y sin decir qué pasó.
// Un solo campo mal tipado en una respuesta del API costaba la aplicación
// entera, y desde el navegador no había forma de saber cuál.
//
// Con este límite, el fallo se queda dentro de la página: se ve el mensaje real,
// se puede reintentar sin recargar y el resto de la app (navegación incluida)
// sigue viva.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // En producción el mensaje viene minificado; el `digest` es lo que permite
    // cruzarlo con el log del servidor.
    console.error('[error boundary]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="w-full max-w-lg bg-slate-800/80 border border-slate-700 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-100">Esta pantalla no se pudo dibujar</h1>
            <p className="text-sm text-slate-400 mt-1">
              El resto de la aplicación sigue funcionando. Puedes reintentar aquí mismo.
            </p>
          </div>
        </div>

        <pre className="mt-4 text-[11px] font-mono text-rose-300 bg-slate-900/70 border border-slate-700 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
          {error.message || 'Error desconocido'}
          {error.digest && `\n\ndigest: ${error.digest}`}
        </pre>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-500"
          >
            <RefreshCw size={15} /> Reintentar
          </button>
          <a
            href="/chile"
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg text-slate-300 border border-slate-700 hover:border-slate-600"
          >
            <Home size={15} /> Volver a Chile
          </a>
        </div>
      </div>
    </div>
  )
}
