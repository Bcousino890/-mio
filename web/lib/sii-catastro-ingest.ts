// ─────────────────────────────────────────────────────────────────────────────
// sii-catastro-ingest.ts — ingesta de los archivos planos oficiales del SII
// (Detalle Catastral + Rol de Cobro) a `sii_roles_cl` / `sii_construcciones_cl`.
//
// Duplicado (con ajustes) de `scraper/lib/sii-catastro-cl.mjs` — mismo motivo
// que la duplicación de `SII_DESTINO_LABELS` en `app/api/chile/sii-roles/route.ts`:
// web/ y scraper/ son proyectos Node separados y el build Docker de web/ solo
// incluye su propio directorio (contexto `../web` en infra/docker-compose.yml),
// así que scraper/lib no está disponible para la app en producción.
//
// Diferencia deliberada frente al original: cada archivo se ingesta dentro de
// una única transacción (en vez de autocommit fila por fila) — con cientos de
// miles de filas por comuna, el costo de fsync por INSERT hacía que la ingesta
// completa de una comuna grande tardara minutos y arriesgara timeouts en el
// endpoint HTTP que la dispara (ver app/api/admin/sii-upload/route.ts).
//
// ORIGEN DE LOS DATOS: sii.cl publica un botón de descarga masiva de
// autoservicio por comuna ("Avalúos y Contribuciones de Bienes Raíces" →
// "Descarga de Información Vigente por Comuna"). Un humano lo descarga
// manualmente y sube el archivo resultante a este sistema vía /configuracion.
// Este módulo SOLO lee archivos que ya están en disco — JAMÁS hace una
// petición HTTP/scraping contra sii.cl. Ver migración 0021_sii_catastro_cl.sql.
// ─────────────────────────────────────────────────────────────────────────────
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { Client } from 'pg'

function splitPipeLine(line: string): string[] {
  const parts = line.split('|')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

function toIntOrNull(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  if (trimmed === '') return null
  const n = parseInt(trimmed, 10)
  return Number.isNaN(n) ? null : n
}

function toTextOrNull(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  return trimmed === '' ? null : trimmed
}

function stripLeadingZeros(raw: unknown): string | null {
  const n = toIntOrNull(raw)
  return n === null ? null : String(n)
}

export function normalizeRol(manzana: unknown, predio: unknown): string | null {
  const m = stripLeadingZeros(manzana)
  const p = stripLeadingZeros(predio)
  if (m === null || p === null) return null
  return `${m}-${p}`
}

function normalizeRolTriple(comuna: unknown, manzana: unknown, predio: unknown): string | null {
  const m = toIntOrNull(manzana)
  const p = toIntOrNull(predio)
  if (!m && !p) return null
  const c = toTextOrNull(comuna)
  return `${c}-${stripLeadingZeros(manzana)}-${stripLeadingZeros(predio)}`
}

async function* readLines(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.length === 0) continue
    yield line
  }
}

const ROLES_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'direccion',
  'avaluo_fiscal_total', 'contribucion_semestral', 'codigo_destino_principal',
  'avaluo_exento', 'codigo_ubicacion',
]

const SUELOS_CONSTRUCCIONES_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'codigo_suelo', 'superficie_suelo_ha',
  'linea', 'material_code', 'calidad_code', 'superficie_m2', 'destino_code',
  'condicion_especial', 'numero_pisos',
]

const ROLES_NO_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'direccion',
  'avaluo_fiscal_total', 'contribucion_semestral', 'codigo_destino_principal', 'avaluo_exento',
  'rbc1_comuna', 'rbc1_manzana', 'rbc1_predio',
  'rbc2_comuna', 'rbc2_manzana', 'rbc2_predio',
  'superficie_terreno_m2', 'codigo_ubicacion',
  'padre_comuna', 'padre_manzana', 'padre_predio',
]

const CONSTRUCCIONES_NO_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'linea', 'material_code', 'calidad_code',
  'anio_construccion', 'superficie_m2', 'destino_code', 'condicion_especial', 'numero_pisos',
]

async function* parsePipeFile(filePath: string, fieldNames: string[]): AsyncGenerator<Record<string, string | null>> {
  for await (const line of readLines(filePath)) {
    const parts = splitPipeLine(line)
    const record: Record<string, string | null> = {}
    for (let i = 0; i < fieldNames.length; i++) {
      record[fieldNames[i]] = parts[i] ?? null
    }
    yield record
  }
}

async function* parseRolesAgricolas(filePath: string) {
  for await (const r of parsePipeFile(filePath, ROLES_AGRICOLAS_FIELDS)) {
    yield {
      sii_comuna_code: toTextOrNull(r.sii_comuna_code),
      manzana: toTextOrNull(r.manzana),
      predio: toTextOrNull(r.predio),
      rol: normalizeRol(r.manzana, r.predio),
      serie: 'agricola' as const,
      direccion: toTextOrNull(r.direccion),
      avaluo_fiscal_total: toIntOrNull(r.avaluo_fiscal_total),
      contribucion_semestral: toIntOrNull(r.contribucion_semestral),
      codigo_destino_principal: toTextOrNull(r.codigo_destino_principal),
      avaluo_exento: toIntOrNull(r.avaluo_exento),
      codigo_ubicacion: toTextOrNull(r.codigo_ubicacion),
    }
  }
}

async function* parseSuelosConstruccionesAgricolas(filePath: string) {
  for await (const r of parsePipeFile(filePath, SUELOS_CONSTRUCCIONES_AGRICOLAS_FIELDS)) {
    yield {
      sii_comuna_code: toTextOrNull(r.sii_comuna_code),
      manzana: toTextOrNull(r.manzana),
      predio: toTextOrNull(r.predio),
      rol: normalizeRol(r.manzana, r.predio),
      codigo_suelo: toTextOrNull(r.codigo_suelo),
      superficie_suelo_ha: r.superficie_suelo_ha != null ? (toIntOrNull(r.superficie_suelo_ha) ?? 0) / 100 : null,
      linea: toIntOrNull(r.linea),
      material_code: toTextOrNull(r.material_code),
      calidad_code: toTextOrNull(r.calidad_code),
      superficie_m2: toIntOrNull(r.superficie_m2),
      destino_code: toTextOrNull(r.destino_code),
      condicion_especial: toTextOrNull(r.condicion_especial),
      numero_pisos: toIntOrNull(r.numero_pisos),
    }
  }
}

async function* parseRolesNoAgricolas(filePath: string) {
  for await (const r of parsePipeFile(filePath, ROLES_NO_AGRICOLAS_FIELDS)) {
    yield {
      sii_comuna_code: toTextOrNull(r.sii_comuna_code),
      manzana: toTextOrNull(r.manzana),
      predio: toTextOrNull(r.predio),
      rol: normalizeRol(r.manzana, r.predio),
      serie: 'no_agricola' as const,
      direccion: toTextOrNull(r.direccion),
      avaluo_fiscal_total: toIntOrNull(r.avaluo_fiscal_total),
      contribucion_semestral: toIntOrNull(r.contribucion_semestral),
      codigo_destino_principal: toTextOrNull(r.codigo_destino_principal),
      avaluo_exento: toIntOrNull(r.avaluo_exento),
      rol_bien_comun_1: normalizeRolTriple(r.rbc1_comuna, r.rbc1_manzana, r.rbc1_predio),
      rol_bien_comun_2: normalizeRolTriple(r.rbc2_comuna, r.rbc2_manzana, r.rbc2_predio),
      superficie_terreno_m2: toIntOrNull(r.superficie_terreno_m2),
      codigo_ubicacion: toTextOrNull(r.codigo_ubicacion),
      rol_padre: normalizeRolTriple(r.padre_comuna, r.padre_manzana, r.padre_predio),
    }
  }
}

async function* parseConstruccionesNoAgricolas(filePath: string) {
  for await (const r of parsePipeFile(filePath, CONSTRUCCIONES_NO_AGRICOLAS_FIELDS)) {
    yield {
      sii_comuna_code: toTextOrNull(r.sii_comuna_code),
      manzana: toTextOrNull(r.manzana),
      predio: toTextOrNull(r.predio),
      rol: normalizeRol(r.manzana, r.predio),
      linea: toIntOrNull(r.linea),
      material_code: toTextOrNull(r.material_code),
      calidad_code: toTextOrNull(r.calidad_code),
      anio_construccion: toIntOrNull(r.anio_construccion),
      superficie_m2: toIntOrNull(r.superficie_m2),
      destino_code: toTextOrNull(r.destino_code),
      condicion_especial: toTextOrNull(r.condicion_especial),
      numero_pisos: toIntOrNull(r.numero_pisos),
    }
  }
}

// Rol de Cobro: ancho fijo, 117 caracteres, posiciones 1-indexadas tal cual
// "estructura_rol_cobro_1.pdf" (confirmado contra datos reales de Las Condes).
const ROL_COBRO_FIELDS: Array<[string, number, number]> = [
  ['comuna', 1, 5],
  ['anio', 6, 9],
  ['semestre', 10, 10],
  ['aseo', 11, 11],
  ['direccion', 18, 57],
  ['manzana', 58, 62],
  ['predio', 63, 67],
  ['serie', 68, 68],
  ['cuota_trimestral', 69, 81],
  ['avaluo_total', 82, 96],
  ['avaluo_exento', 97, 111],
  ['anio_termino_exencion', 112, 115],
  ['codigo_ubicacion', 116, 116],
  ['codigo_destino', 117, 117],
]

function parseRolCobroLine(line: string) {
  const get = (ini: number, fin: number) => line.slice(ini - 1, fin)
  const raw: Record<string, string> = {}
  for (const [name, ini, fin] of ROL_COBRO_FIELDS) raw[name] = get(ini, fin)

  return {
    sii_comuna_code: toTextOrNull(raw.comuna),
    anio: toIntOrNull(raw.anio),
    semestre: toIntOrNull(raw.semestre),
    direccion: toTextOrNull(raw.direccion),
    manzana: toTextOrNull(raw.manzana),
    predio: toTextOrNull(raw.predio),
    rol: normalizeRol(raw.manzana, raw.predio),
    serie: toTextOrNull(raw.serie) === 'A' ? ('agricola' as const) : ('no_agricola' as const),
    cuota_trimestral: toIntOrNull(raw.cuota_trimestral),
    avaluo_total: toIntOrNull(raw.avaluo_total),
    avaluo_exento: toIntOrNull(raw.avaluo_exento),
    codigo_ubicacion: toTextOrNull(raw.codigo_ubicacion),
    codigo_destino: toTextOrNull(raw.codigo_destino),
  }
}

async function* parseRolDeCobro(filePath: string) {
  for await (const line of readLines(filePath)) {
    if (line.length !== 117) continue // línea corrupta/truncada — se descarta, no se lanza
    yield parseRolCobroLine(line)
  }
}

function basename(filePath: string): string {
  return String(filePath).split('/').pop() ?? filePath
}

async function resolveComunaId(client: Client, comunaCode: string): Promise<string | null> {
  const res = await client.query(`SELECT id FROM chile_comunas WHERE sii_comuna_code = $1 LIMIT 1`, [comunaCode])
  return res.rows[0]?.id ?? null
}

async function upsertRol(
  client: Client,
  comunaId: string | null,
  rec: {
    rol: string | null
    sii_comuna_code: string | null
    manzana: string | null
    predio: string | null
    serie: string
    direccion: string | null
    avaluo_fiscal_total: number | null
    avaluo_exento: number | null
    contribucion_semestral: number | null
    codigo_destino_principal: string | null
    codigo_ubicacion?: string | null
    superficie_terreno_m2?: number | null
    rol_bien_comun_1?: string | null
    rol_bien_comun_2?: string | null
    rol_padre?: string | null
  },
  rawSource: string
): Promise<string | null> {
  if (!rec.rol) return null
  const res = await client.query(
    `
    INSERT INTO sii_roles_cl (
      comuna_id, sii_comuna_code, manzana, predio, rol, serie,
      direccion, avaluo_fiscal_total, avaluo_exento, contribucion_semestral,
      codigo_destino_principal, codigo_ubicacion,
      superficie_terreno_m2, rol_bien_comun_1, rol_bien_comun_2, rol_padre,
      raw_source
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (sii_comuna_code, manzana, predio) DO UPDATE SET
      direccion                = EXCLUDED.direccion,
      avaluo_fiscal_total       = EXCLUDED.avaluo_fiscal_total,
      avaluo_exento             = EXCLUDED.avaluo_exento,
      contribucion_semestral    = EXCLUDED.contribucion_semestral,
      codigo_destino_principal  = EXCLUDED.codigo_destino_principal,
      codigo_ubicacion          = EXCLUDED.codigo_ubicacion,
      superficie_terreno_m2     = COALESCE(EXCLUDED.superficie_terreno_m2, sii_roles_cl.superficie_terreno_m2),
      rol_bien_comun_1          = COALESCE(EXCLUDED.rol_bien_comun_1, sii_roles_cl.rol_bien_comun_1),
      rol_bien_comun_2          = COALESCE(EXCLUDED.rol_bien_comun_2, sii_roles_cl.rol_bien_comun_2),
      rol_padre                 = COALESCE(EXCLUDED.rol_padre, sii_roles_cl.rol_padre),
      raw_source                = EXCLUDED.raw_source,
      updated_at                = now()
    RETURNING id
    `,
    [
      comunaId, rec.sii_comuna_code, rec.manzana, rec.predio, rec.rol, rec.serie,
      rec.direccion, rec.avaluo_fiscal_total, rec.avaluo_exento, rec.contribucion_semestral,
      rec.codigo_destino_principal, rec.codigo_ubicacion ?? null,
      rec.superficie_terreno_m2 ?? null, rec.rol_bien_comun_1 ?? null, rec.rol_bien_comun_2 ?? null, rec.rol_padre ?? null,
      rawSource,
    ]
  )
  return res.rows[0]?.id ?? null
}

export interface SiiIngestFiles {
  rolesNoAgricolas?: string
  construccionesNoAgricolas?: string
  rolesAgricolas?: string
  suelosConstruccionesAgricolas?: string
  rolDeCobro?: string
}

export interface SiiIngestResult {
  ok: boolean
  counts: Record<string, number>
  error?: string
}

/**
 * Parsea e ingesta los archivos planos del SII para UNA comuna en
 * `sii_roles_cl` / `sii_construcciones_cl`. Todas las rutas son OPCIONALES —
 * se puede ingestar solo lo que se haya subido.
 */
export async function ingestSiiCatastroComuna({
  comunaCode,
  files = {},
  dbUrl = process.env.DATABASE_URL,
}: {
  comunaCode: string
  files?: SiiIngestFiles
  dbUrl?: string
}): Promise<SiiIngestResult> {
  const counts: Record<string, number> = {
    roles_agricolas: 0, suelos_construcciones_agricolas: 0,
    roles_no_agricolas: 0, construcciones_no_agricolas: 0, rol_de_cobro: 0,
  }
  if (!comunaCode) return { ok: false, counts, error: 'comunaCode requerido' }
  if (!dbUrl) return { ok: false, counts, error: 'DATABASE_URL no configurada' }

  const client = new Client({ connectionString: dbUrl })

  try {
    await client.connect()
    const comunaId = await resolveComunaId(client, comunaCode)

    // 1) Roles primero (no agrícola y agrícola) — las construcciones se
    //    enlazan por rol_id, así que el rol debe existir antes.
    if (files.rolesNoAgricolas) {
      const source = basename(files.rolesNoAgricolas)
      await client.query('BEGIN')
      try {
        for await (const rec of parseRolesNoAgricolas(files.rolesNoAgricolas)) {
          const id = await upsertRol(client, comunaId, rec, source)
          if (id) counts.roles_no_agricolas++
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.roles_no_agricolas = 0
        throw err
      }
    }
    if (files.rolesAgricolas) {
      const source = basename(files.rolesAgricolas)
      await client.query('BEGIN')
      try {
        for await (const rec of parseRolesAgricolas(files.rolesAgricolas)) {
          const id = await upsertRol(client, comunaId, rec, source)
          if (id) counts.roles_agricolas++
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.roles_agricolas = 0
        throw err
      }
    }

    // 2) Líneas de construcción/suelo — requieren que el rol_id ya exista; si
    //    una línea llega para un rol no visto se descarta (no falla la ingesta).
    if (files.construccionesNoAgricolas) {
      await client.query('BEGIN')
      try {
        for await (const rec of parseConstruccionesNoAgricolas(files.construccionesNoAgricolas)) {
          const rolRes = await client.query(
            `SELECT id FROM sii_roles_cl WHERE sii_comuna_code = $1 AND manzana = $2 AND predio = $3 LIMIT 1`,
            [rec.sii_comuna_code, rec.manzana, rec.predio]
          )
          const rolId = rolRes.rows[0]?.id
          if (!rolId) continue
          await client.query(
            `INSERT INTO sii_construcciones_cl (rol_id, linea, material_code, calidad_code, anio_construccion, superficie_m2, destino_code, condicion_especial, numero_pisos)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [rolId, rec.linea, rec.material_code, rec.calidad_code, rec.anio_construccion, rec.superficie_m2, rec.destino_code, rec.condicion_especial, rec.numero_pisos]
          )
          counts.construcciones_no_agricolas++
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.construcciones_no_agricolas = 0
        throw err
      }
    }
    if (files.suelosConstruccionesAgricolas) {
      await client.query('BEGIN')
      try {
        for await (const rec of parseSuelosConstruccionesAgricolas(files.suelosConstruccionesAgricolas)) {
          const rolRes = await client.query(
            `SELECT id FROM sii_roles_cl WHERE sii_comuna_code = $1 AND manzana = $2 AND predio = $3 LIMIT 1`,
            [rec.sii_comuna_code, rec.manzana, rec.predio]
          )
          const rolId = rolRes.rows[0]?.id
          if (!rolId) continue
          await client.query(
            `INSERT INTO sii_construcciones_cl (rol_id, linea, material_code, calidad_code, superficie_m2, destino_code, condicion_especial, numero_pisos, codigo_suelo, superficie_suelo_ha)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [rolId, rec.linea, rec.material_code, rec.calidad_code, rec.superficie_m2, rec.destino_code, rec.condicion_especial, rec.numero_pisos, rec.codigo_suelo, rec.superficie_suelo_ha]
          )
          counts.suelos_construcciones_agricolas++
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.suelos_construcciones_agricolas = 0
        throw err
      }
    }

    // 3) Rol de Cobro — UPSERT: si el rol no existe todavía (no se cargó
    //    Detalle Catastral para esta comuna), se crea una fila mínima con
    //    los datos propios del Rol de Cobro para que el lookup por dirección
    //    funcione igual.
    if (files.rolDeCobro) {
      const source = basename(files.rolDeCobro)
      await client.query('BEGIN')
      try {
        for await (const rec of parseRolDeCobro(files.rolDeCobro)) {
          if (!rec.rol) continue
          await client.query(
            `
            INSERT INTO sii_roles_cl (
              comuna_id, sii_comuna_code, manzana, predio, rol, serie, direccion,
              rol_cobro_anio, rol_cobro_semestre, rol_cobro_direccion,
              rol_cobro_avaluo_total, rol_cobro_avaluo_exento, rol_cobro_cuota_trimestral,
              rol_cobro_codigo_ubicacion, rol_cobro_codigo_destino, raw_source
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT (sii_comuna_code, manzana, predio) DO UPDATE SET
              direccion                   = COALESCE(sii_roles_cl.direccion, EXCLUDED.direccion),
              rol_cobro_anio              = EXCLUDED.rol_cobro_anio,
              rol_cobro_semestre          = EXCLUDED.rol_cobro_semestre,
              rol_cobro_direccion         = EXCLUDED.rol_cobro_direccion,
              rol_cobro_avaluo_total      = EXCLUDED.rol_cobro_avaluo_total,
              rol_cobro_avaluo_exento     = EXCLUDED.rol_cobro_avaluo_exento,
              rol_cobro_cuota_trimestral  = EXCLUDED.rol_cobro_cuota_trimestral,
              rol_cobro_codigo_ubicacion  = EXCLUDED.rol_cobro_codigo_ubicacion,
              rol_cobro_codigo_destino    = EXCLUDED.rol_cobro_codigo_destino,
              updated_at                  = now()
            `,
            [
              comunaId, rec.sii_comuna_code, rec.manzana, rec.predio, rec.rol, rec.serie, rec.direccion,
              rec.anio, rec.semestre, rec.direccion,
              rec.avaluo_total, rec.avaluo_exento, rec.cuota_trimestral,
              rec.codigo_ubicacion, rec.codigo_destino, source,
            ]
          )
          counts.rol_de_cobro++
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.rol_de_cobro = 0
        throw err
      }
    }

    return { ok: true, counts }
  } catch (err) {
    return { ok: false, counts, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await client.end()
  }
}
