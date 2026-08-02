'use client'

import { useEffect, useState } from 'react'

// Tasa UF→CLP del día para los filtros de precio en UF de Chile (propiedades y
// anuncios). Sin tasa confirmada NO se inventa un valor de respaldo: mientras
// `rate` sea null, quien use este hook debe dejar la opción "UF" deshabilitada
// — un valor inventado falsearía el filtro de precio sin que se note.
export function useUfRateCl() {
  const [rate, setRate] = useState<number | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/chile/uf-rate')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.success) { setRate(d.rate); setDate(d.date) }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { rate, date, loading }
}
