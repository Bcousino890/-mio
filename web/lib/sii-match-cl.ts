// sii-match-cl.ts — scoring de candidatos SII contra un anuncio de portal.
// Versión simplificada (mismas señales/pesos de `scraper/lib/matching.mjs`,
// adaptada a las señales que sí podemos calcular aquí: distancia, diferencia
// de m² y similitud de texto de dirección) — no duplicamos ese archivo porque
// las señales disponibles son distintas (sin precio/dormitorios/pHash en
// `sii_roles_cl`).

export interface SiiCandidateRow {
  rol: string
  direccion: string | null
  avaluo_fiscal_total: number | null
  superficie_terreno_m2: number | null
  codigo_destino_principal: string | null
  rol_padre: string | null
  lat: number | null
  lng: number | null
  distance_m: number | null
  text_sim: number | null
}

export interface ScoredSiiCandidate extends SiiCandidateRow {
  match_score: number // 0..100
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x * 2))
}

/**
 * Combina distancia (m), diferencia de superficie (%) y similitud de texto
 * de dirección (0..1, trigram) en un score 0..100. Señales ausentes (null)
 * simplemente no aportan ni penalizan.
 */
export function scoreCandidate(signals: {
  distance_m?: number | null
  sqm_diff_pct?: number | null
  text_sim?: number | null
}): number {
  let raw = 0

  if (signals.distance_m != null) {
    // 0m → 0 penalización, 300m → penalización máxima
    const normalized = Math.min(1, Math.max(0, signals.distance_m / 300))
    raw += -0.9 * normalized
  }

  if (signals.sqm_diff_pct != null) {
    // 0% → sin penalización, >60% → penalización máxima
    const normalized = Math.min(1, Math.max(0, signals.sqm_diff_pct / 60))
    raw += -0.4 * normalized
  }

  if (signals.text_sim != null) {
    raw += 0.8 * signals.text_sim
  }

  return Math.round(sigmoid(raw) * 1000) / 10 // 0..100, 1 decimal
}

export function scoreCandidates(
  rows: SiiCandidateRow[],
  listingSqm: number | null | undefined,
): ScoredSiiCandidate[] {
  return rows
    .map((row) => {
      const sqm_diff_pct = listingSqm && row.superficie_terreno_m2
        ? Math.abs(row.superficie_terreno_m2 - listingSqm) / listingSqm * 100
        : null

      const match_score = scoreCandidate({
        distance_m: row.distance_m,
        sqm_diff_pct,
        text_sim: row.text_sim,
      })

      return { ...row, match_score }
    })
    .sort((a, b) => b.match_score - a.match_score)
}
