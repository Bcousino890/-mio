// Desglose del catastro SII por comuna: lectura instantánea + refresco fuera
// del ciclo de request.
//
// El problema que resuelve: /chile calculaba este desglose en cada visita con
// un GROUP BY sobre los ~9,6M de roles de sii_roles_cl (3 regex POSIX por fila
// + COUNT(DISTINCT) sobre direcciones normalizadas). Eso son minutos, no
// milisegundos: la página daba timeout a los 30 s, la caché en memoria de 1 h
// nunca llegaba a poblarse —la consulta no terminaba— y cada visita apilaba
// otra copia del escaneo en un pool de solo 10 conexiones, dejando sin
// conexiones al resto del CRM.
//
// Ahora el cálculo caro escribe en sii_resumen_comuna_cl (migración 0084) y la
// página solo LEE esa tabla. El refresco:
//   · nunca bloquea un request (se dispara y no se espera),
//   · corre como máximo uno a la vez en todo el sistema (lock de aviso en
//     Postgres, no una variable de módulo: hay varias instancias posibles),
//   · y tiene su propio statement_timeout, para que un cálculo patológico no
//     se quede colgado de una conexión del pool para siempre.
import { pool } from './db'
import { UNIT_ADDR_MATCH, unitBaseAddressExpr } from './sii-edificio-sql'

/** Cuánto vale el resumen antes de recalcularlo. El catastro SII se actualiza
 *  por semestres y por ingestas manuales: 6 h es de sobra. */
export const RESUMEN_TTL_MS = 6 * 60 * 60 * 1000

/** Tope del cálculo pesado. Si no termina en 15 min hay algo roto (índices,
 *  tabla hinchada): mejor abortar y volver a intentarlo que retener conexión. */
const REFRESH_STATEMENT_TIMEOUT_MS = 15 * 60 * 1000

/** Clave del lock de aviso: un único refresco a la vez en todo el sistema. */
const REFRESH_LOCK_KEY = 848_401

// Departamento = rol habitacional cuya dirección lleva sufijo de depto tras la
// numeración ("PEUMO 1190 DP 502"). Solo tokens de depto: BD/EST/LC tienen su
// propio destino SII (bodega/estacionamiento/local).
const DEPTO_ADDR_MATCH = '^.*?[0-9]+[[:space:]]+(DP|DPTO|DEPTO|DEP)([[:space:]]|$)'

export interface ComunaResumen {
  name: string
  region: string
  provincia: string
  priority: boolean
  sii_comuna_code: string | null
  roles: number
  casas: number
  departamentos: number
  edificios: number
  sitios: number
  bodegas: number
  estacionamientos: number
  oficinas: number
  comercio: number
  agricolas: number
  otros: number
}

export interface ResumenComunas {
  rows: ComunaResumen[]
  /** Cuándo se calculó el desglose más antiguo que se está mostrando. */
  computedAt: Date | null
  /** true si aún no hay ningún conteo calculado (primer arranque tras el deploy). */
  calculando: boolean
}

/**
 * Suma de las categorías clasificadas. `otros` es el resto de los roles: hay
 * destinos SII que no caen en ninguna columna de la tabla (industrial,
 * educación, culto…) y se muestran agrupados en vez de desaparecer.
 */
function conOtros(r: Record<string, unknown>): ComunaResumen {
  const num = (k: string) => Number(r[k] ?? 0)
  const roles = num('roles')
  const clasificados = ['casas', 'departamentos', 'sitios', 'bodegas', 'estacionamientos', 'oficinas', 'comercio']
    .reduce((s, k) => s + num(k), 0)
  return {
    name: String(r.name),
    region: String(r.region),
    provincia: String(r.provincia ?? ''),
    priority: Boolean(r.priority),
    sii_comuna_code: (r.sii_comuna_code as string | null) ?? null,
    roles,
    casas: num('casas'),
    departamentos: num('departamentos'),
    edificios: num('edificios'),
    sitios: num('sitios'),
    bodegas: num('bodegas'),
    estacionamientos: num('estacionamientos'),
    oficinas: num('oficinas'),
    comercio: num('comercio'),
    agricolas: num('agricolas'),
    otros: Math.max(0, roles - clasificados),
  }
}

/**
 * Lee el desglose ya calculado. Es un LEFT JOIN de ~350 comunas contra una
 * tabla de ~350 filas: milisegundos, sin tocar sii_roles_cl.
 *
 * Las comunas sin conteos aún (o sin datos SII) salen en 0 — con el mismo
 * aspecto que hoy tienen las comunas sin catastro cargado.
 */
export async function readComunasResumen(): Promise<ResumenComunas> {
  if (!process.env.DATABASE_URL) return { rows: [], computedAt: null, calculando: false }
  try {
    const res = await pool.query(
      `SELECT cc.name, cc.region, cc.provincia, cc.priority, cc.sii_comuna_code,
              COALESCE(s.roles, 0)            AS roles,
              COALESCE(s.casas, 0)            AS casas,
              COALESCE(s.departamentos, 0)    AS departamentos,
              COALESCE(s.edificios, 0)        AS edificios,
              COALESCE(s.sitios, 0)           AS sitios,
              COALESCE(s.bodegas, 0)          AS bodegas,
              COALESCE(s.estacionamientos, 0) AS estacionamientos,
              COALESCE(s.oficinas, 0)         AS oficinas,
              COALESCE(s.comercio, 0)         AS comercio,
              COALESCE(s.agricolas, 0)        AS agricolas,
              s.computed_at
       FROM chile_comunas cc
       LEFT JOIN sii_resumen_comuna_cl s ON s.sii_comuna_code = cc.sii_comuna_code
       ORDER BY cc.region, roles DESC, cc.name`
    )
    const rows = res.rows.map(conOtros)
    const fechas = res.rows
      .map((r) => r.computed_at as Date | null)
      .filter((d): d is Date => d instanceof Date)
    return {
      rows,
      computedAt: fechas.length > 0 ? new Date(Math.min(...fechas.map((d) => d.getTime()))) : null,
      calculando: fechas.length === 0,
    }
  } catch {
    return { rows: [], computedAt: null, calculando: false }
  }
}

/** ¿Toca recalcular? Sin fecha = nunca se calculó. */
export function resumenObsoleto(computedAt: Date | null): boolean {
  if (!computedAt) return true
  return Date.now() - computedAt.getTime() > RESUMEN_TTL_MS
}

/**
 * Recalcula el desglose completo y lo guarda en sii_resumen_comuna_cl.
 *
 * Toma un lock de aviso: si otro proceso (u otra pestaña que disparó el
 * refresco medio segundo antes) ya lo está calculando, sale sin hacer nada en
 * vez de lanzar un segundo escaneo de 9,6M de filas en paralelo.
 *
 * Solo escribe las filas cuyos conteos cambiaron, así el `computed_at` de una
 * comuna estable no se mueve y el `ON CONFLICT` no reescribe 350 filas por
 * gusto. Devuelve cuántas comunas cambiaron.
 */
export async function refreshComunasResumen(): Promise<
  { updated: number } | { skipped: 'en-curso' | 'sin-bd' } | { error: string }
> {
  if (!process.env.DATABASE_URL) return { skipped: 'sin-bd' }

  const client = await pool.connect()
  try {
    const lock = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [REFRESH_LOCK_KEY])
    if (!lock.rows[0]?.ok) return { skipped: 'en-curso' }

    try {
      await client.query(`SET statement_timeout = ${REFRESH_STATEMENT_TIMEOUT_MS}`)
      const res = await client.query(
        `INSERT INTO sii_resumen_comuna_cl AS r (
           sii_comuna_code, roles, casas, departamentos, edificios,
           sitios, bodegas, estacionamientos, oficinas, comercio, agricolas, computed_at
         )
         SELECT sii_comuna_code,
                COUNT(*)::int,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'H'
                                   AND (direccion IS NULL OR direccion !~ $1))::int,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'H'
                                   AND direccion ~ $1)::int,
                COUNT(DISTINCT ${unitBaseAddressExpr('direccion')})
                  FILTER (WHERE direccion ~ $2)::int,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'W')::int,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'L')::int,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'Z')::int,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'O')::int,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'C')::int,
                COUNT(*) FILTER (WHERE serie = 'agricola')::int,
                now()
         FROM sii_roles_cl
         WHERE sii_comuna_code IS NOT NULL
         GROUP BY sii_comuna_code
         ON CONFLICT (sii_comuna_code) DO UPDATE SET
           roles            = EXCLUDED.roles,
           casas            = EXCLUDED.casas,
           departamentos    = EXCLUDED.departamentos,
           edificios        = EXCLUDED.edificios,
           sitios           = EXCLUDED.sitios,
           bodegas          = EXCLUDED.bodegas,
           estacionamientos = EXCLUDED.estacionamientos,
           oficinas         = EXCLUDED.oficinas,
           comercio         = EXCLUDED.comercio,
           agricolas        = EXCLUDED.agricolas,
           computed_at      = EXCLUDED.computed_at
         WHERE r.roles            IS DISTINCT FROM EXCLUDED.roles
            OR r.casas            IS DISTINCT FROM EXCLUDED.casas
            OR r.departamentos    IS DISTINCT FROM EXCLUDED.departamentos
            OR r.edificios        IS DISTINCT FROM EXCLUDED.edificios
            OR r.sitios           IS DISTINCT FROM EXCLUDED.sitios
            OR r.bodegas          IS DISTINCT FROM EXCLUDED.bodegas
            OR r.estacionamientos IS DISTINCT FROM EXCLUDED.estacionamientos
            OR r.oficinas         IS DISTINCT FROM EXCLUDED.oficinas
            OR r.comercio         IS DISTINCT FROM EXCLUDED.comercio
            OR r.agricolas        IS DISTINCT FROM EXCLUDED.agricolas`,
        [DEPTO_ADDR_MATCH, UNIT_ADDR_MATCH]
      )
      return { updated: res.rowCount ?? 0 }
    } finally {
      // El timeout es de la sesión, y la conexión vuelve al pool para otros
      // requests: hay que dejarla como estaba.
      await client.query('RESET statement_timeout').catch(() => {})
      await client.query('SELECT pg_advisory_unlock($1)', [REFRESH_LOCK_KEY]).catch(() => {})
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  } finally {
    client.release()
  }
}

/**
 * Dispara el refresco sin esperarlo. Pensado para llamarse desde el render de
 * /chile: la página se sirve al instante con lo que haya y el recálculo avanza
 * por detrás. Un fallo aquí no puede tumbar el render, así que se traga.
 */
export function refreshComunasResumenEnSegundoPlano(): void {
  void refreshComunasResumen().catch(() => {})
}
