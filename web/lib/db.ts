// Pool de PostgreSQL compartido por toda la app.
//
// Antes cada ruta de API creaba su propio `new Pool()` a nivel de módulo
// (~30 pools × 10 conexiones default = 300 conexiones potenciales) contra un
// Postgres configurado con max_connections=40 (infra/docker-compose.yml) —
// bajo carga se agotaban las conexiones. Un único pool con `max` moderado
// mantiene el total predecible.
//
// Se cachea en globalThis porque en desarrollo Next.js recompila los módulos
// en caliente (HMR) y sin el cache se acumularía un pool nuevo por recarga.
import { Pool } from 'pg'

const globalForDb = globalThis as unknown as { __casafariPool?: Pool }

export function getPool(): Pool {
  if (!globalForDb.__casafariPool) {
    globalForDb.__casafariPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  }
  return globalForDb.__casafariPool
}

export const pool = getPool()

export function query<R extends import('pg').QueryResultRow = import('pg').QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<R>(text, params as never)
}
