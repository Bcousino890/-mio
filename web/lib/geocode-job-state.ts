// In-memory singleton tracking background geocoding jobs (one per comuna).
// Lives for the lifetime of the Node process — survives individual HTTP
// requests/browser disconnects, which is the whole point: the job keeps
// running server-side even if nobody is watching the status endpoint.
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export type JobStatus = 'idle' | 'running' | 'done' | 'error'

export interface GeocodeJobState {
  siiComunaCode: string
  comunaName: string | null
  status: JobStatus
  totalPending: number
  processed: number
  geocoded: number
  noMatch: number
  startedAt: string | null
  updatedAt: string | null
  error: string | null
}

const jobs = new Map<string, GeocodeJobState>()

function freshState(siiComunaCode: string): GeocodeJobState {
  return {
    siiComunaCode,
    comunaName: null,
    status: 'idle',
    totalPending: 0,
    processed: 0,
    geocoded: 0,
    noMatch: 0,
    startedAt: null,
    updatedAt: null,
    error: null,
  }
}

export function getJobState(siiComunaCode: string): GeocodeJobState {
  return jobs.get(siiComunaCode) ?? freshState(siiComunaCode)
}

export function isJobRunning(siiComunaCode: string): boolean {
  return jobs.get(siiComunaCode)?.status === 'running'
}

const BATCH_SIZE = 100

async function countPending(siiComunaCode: string): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*) AS total FROM sii_roles_cl
     WHERE sii_comuna_code = $1 AND direccion IS NOT NULL AND (lat IS NULL OR lng IS NULL)`,
    [siiComunaCode]
  )
  return Number(res.rows[0]?.total ?? 0)
}

async function fetchBatch(siiComunaCode: string, afterRol: string) {
  const res = await pool.query(
    `SELECT rol, direccion FROM sii_roles_cl
     WHERE sii_comuna_code = $1 AND direccion IS NOT NULL AND (lat IS NULL OR lng IS NULL) AND rol > $2
     ORDER BY rol ASC
     LIMIT $3`,
    [siiComunaCode, afterRol, BATCH_SIZE]
  )
  return res.rows as { rol: string; direccion: string }[]
}

async function fetchComunaName(siiComunaCode: string): Promise<string | null> {
  const res = await pool.query(`SELECT name FROM chile_comunas WHERE sii_comuna_code = $1 LIMIT 1`, [siiComunaCode])
  return res.rows[0]?.name ?? null
}

async function runJob(siiComunaCode: string) {
  const { geocodeAddressCl } = await import('./geocode-cl')
  const state = jobs.get(siiComunaCode)!

  try {
    state.comunaName = await fetchComunaName(siiComunaCode)
    state.totalPending = await countPending(siiComunaCode)
    state.updatedAt = new Date().toISOString()

    let afterRol = ''
    while (true) {
      const batch = await fetchBatch(siiComunaCode, afterRol)
      if (batch.length === 0) break

      for (const { rol, direccion } of batch) {
        const point = await geocodeAddressCl({ address: direccion, comuna: state.comunaName })
        if (point) {
          await pool.query(
            `UPDATE sii_roles_cl SET lat = $1, lng = $2 WHERE rol = $3 AND sii_comuna_code = $4`,
            [point.lat, point.lng, rol, siiComunaCode]
          )
          state.geocoded++
        } else {
          state.noMatch++
        }
        state.processed++
        afterRol = rol
        state.updatedAt = new Date().toISOString()
      }
    }

    state.status = 'done'
  } catch (err) {
    state.status = 'error'
    state.error = err instanceof Error ? err.message : 'Unknown error'
  } finally {
    state.updatedAt = new Date().toISOString()
  }
}

export function startGeocodeJob(siiComunaCode: string): GeocodeJobState {
  if (isJobRunning(siiComunaCode)) return jobs.get(siiComunaCode)!

  const state = freshState(siiComunaCode)
  state.status = 'running'
  state.startedAt = new Date().toISOString()
  jobs.set(siiComunaCode, state)

  // Fire-and-forget: the loop keeps running on the server regardless of
  // whether the HTTP request that triggered it is still open.
  runJob(siiComunaCode).catch((err) => {
    state.status = 'error'
    state.error = err instanceof Error ? err.message : 'Unknown error'
    state.updatedAt = new Date().toISOString()
  })

  return state
}
