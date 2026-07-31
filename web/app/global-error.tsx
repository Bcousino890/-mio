'use client'

// Último recurso: un fallo en el propio layout raíz (o en el límite de error de
// arriba) no llega a `app/error.tsx`, así que sin esto se vuelve a caer en la
// pantalla negra por defecto de Next. Este componente reemplaza <html>/<body>
// enteros, por eso los estilos van en línea: no hay garantía de que la hoja de
// estilos de la app haya llegado a cargar.

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 560, width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
            <h1 style={{ fontSize: 18, margin: 0 }}>La aplicación no pudo arrancar</h1>
            <p style={{ fontSize: 14, color: '#94a3b8', marginTop: 8 }}>
              Reintenta; si vuelve a pasar, este es el detalle técnico del fallo.
            </p>
            <pre style={{ fontSize: 11, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 12, color: '#fda4af', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
              {error.message || 'Error desconocido'}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
            <button
              onClick={reset}
              style={{ marginTop: 16, background: '#d97706', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
            >
              Reintentar
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
