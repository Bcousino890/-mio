// Capa de caché compartida para consultas a DealerNet (paga por consulta).
// Usada tanto por las API routes (/api/chile/dealernet-buscar,
// /api/chile/dealernet-lookup) como por el pipeline de captación
// (lib/captar-pipeline.ts) para que NINGÚN llamador repita una consulta ya
// hecha — antes cada uno golpeaba el web service por su cuenta sin mirar lo
// que los otros ya habían guardado.
import { pool } from './db'
import {
  dealernetRetcodeMessage,
  normalizeBuscadorMultipleArgs,
  type BuscadorMultipleTipo,
  type DealernetCandidato,
  type DealernetPhone,
} from './dealernet'

// ─── Bitácora de auditoría (append-only) ─────────────────────────────────────
// Registra TODA consulta DealerNet — en vivo o de caché — para auditar el
// gasto y conciliar contra la facturación del proveedor (ver migración
// 0056_dealernet_query_log). Nunca debe romper el flujo del llamador: si el
// INSERT falla, se ignora en silencio.
export type DealernetQuerySource = 'ficha_catastro' | 'dealer' | 'captacion' | 'debug'

export interface DealernetQueryLogEntry {
  kind: 'buscador_multiple' | 'contactos_rut' | 'debug'
  tipbusq?: string | null
  args?: string | null
  rutNum?: number | null
  rutDv?: string | null
  productCodes?: string[] | null
  retcode?: number | null
  success: boolean
  fromCache?: boolean
  candidatosN?: number | null
  source?: DealernetQuerySource | null
  error?: string | null
}

export async function logDealernetQuery(entry: DealernetQueryLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO dealernet_query_log_cl
         (kind, tipbusq, args, rut_num, rut_dv, product_codes, retcode, success, from_cache, candidatos_n, source, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.kind,
        entry.tipbusq ?? null,
        entry.args ?? null,
        entry.rutNum ?? null,
        entry.rutDv ?? null,
        entry.productCodes ?? null,
        entry.retcode ?? null,
        entry.success,
        entry.fromCache ?? false,
        entry.candidatosN ?? null,
        entry.source ?? null,
        entry.error ?? null,
      ]
    )
  } catch {
    // la bitácora es secundaria — nunca rompe el flujo del llamador
  }
}

export interface CachedBuscadorMultiple {
  retcode: number | null
  retmsg: string | null
  candidatos: DealernetCandidato[]
}

export async function getCachedBuscadorMultiple(
  tipbusq: BuscadorMultipleTipo,
  args: string
): Promise<CachedBuscadorMultiple | null> {
  const normalizedArgs = normalizeBuscadorMultipleArgs(args)
  const { rows } = await pool.query(
    `SELECT retcode, retmsg, candidatos FROM dealernet_buscador_multiple_cl WHERE tipbusq = $1 AND args = $2 LIMIT 1`,
    [tipbusq, normalizedArgs]
  )
  if (!rows[0]) return null
  return { retcode: rows[0].retcode, retmsg: rows[0].retmsg, candidatos: rows[0].candidatos ?? [] }
}

// No se guarda un resultado con error (credenciales/cuenta) — no es
// reutilizable y la próxima consulta debe ir en vivo.
export async function saveBuscadorMultipleCache(
  tipbusq: BuscadorMultipleTipo,
  args: string,
  result: { retcode: number | null; retmsg: string | null; candidatos: DealernetCandidato[]; raw: unknown }
): Promise<void> {
  if (dealernetRetcodeMessage(result.retcode)) return
  const normalizedArgs = normalizeBuscadorMultipleArgs(args)
  await pool.query(
    `INSERT INTO dealernet_buscador_multiple_cl (tipbusq, args, retcode, retmsg, candidatos, raw_response)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (tipbusq, args) DO UPDATE SET
       retcode = EXCLUDED.retcode, retmsg = EXCLUDED.retmsg,
       candidatos = EXCLUDED.candidatos, raw_response = EXCLUDED.raw_response`,
    [tipbusq, normalizedArgs, result.retcode, result.retmsg, JSON.stringify(result.candidatos), JSON.stringify(result.raw)]
  )
}

export interface CachedContact {
  contact: any
  phones: DealernetPhone[]
  addresses: any[]
  emails: any[]
  relacionados: any[]
}

// Solo sirve un contacto cacheado si cubre TODOS los productos pedidos
// (products_requested @> productCodes) y la última consulta no fue un error.
export async function getCachedContactByRut(
  rutNum: number,
  rutDv: string,
  productCodes: string[]
): Promise<CachedContact | null> {
  const { rows } = await pool.query(
    `SELECT * FROM dealernet_contacts_cl WHERE rut_num = $1 AND rut_dv = $2 AND products_requested @> $3::text[] LIMIT 1`,
    [rutNum, rutDv, productCodes]
  )
  const contactRow = rows[0]
  if (!contactRow || dealernetRetcodeMessage(contactRow.retcode)) return null

  const [phonesRes, addressesRes, emailsRes, relacionadosRes] = await Promise.all([
    pool.query(`SELECT * FROM dealernet_phones_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [contactRow.id]),
    pool.query(`SELECT * FROM dealernet_addresses_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [contactRow.id]),
    pool.query(`SELECT * FROM dealernet_emails_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [contactRow.id]),
    pool.query(`SELECT * FROM dealernet_relacionados_cl WHERE contact_id = $1 ORDER BY relacion, nombre`, [contactRow.id]),
  ])

  return {
    contact: contactRow,
    phones: phonesRes.rows,
    addresses: addressesRes.rows,
    emails: emailsRes.rows,
    relacionados: relacionadosRes.rows,
  }
}
