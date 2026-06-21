#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// fetch-uf-mindicador.mjs — Obtiene el valor diario de la UF desde
// mindicador.cl (API pública, sin autenticación) y opcionalmente lo guarda
// en tabla uf_historico o lo imprime como JSON.
//
// USO:
//   node scraper/fetch-uf-mindicador.mjs               # UF hoy
//   node scraper/fetch-uf-mindicador.mjs --year 2026   # UF todo el año
//   node scraper/fetch-uf-mindicador.mjs --save        # guarda en DB
// ─────────────────────────────────────────────────────────────────────────────
import { parseArgs } from 'node:util'
import pg from 'pg'

const { values: args } = parseArgs({
  options: {
    year:  { type: 'string' },
    date:  { type: 'string' },
    save:  { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
  strict: false,
})

async function fetchUF(year) {
  const url = year
    ? `https://mindicador.cl/api/uf/${year}`
    : 'https://mindicador.cl/api/uf'

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`mindicador.cl respondió ${res.status}`)
  const json = await res.json()
  return json.serie ?? []
}

// Retorna el valor UF para una fecha específica (YYYY-MM-DD) o hoy
export async function getUFForDate(dateStr) {
  const year = (dateStr ?? new Date().toISOString()).slice(0, 4)
  const serie = await fetchUF(year)
  if (!serie.length) return null

  const target = dateStr ?? new Date().toISOString().slice(0, 10)
  // Buscar el valor más cercano <= fecha pedida
  const sorted = serie
    .map(e => ({ date: e.fecha.slice(0, 10), value: e.valor }))
    .sort((a, b) => b.date.localeCompare(a.date))

  return sorted.find(e => e.date <= target) ?? sorted[0]
}

async function saveToDb(serie) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS uf_historico (
        fecha date PRIMARY KEY,
        valor numeric(12, 2) NOT NULL,
        fuente text NOT NULL DEFAULT 'mindicador.cl',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    let n = 0
    for (const e of serie) {
      const fecha = e.fecha.slice(0, 10)
      await client.query(`
        INSERT INTO uf_historico (fecha, valor) VALUES ($1, $2)
        ON CONFLICT (fecha) DO UPDATE SET valor = EXCLUDED.valor
      `, [fecha, e.valor])
      n++
    }
    console.log(`✓ ${n} registros UF guardados en uf_historico`)
  } finally {
    await client.end()
  }
}

async function main() {
  const year = args.year ?? (args.date ? args.date.slice(0, 4) : null)
  const serie = await fetchUF(year)

  if (!args.quiet) {
    if (serie.length === 1 || !year) {
      const entry = serie[0]
      console.log(`UF ${entry.fecha.slice(0, 10)}: $${entry.valor.toLocaleString('es-CL')}`)
    } else {
      console.log(`UF ${year}: ${serie.length} valores`)
      const latest = serie[0]
      console.log(`  Último: ${latest.fecha.slice(0, 10)} → $${latest.valor.toLocaleString('es-CL')}`)
    }
  }

  if (args.save) {
    if (!process.env.DATABASE_URL) {
      console.error('ERROR: DATABASE_URL no configurada')
      process.exit(1)
    }
    await saveToDb(serie)
  } else {
    console.log(JSON.stringify(serie.slice(0, 5), null, 2))
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
