// ─────────────────────────────────────────────────────────────────────────────
// catastral-parquet-ingest.ts — Ingesta de GeoParquet de catastral.cl a
// tabla catastral_cl_enriched. Usa Python + geopandas vía execFile para parsear
// Parquet (más confiable que librerías JS) y streamea NDJSON de resultados.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import type { SendFn } from './sii-upload-stream'

const execFileAsync = promisify(execFile)

const BATCH_SIZE = 2000

async function getComunaIdFromName(client: Client, nombreComuna?: string): Promise<string | null> {
  if (!nombreComuna) return null
  const res = await client.query(
    `SELECT id FROM chile_comunas WHERE LOWER(nombre) = LOWER($1) LIMIT 1`,
    [nombreComuna]
  )
  return res.rows.length > 0 ? res.rows[0].id : null
}

async function insertBatch(client: Client, batch: Record<string, unknown>[]): Promise<number> {
  if (batch.length === 0) return 0

  const columns = [
    'comuna_id', 'rol', 'manzana', 'predio', 'nombreComuna', 'direccion_sii',
    'destinoDescripcion', 'valorTotal', 'valorAfecto', 'valorExento',
    'supTerreno', 'supConsMt2', 'valorComercial_clp_m2',
    'cap_ah_codigo', 'cap_ah_rango_superficie', 'cap_ah_valor_m2',
    'ah_rangoSuperficie', 'ah_valorUnitario',
    'csa_sector', 'csa_valorUnitario',
    'dc_direccion', 'dc_avaluo_fiscal', 'sup_construida_total',
    'anio_construccion_min', 'anio_construccion_max', 'materiales', 'calidades',
    'pol_area_m2', 'geom', 'periodo',
  ]

  // La columna `geom` no recibe el valor crudo como parámetro: el hex WKB que
  // entrega el script Python no trae SRID, así que se envuelve en
  // ST_SetSRID(ST_GeomFromWKB(decode(...,'hex')), 4326) en el propio SQL.
  const placeholders = batch
    .map((_, i) =>
      `(${columns
        .map((col, j) => {
          const paramIndex = i * columns.length + j + 1
          return col === 'geom'
            ? `ST_SetSRID(ST_GeomFromWKB(decode($${paramIndex},'hex')),4326)`
            : `$${paramIndex}`
        })
        .join(',')})`
    )
    .join(',')

  const values: unknown[] = []
  for (const row of batch) {
    const nombreComuna = row.nombreComuna as string | undefined
    const comunaId = await getComunaIdFromName(client, nombreComuna)

    values.push(
      comunaId,
      row.rol ?? null,
      row.manzana ?? null,
      row.predio ?? null,
      nombreComuna ?? null,
      row.direccion_sii ?? null,
      row.destinoDescripcion ?? null,
      row.valorTotal ?? null,
      row.valorAfecto ?? null,
      row.valorExento ?? null,
      row.supTerreno ?? null,
      row.supConsMt2 ?? null,
      row.valorComercial_clp_m2 ?? null,
      row['cap__áreas_homogéneas_rav_no_agrícola_2022__código_área_homogénea'] ?? null,
      row['cap__áreas_homogéneas_rav_no_agrícola_2022__rango_superficie_predial_en_m²'] ?? null,
      row['cap__áreas_homogéneas_rav_no_agrícola_2022__valor_m²_de_terreno'] ?? null,
      row.ah_rangoSuperficie ?? null,
      row.ah_valorUnitario ?? null,
      row.csa_sector ?? null,
      row.csa_valorUnitario ?? null,
      row.dc_direccion ?? null,
      row.dc_avaluo_fiscal ?? null,
      row.sup_construida_total ?? null,
      row.anio_construccion_min ?? null,
      row.anio_construccion_max ?? null,
      row.materiales ?? null,
      row.calidades ?? null,
      row.pol_area_m2 ?? null,
      row.geometry_hex ?? null,
      row.periodo ?? null
    )
  }

  const query = `
    INSERT INTO catastral_cl_enriched (${columns.join(',')})
    VALUES ${placeholders}
    ON CONFLICT (rol) DO NOTHING
  `

  await client.query('BEGIN')
  try {
    await client.query(query, values)
    await client.query('COMMIT')
    return batch.length
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

export async function ingestCatastralParquet(
  parquetPath: string,
  dbUrl: string,
  send: SendFn
): Promise<{ ok: boolean; counts: Record<string, number>; error?: string }> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  try {
    const pythonScript = `
import sys, json, geopandas as gpd, pandas as pd
import warnings
warnings.filterwarnings('ignore')

parquet_path = '${parquetPath.replace(/'/g, "\\'")}'
gdf = gpd.read_parquet(parquet_path)
if gdf.crs is not None and str(gdf.crs).upper() != 'EPSG:4326':
  gdf = gdf.to_crs(epsg=4326)

for _, row in gdf.iterrows():
  obj = {}
  for col in gdf.columns:
    val = row[col]
    if col == 'geometry':
      if val is not None and hasattr(val, 'wkb'):
        obj['geometry_hex'] = val.wkb.hex()
    elif pd.isna(val):
      obj[col] = None
    else:
      obj[col] = str(val) if col != 'pol_area_m2' else float(val)
  print(json.dumps(obj))
`

    const { stdout } = await execFileAsync('python3', ['-c', pythonScript], {
      timeout: 10 * 60 * 1000, // 10 minutos por comuna
      maxBuffer: 512 * 1024 * 1024, // 512MB — comunas grandes (ej. Santiago) generan mucho NDJSON
    })

    let rowsProcessed = 0
    let batch: Record<string, unknown>[] = []
    let batchesSinceProgress = 0

    for (const line of stdout.trim().split('\n')) {
      if (!line) continue
      const row = JSON.parse(line) as Record<string, unknown>
      batch.push(row)
      rowsProcessed++

      if (batch.length >= BATCH_SIZE) {
        await insertBatch(client, batch)
        batch = []
        batchesSinceProgress++
        if (batchesSinceProgress >= 10) {
          batchesSinceProgress = 0
          send({ progress: true, rowsProcessed, status: 'procesando' })
        }
      }
    }

    if (batch.length > 0) {
      await insertBatch(client, batch)
    }

    send({ progress: true, rowsProcessed, status: 'ok' })
    return { ok: true, counts: { catastral_parquet: rowsProcessed } }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('Error en ingestCatastralParquet:', error)
    send({ progress: true, status: 'error', error })
    return { ok: false, counts: {}, error }
  } finally {
    await client.end()
  }
}
