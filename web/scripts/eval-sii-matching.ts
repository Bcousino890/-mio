// Harness de validación del motor de matching SII (Chile). Corre
// `scoreCandidatesV3` contra los casos de `lib/__fixtures__/sii-match-ground-truth.ts`
// (capturas reales con el rol correcto ya confirmado) y reporta métricas
// objetivas: ¿el rol correcto quedó #1? ¿en qué puesto quedó si no? ¿qué tan
// separado del resto?
//
// Uso: desde `web/`, `npx tsx scripts/eval-sii-matching.ts`
// (o `npm run eval:matching` si ya está en package.json).
//
// El objetivo de este script es reemplazar el "calcular a mano si tal ajuste
// mejora tal caso" por una corrida repetible: cualquier cambio en
// `sii-match-cl-v2.ts` se valida corriendo esto antes/después y comparando el
// reporte, en vez de simular un solo caso a ojo.
import { scoreCandidatesV3 } from '../lib/sii-match-cl-v2'
import { GROUND_TRUTH } from '../lib/__fixtures__/sii-match-ground-truth'

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

let hits1 = 0
let hits3 = 0
let reciprocalRankSum = 0

for (const tc of GROUND_TRUTH) {
  const scored = scoreCandidatesV3(tc.listing, tc.candidates)
  const rank = scored.findIndex((c) => c.rol === tc.correctRol) // -1 si no está
  const found = rank >= 0
  const rankDisplay = found ? rank + 1 : 'NO ENCONTRADO'
  const top1 = found && rank === 0
  const top3 = found && rank < 3
  if (top1) hits1++
  if (top3) hits3++
  if (found) reciprocalRankSum += 1 / (rank + 1)

  console.log(`\n=== ${tc.name} ===`)
  if (tc.url) console.log(`URL: ${tc.url}`)
  console.log(`Rol correcto: ${tc.correctRol} → quedó en el puesto #${rankDisplay} de ${scored.length}`)
  console.log(
    `Top 5: ${scored
      .slice(0, 5)
      .map((c, i) => `#${i + 1} ${c.rol}${c.rol === tc.correctRol ? ' ←correcto' : ''} (${fmtPct(c.match_score)})`)
      .join(' | ')}`,
  )
  if (tc.notes) console.log(`Notas: ${tc.notes}`)
}

const n = GROUND_TRUTH.length
console.log('\n──────────────────────────────────────────')
console.log(`Casos evaluados: ${n}`)
console.log(`Top-1 accuracy: ${hits1}/${n} (${fmtPct(n ? hits1 / n : 0)})`)
console.log(`Top-3 accuracy: ${hits3}/${n} (${fmtPct(n ? hits3 / n : 0)})`)
console.log(`Mean Reciprocal Rank: ${(n ? reciprocalRankSum / n : 0).toFixed(3)}`)
console.log('──────────────────────────────────────────')

if (n === 0) {
  console.log('\nNo hay casos de ground truth cargados todavía — agregar en lib/__fixtures__/sii-match-ground-truth.ts')
}
