import { NextResponse } from 'next/server'
import { getUfRateCl } from '@/lib/uf-rate-cl'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/uf-rate — expone al cliente la tasa UF→CLP del día (mindicador.cl)
// que ya usan el scraper y el AVM (ver lib/uf-rate-cl.ts). La necesitan los
// filtros de precio de /chile/propiedades y /chile/anuncios para poder buscar
// en UF: el front convierte el UF que escribe el usuario a CLP con esta tasa
// antes de mandarlo al backend, que siempre filtra sobre columnas en CLP
// (canonical_price / price).
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const uf = await getUfRateCl()
  if (!uf) {
    return NextResponse.json({ success: false, error: 'mindicador.cl no respondió' }, { status: 502 })
  }
  return NextResponse.json({ success: true, rate: uf.rate, date: uf.date })
}
