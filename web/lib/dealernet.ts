// Cliente del web service SOAP de DealerNet ("Central de Información").
// Protocolo: un único método `CentralDeInformacion`. Dos modos de consulta,
// documentados en DEALERNET - Protocolo Web-Services v14:
// - Por RUT (`<ruts><rut num dv/></ruts>`): trae contactos confirmados de un
//   titular ya identificado. Ver `queryDealernet`.
// - Buscador Múltiple, producto 3460 (`<param><busq tipbusq args/></param>`):
//   busca candidatos por nombre/empresa/teléfono/dirección/rol/patente sin
//   conocer el RUT de antemano. Ver `queryDealernetBuscadorMultiple` y
//   docs/DEALERNET-PROTOCOLO.md.
import { XMLParser } from 'fast-xml-parser'
import { readFileSync } from 'fs'
import { join } from 'path'

// El protocolo v14 define el endpoint de producción en HTTPS. Se fuerza https
// para el host conocido porque los .env antiguos (copiados de un .env.example
// con http://) mandarían las credenciales SOAP en claro.
const DEALERNET_WSDL_URL = (process.env.DEALERNET_WSDL_URL || 'https://infows.dealernet.cl/wsinfodlnt.asmx')
  .replace(/^http:\/\/(infows\.dealernet\.cl)/, 'https://$1')

// Prioridad: .env en disco (bind-mount del VPS, refleja guardados en caliente
// desde la UI de /dealer) y process.env como fallback. Al revés no funciona:
// env_file congela los valores al arrancar el contenedor, así que si
// process.env ganara, un cambio de credenciales guardado desde la UI no se
// aplicaría hasta el siguiente recreate.
function getDealernetCreds(): { user: string | null; pass: string | null } {
  let fileUser: string | null = null
  let filePass: string | null = null
  try {
    const content = readFileSync(join(process.cwd(), '.env'), 'utf-8')
    const parse = (key: string) => content.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? null
    fileUser = parse('DEALERNET_USER')
    filePass = parse('DEALERNET_PASSWORD')
  } catch { /* sin .env en disco */ }
  return {
    user: fileUser ?? process.env.DEALERNET_USER ?? null,
    pass: filePass ?? process.env.DEALERNET_PASSWORD ?? null,
  }
}

export const DEALERNET_PRODUCTS = {
  CONTACTABILIDAD: '3407',
  VERIFICACION_MULTIPLE: '3408',
  DIRECTORIO_TELEFONOS: '3410',
  REGISTROS_RELACIONADOS: '3421',
  BUSCADOR_MULTIPLE: '3460',
} as const

export const BUSCADOR_MULTIPLE_TIPOS = [
  'nombre',
  'empresa',
  'ambas_peremp',
  'telefono',
  'direccion',
  'rol',
  'patente',
] as const

export type BuscadorMultipleTipo = (typeof BUSCADOR_MULTIPLE_TIPOS)[number]

// Códigos de retorno documentados en DEALERNET-PROTOCOLO.md. DealerNet
// siempre responde HTTP 200 con esta info dentro del XML, incluso cuando la
// consulta falló (credenciales, cuenta, formato) — si no se revisa, el
// llamador ve "0 candidatos"/"0 teléfonos" indistinguible de una búsqueda
// real sin resultados, que es justo el bug reportado ("buscar dueño no
// funciona" sin ningún mensaje de por qué).
export const DEALERNET_RETCODE_MESSAGES: Record<number, string> = {
  0: 'Consulta exitosa',
  1: 'Cuenta de usuario no definida en DealerNet',
  2: 'Cuenta de usuario bloqueada en DealerNet',
  3: 'Cuenta de usuario no habilitada para consulta WS (sin permiso de web services o producto no contratado)',
  4: 'Clave de DealerNet inválida',
  5: 'Tipo de consulta inválido',
  6: 'RUT inválido',
  99: 'Error interno de DealerNet',
  999: 'Falta un parámetro obligatorio en la consulta',
}

export function dealernetRetcodeMessage(retcode: number | null): string | null {
  if (retcode == null || retcode === 0) return null
  return DEALERNET_RETCODE_MESSAGES[retcode] ?? `DealerNet devolvió retcode ${retcode}`
}

export const DEFAULT_DEALERNET_PRODUCTS: string[] = [
  DEALERNET_PRODUCTS.CONTACTABILIDAD,
  DEALERNET_PRODUCTS.VERIFICACION_MULTIPLE,
  DEALERNET_PRODUCTS.DIRECTORIO_TELEFONOS,
]

export interface ParsedRut {
  num: number
  dv: string
}

// Acepta "12.345.678-9", "12345678-9", "123456789K", etc.
export function parseRut(input: string): ParsedRut | null {
  const cleaned = input.replace(/[^0-9kK]/g, '').toUpperCase()
  if (cleaned.length < 2) return null
  const dv = cleaned.slice(-1)
  const numStr = cleaned.slice(0, -1).replace(/^0+/, '')
  if (!/^\d+$/.test(numStr)) return null
  const num = parseInt(numStr, 10)
  if (!Number.isFinite(num) || num <= 0) return null
  return { num, dv }
}

export function computeRutDv(num: number): string {
  let sum = 0
  let multiplier = 2
  let n = num
  while (n > 0) {
    sum += (n % 10) * multiplier
    n = Math.floor(n / 10)
    multiplier = multiplier === 7 ? 2 : multiplier + 1
  }
  const remainder = 11 - (sum % 11)
  if (remainder === 11) return '0'
  if (remainder === 10) return 'K'
  return String(remainder)
}

export function isValidRut(rut: ParsedRut): boolean {
  return computeRutDv(rut.num) === rut.dv.toUpperCase()
}

// DealerNet devuelve el teléfono como "56 (9) 95429258" (o variantes sin
// espacios/paréntesis). Lo reducimos a dígitos y forzamos el prefijo país
// "+56" — el resto del número (incl. el "9" de celular) ya viene incluido.
export function normalizePhoneCl(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
  const national = digits.startsWith('56') ? digits.slice(2) : digits
  return `+56${national}`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildRequestXml(rut: ParsedRut, productCodes: string[], user: string, pass: string): string {
  const userXml = escapeXml(user)
  const passXml = escapeXml(pass)
  const prods = productCodes.map(cod => `<prod cod="${escapeXml(cod)}" gls="" />`).join('')
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://dealernet.cl/webservices/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:CentralDeInformacion>
      <web:ctausr>${userXml}</web:ctausr>
      <web:ctapwd>${passXml}</web:ctapwd>
      <web:input>
        <root>
          <tipocns>O</tipocns>
          <ruts>
            <rut num="${rut.num}" dv="${escapeXml(rut.dv)}" />
          </ruts>
          <prods>${prods}</prods>
        </root>
      </web:input>
    </web:CentralDeInformacion>
  </soapenv:Body>
</soapenv:Envelope>`
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: true,
})

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

// Cada <prd> envuelve su payload en un tag propio por producto
// (DLNTCNTCTBLDDWS, DLNTDIRTELEFONOWS, DLNTVERMULTWS, ...) — buscamos esa
// única key que no sea un atributo del propio <prd>.
function getProductWrapper(prd: Record<string, unknown>): any {
  const key = Object.keys(prd).find(k => k !== '@_cod' && k !== '@_gls')
  return key ? (prd as any)[key] : null
}

export interface DealernetPhone {
  phone_raw: string
  phone_e164: string
  categoria: 'probable' | 'alternativo' | 'laboral'
  clasificacion: string | null
  ind_whatsapp: boolean | null
  idimagen: string | null
  relacion: string | null
  ranking: number | null
  calidad: number | null
  product_code: string
}

// Mismo teléfono puede salir de varios productos (3407/3408/3410) — para la
// UI lo mostramos una vez, marcando todas las fuentes que lo confirmaron.
// Compartido por dealernet-lookup (ficha Dealer) y captar-pipeline
// (Captación), para que ambas fichas muestren exactamente los mismos datos.
export function dedupePhones(phones: DealernetPhone[]): (DealernetPhone & { sources: string[] })[] {
  const map = new Map<string, DealernetPhone & { sources: string[] }>()
  for (const p of phones) {
    const existing = map.get(p.phone_e164)
    if (!existing) {
      map.set(p.phone_e164, { ...p, sources: [p.product_code] })
      continue
    }
    existing.sources.push(p.product_code)
    if (p.categoria === 'probable') existing.categoria = 'probable'
    existing.ranking = Math.max(existing.ranking ?? 0, p.ranking ?? 0)
    existing.calidad = Math.max(existing.calidad ?? 0, p.calidad ?? 0)
    existing.ind_whatsapp = existing.ind_whatsapp || p.ind_whatsapp
    existing.idimagen = existing.idimagen ?? p.idimagen
    existing.relacion = existing.relacion ?? p.relacion
  }
  return Array.from(map.values())
}

export interface DealernetAddress {
  direccion: string
  ubicacion: string | null
  rol: string | null
  categoria: 'probable' | 'alternativo'
  ranking: number | null
  calidad: number | null
  product_code: string
}

export interface DealernetEmail {
  email: string
  categoria: 'probable' | 'alternativo'
  ranking: number | null
  calidad: number | null
  product_code: string
}

function numOrNull(value: unknown): number | null {
  return value != null && value !== '' ? Number(value) : null
}

// La spec v11 no está versionada en el repo, así que los nombres exactos de
// los campos de "relación" varían según producto (3407 puede anotar de quién
// es el número; 3421 lista relacionados con RUT + tipo de relación). En vez
// de fijar un nombre y romperse en silencio, se busca por lista de alias —
// las keys se normalizan a minúsculas sin prefijo de atributo ("@_").
function normalizedEntries(node: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [k, v] of Object.entries(node)) {
    out.set(k.toLowerCase().replace(/^@_/, '').replace(/[_\s]/g, ''), v)
  }
  return out
}

function firstScalar(entries: Map<string, unknown>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const v = entries.get(alias)
    if (v == null || typeof v === 'object') continue
    const s = String(v).trim()
    if (s && s.toLowerCase() !== 'null') return s
  }
  return null
}

// El portal muestra por teléfono "Relación directa con Titular, Sociedad" —
// el campo WS puede llamarse relacion/relacion_directa/etc. (normalizedEntries
// ya quita guiones bajos, por eso 'relaciondirecta').
const RELACION_ALIASES = ['relacion', 'relaciondirecta', 'glsrelacion', 'tiporelacion', 'vinculo', 'parentesco', 'relacionadocon']
const RELACION_NOMBRE_ALIASES = ['nomrelacion', 'nombrerelacion', 'nomrelacionado', 'nombrerelacionado']

// "Relación" de un teléfono: con quién se vincula el número (Titular,
// Sociedad, Cónyuge, ...). En el XML real de producción viene anidada y
// puede ser múltiple:
//   <d><telefono>...</telefono><relacionados><relacion>Titular</relacion>
//   <relacion>Sociedad</relacion></relacionados></d>
// → "Titular, Sociedad" (así lo rotula el portal: "Relación directa con
// Titular, Sociedad"). Se mantienen los alias planos como fallback por si
// otros productos lo entregan sin anidar.
function extractPhoneRelacion(d: Record<string, unknown>): string | null {
  const nested = (d as any)?.relacionados?.relacion
  if (nested != null) {
    const parts = toArray(nested).map(v => String(v).trim()).filter(Boolean)
    if (parts.length > 0) return parts.join(', ')
  }
  const entries = normalizedEntries(d)
  const relacion = firstScalar(entries, RELACION_ALIASES)
  const nombre = firstScalar(entries, RELACION_NOMBRE_ALIASES)
  if (relacion && nombre) return `${relacion} — ${nombre}`
  return relacion ?? nombre
}

// Id de la foto de perfil (WhatsApp) del número. Se busca por alias
// (normalizedEntries colapsa `id_imagen`, `id imagen`, etc. a `idimagen`)
// para no depender de un único nombre.
const IDIMAGEN_ALIASES = ['idimagen', 'idimg', 'idfoto', 'idfotoperfil', 'codcomp', 'codimagen', 'imgid']

function extractIdImagen(d: Record<string, unknown>): string | null {
  return firstScalar(normalizedEntries(d), IDIMAGEN_ALIASES)
}

// OJO: el <idimagen> de cada teléfono es un id EXTERNO que el endpoint de
// imágenes del portal no acepta (responde 500). El <colect> trae un bloque
// <img> que lo traduce al id interno con el que el portal sí sirve la foto
// (verificado contra producción: idext 13387802 → 500, su iddatlocal
// 4153486 → 200 image/jpeg):
//   <img><d iddatlocal="4153486" idinsdatlocal="..." idext="13387802"/></img>
// iddatlocal es el CODCOMP de tlfw.system.reziseImage.aspx (ver
// /api/chile/dealernet-imagen).
function buildImageIdMap(colect: any): Map<string, string> {
  const map = new Map<string, string>()
  for (const d of toArray<any>(colect?.img?.d)) {
    const idext = d?.['@_idext'] != null ? String(d['@_idext']) : null
    const idLocal = d?.['@_iddatlocal'] != null ? String(d['@_iddatlocal']) : null
    if (idext && idLocal) map.set(idext, idLocal)
  }
  return map
}

// 3407 (Contactabilidad) y 3410 (Directorio Teléfonos) cuelgan los bloques
// telefono_contacto_*/correo_contacto_*/residencia_* directamente de <colect>;
// 3408 (Verificación Múltiple) los envuelve un nivel más adentro, en
// <telefonos>/<correos>/<direcciones> (protocolo v11, sección 2.6). Cada
// extractor mira primero el envoltorio y cae a <colect> si no existe.
function extractPhones(colect: any, productCode: string): DealernetPhone[] {
  const scope = colect?.telefonos ?? colect
  const imageIds = buildImageIdMap(colect)
  const out: DealernetPhone[] = []
  // La tercera categoría (laboral) aparece en respuestas reales de 3410 —
  // "TELÉFONOS ... LABORALES 6" en el impreso del portal.
  for (const categoria of ['probable', 'alternativo', 'laboral'] as const) {
    const block = scope?.[`telefono_contacto_${categoria}`]
    for (const d of toArray(block?.d)) {
      const raw = String(d?.telefono ?? '').trim()
      if (!raw) continue
      const rawIdImagen = extractIdImagen(d ?? {})
      out.push({
        phone_raw: raw,
        phone_e164: normalizePhoneCl(raw),
        categoria,
        clasificacion: d?.clasificacion != null ? String(d.clasificacion) : null,
        ind_whatsapp: d?.ind_whatsapp != null ? String(d.ind_whatsapp) === '1' : null,
        idimagen: rawIdImagen != null ? (imageIds.get(rawIdImagen) ?? rawIdImagen) : null,
        relacion: extractPhoneRelacion(d ?? {}),
        ranking: numOrNull(d?.ranking),
        calidad: numOrNull(d?.calidad),
        product_code: productCode,
      })
    }
  }
  return out
}

function extractAddresses(colect: any, productCode: string): DealernetAddress[] {
  const scope = colect?.direcciones ?? colect
  const out: DealernetAddress[] = []
  for (const categoria of ['probable', 'alternativo'] as const) {
    const block = scope?.[`residencia_${categoria === 'probable' ? 'probable' : 'alternativa'}`]
    for (const d of toArray(block?.d)) {
      const direccion = String(d?.direccion ?? '').trim()
      if (!direccion) continue
      out.push({
        direccion,
        ubicacion: d?.ubicacion != null ? String(d.ubicacion) : null,
        rol: d?.rol != null ? String(d.rol) : null,
        categoria,
        ranking: numOrNull(d?.ranking),
        calidad: numOrNull(d?.calidad),
        product_code: productCode,
      })
    }
  }
  return out
}

function extractEmails(colect: any, productCode: string): DealernetEmail[] {
  const scope = colect?.correos ?? colect
  const out: DealernetEmail[] = []
  for (const categoria of ['probable', 'alternativo'] as const) {
    const block = scope?.[`correo_contacto_${categoria}`]
    for (const d of toArray(block?.d)) {
      const email = String(d?.correo ?? '').trim()
      if (!email) continue
      out.push({
        email,
        categoria,
        ranking: numOrNull(d?.ranking),
        calidad: numOrNull(d?.calidad),
        product_code: productCode,
      })
    }
  }
  return out
}

export interface DealernetRelacionado {
  rut: number | null
  dv: string | null
  nombre: string | null
  relacion: string | null // Titular / Sociedad / Socio / Conyuge / Hijo / Empleador / ...
  product_code: string
}

const REL_RUT_ALIASES = ['rut', 'rutrel', 'rutnum', 'rutrelacionado']
const REL_DV_ALIASES = ['dv', 'digito', 'dvrel', 'digitorel']
// 'organizacion': en el XML real las empresas vienen con <nombres/> y
// <apellidos/> vacíos y la razón social en <organizacion> — sin este alias
// las Sociedades salían sin nombre ("—") en la tabla.
const REL_NOMBRE_ALIASES = ['nombre', 'nombrecompleto', 'razonsocial', 'organizacion', 'dsporg', 'glsnombre', 'nomrelacionado']
const REL_NOMBRES_ALIASES = ['nombres', 'dspnombres']
const REL_APELLIDOS_ALIASES = ['apellidos', 'dspapellidos', 'apellido']

// Nombres de contenedor donde vive la tabla "Relacionados" del portal. Se
// comparan normalizados igual que las keys de `normalizedEntries`.
const REL_CONTAINER_KEYS = new Set(['relacionados', 'registrosrelacionados', 'relaciones'])

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/^@_/, '').replace(/[_\s]/g, '')
}

// "propietario actual" / "propietario histórico" NO son un vínculo con el
// titular: marcan quién es (o fue) dueño de un inmueble del informe. Colarlas
// en la tabla Relacionados es lo que llenaba la ficha del dueño con decenas de
// desconocidos que no tienen nada que ver con él.
function esVinculoConTitular(relacion: string): boolean {
  const norm = relacion.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return !/^propietari[oa]s?\b/.test(norm)
}

// Filas RUT/NOMBRE/RELACIÓN de la tabla "Relacionados" del portal (Titular,
// Sociedad, Socio, Cónyuge, Hijo, Empleador, ...). En el XML real vienen
// incluidas en la propia respuesta de 3410 (Directorio Teléfonos), en
// <colect><relacionados><d>clasificacion/rut/dv/nombres/apellidos/
// organizacion/relacion</d>...</relacionados> — además del producto 3421.
//
// Solo se extrae DENTRO de ese contenedor. Antes se recorría el payload
// entero tomando como relacionado cualquier nodo con un campo de relación
// junto a un RUT o nombre: el resto de la respuesta trae más bloques con esa
// misma forma (la titularidad de cada dirección/predio del informe, con
// "propietario actual"/"propietario histórico"), así que la tabla mezclaba la
// familia y las sociedades del titular con decenas de dueños de otros
// inmuebles — el bug de la ficha con 97 "relacionados".
//
// Los bloques <relacionados> POR TELÉFONO también entran en el recorrido,
// pero solo traen <relacion> (sin RUT ni nombre), así que no emiten filas.
function extractRelacionados(wrapper: unknown, productCode: string): DealernetRelacionado[] {
  const out: DealernetRelacionado[] = []
  const seen = new Set<string>()

  // Emite filas de un nodo que YA se identificó como tabla de relacionados.
  function visit(node: unknown) {
    if (node == null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const entries = normalizedEntries(node as Record<string, unknown>)
    const relacion = firstScalar(entries, RELACION_ALIASES)
    const rutRaw = firstScalar(entries, REL_RUT_ALIASES)
    let nombre = firstScalar(entries, REL_NOMBRE_ALIASES)
    if (!nombre) {
      const nombres = firstScalar(entries, REL_NOMBRES_ALIASES)
      const apellidos = firstScalar(entries, REL_APELLIDOS_ALIASES)
      nombre = [nombres, apellidos].filter(Boolean).join(' ') || null
    }

    if (relacion && (rutRaw || nombre)) {
      if (!esVinculoConTitular(relacion)) return
      let rut: number | null = null
      let dv: string | null = null
      if (rutRaw) {
        // El RUT puede venir con DV pegado ("6.166.610-9") o como número puro
        // ("6166610") con el DV en un campo aparte o ausente. Solo se
        // interpreta DV embebido si el formato lo delata (guión o K final) —
        // en un número pelado el último dígito es parte del RUT, no el DV.
        const dvField = firstScalar(entries, REL_DV_ALIASES)
        if (/[-kK]/.test(rutRaw)) {
          const parsedRut = parseRut(rutRaw)
          if (parsedRut) {
            rut = parsedRut.num
            dv = parsedRut.dv
          }
        } else {
          const digits = rutRaw.replace(/\D/g, '')
          rut = digits ? parseInt(digits, 10) : null
        }
        if (dvField) dv = dvField.toUpperCase()
        if (rut != null && !dv) dv = computeRutDv(rut)
      }
      const key = `${rut ?? ''}|${nombre ?? ''}|${relacion}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ rut, dv, nombre, relacion, product_code: productCode })
      }
      return // no descender: los hijos de una fila ya emitida no son filas nuevas
    }

    for (const value of Object.values(node as Record<string, unknown>)) visit(value)
  }

  // Busca los contenedores <relacionados> en el payload y solo esos se leen
  // como tabla de relacionados.
  function findContainers(node: unknown) {
    if (node == null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) findContainers(item)
      return
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (REL_CONTAINER_KEYS.has(normalizeKey(key))) visit(value)
      else findContainers(value)
    }
  }

  findContainers(wrapper)

  // 3421 (Registros de Relacionados) ES la tabla: si su payload no trae el
  // contenedor con ese nombre, se lee entero como antes en vez de devolver
  // vacío el único producto que se pide justamente para esto.
  if (out.length === 0 && productCode === DEALERNET_PRODUCTS.REGISTROS_RELACIONADOS) visit(wrapper)

  return out
}

export interface DealernetLookupResult {
  retcode: number | null
  retmsg: string | null
  nombreTitular: string | null
  phones: DealernetPhone[]
  addresses: DealernetAddress[]
  emails: DealernetEmail[]
  relacionados: DealernetRelacionado[]
  productsRequested: string[]
  raw: unknown
}

export function parseDealernetResponse(xml: string, productsRequested: string[]): DealernetLookupResult {
  const parsed = xmlParser.parse(xml)
  const result = parsed?.Envelope?.Body?.CentralDeInformacionResult
  if (!result) {
    throw new Error('Respuesta DealerNet sin CentralDeInformacionResult — revisar credenciales/SOAPAction')
  }

  const rutOut = result.output?.rut
  const prds = toArray(rutOut?.prd)

  let nombreTitular: string | null = null
  const phones: DealernetPhone[] = []
  const addresses: DealernetAddress[] = []
  const emails: DealernetEmail[] = []
  const relacionados: DealernetRelacionado[] = []

  for (const prd of prds) {
    const productCode = prd?.['@_cod'] != null ? String(prd['@_cod']) : ''
    const wrapper = getProductWrapper(prd)
    const d = wrapper?.ROOT?.D
    if (!d) continue
    if (!nombreTitular && d['@_nombre']) nombreTitular = String(d['@_nombre'])
    // Los relacionados vienen incluidos en la respuesta de 3410 (y en 3421
    // si se pide) — se extraen de todos los productos y se deduplican abajo.
    relacionados.push(...extractRelacionados(d, productCode))
    const colect = d?.result?.colect
    if (!colect) continue
    phones.push(...extractPhones(colect, productCode))
    addresses.push(...extractAddresses(colect, productCode))
    emails.push(...extractEmails(colect, productCode))
  }

  // Mismo relacionado puede llegar por más de un producto (3410 y 3421).
  const relSeen = new Set<string>()
  const relacionadosUnicos = relacionados.filter(r => {
    const key = `${r.rut ?? ''}|${r.nombre ?? ''}|${r.relacion ?? ''}`
    if (relSeen.has(key)) return false
    relSeen.add(key)
    return true
  })

  return {
    retcode: result.retcode != null ? Number(result.retcode) : null,
    retmsg: result.retmsg != null ? String(result.retmsg) : null,
    nombreTitular,
    phones,
    addresses,
    emails,
    relacionados: relacionadosUnicos,
    productsRequested,
    raw: parsed,
  }
}

export async function queryDealernet(
  rut: ParsedRut,
  productCodes: string[] = DEFAULT_DEALERNET_PRODUCTS
): Promise<DealernetLookupResult> {
  const { user, pass } = getDealernetCreds()
  if (!user || !pass) {
    throw new Error('DEALERNET_USER / DEALERNET_PASSWORD no configurados en el entorno')
  }
  const body = buildRequestXml(rut, productCodes, user, pass)
  const res = await fetch(DEALERNET_WSDL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      // Convención .NET ASMX: namespace + nombre del método. No confirmado
      // explícitamente en el PDF — si DealerNet responde 500, lo primero a
      // revisar es este header.
      SOAPAction: 'http://dealernet.cl/webservices/CentralDeInformacion',
    },
    body,
  })
  const xml = await res.text()
  if (!res.ok) {
    throw new Error(`DealerNet HTTP ${res.status}: ${xml.slice(0, 500)}`)
  }
  return parseDealernetResponse(xml, productCodes)
}

// --- Buscador Múltiple (producto 3460) ---
// Búsqueda de candidatos por nombre/empresa/teléfono/dirección/rol/patente,
// sin necesitar el RUT de antemano. Ver docs/DEALERNET-PROTOCOLO.md.

function buildBuscadorMultipleXml(
  tipbusq: BuscadorMultipleTipo,
  args: string,
  user: string,
  pass: string
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://dealernet.cl/webservices/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:CentralDeInformacion>
      <web:ctausr>${escapeXml(user)}</web:ctausr>
      <web:ctapwd>${escapeXml(pass)}</web:ctapwd>
      <web:input>
        <root>
          <tipocns>O</tipocns>
          <param>
            <busq tipbusq="${escapeXml(tipbusq)}" args="${escapeXml(args)}"/>
          </param>
          <prods>
            <prod cod="${DEALERNET_PRODUCTS.BUSCADOR_MULTIPLE}"/>
          </prods>
        </root>
      </web:input>
    </web:CentralDeInformacion>
  </soapenv:Body>
</soapenv:Envelope>`
}

export interface DealernetCandidato {
  rut: number | null
  dv: string | null
  clasif: string | null // P = persona natural, E = empresa
  nombres: string | null
  apellidos: string | null
  razonSocial: string | null
  propietario: string | null // Histórico/Actual
  similitud: number | null
  probabilidad: string | null // Alta/Media/Baja
}

// El Buscador Múltiple por rol marca cada candidato como propietario "Actual"
// o "Histórico" (campo PROPIETARIO). Un histórico es un dueño ANTERIOR del
// predio: no es a quien hay que llamar, y cada consulta de contactabilidad se
// paga — así que nunca se elige solo, solo a mano.
function propietarioNorm(c: DealernetCandidato): string {
  return (c.propietario ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function esPropietarioHistorico(c: DealernetCandidato): boolean {
  return propietarioNorm(c).startsWith('histor')
}

export function esPropietarioActual(c: DealernetCandidato): boolean {
  return propietarioNorm(c).startsWith('actual')
}

export interface DealernetBuscadorMultipleResult {
  retcode: number | null
  retmsg: string | null
  candidatos: DealernetCandidato[]
  raw: unknown
}

export function parseBuscadorMultipleResponse(xml: string): DealernetBuscadorMultipleResult {
  const parsed = xmlParser.parse(xml)
  const result = parsed?.Envelope?.Body?.CentralDeInformacionResult
  if (!result) {
    throw new Error('Respuesta DealerNet sin CentralDeInformacionResult — revisar credenciales/SOAPAction')
  }

  const datos = toArray(result.output?.DATOS?.DATO)
  const candidatos: DealernetCandidato[] = datos.map((d: any) => {
    const rut = numOrNull(d?.RUT)
    // En respuestas reales del 3460 el <DIGITO> a veces viene vacío/ausente
    // (la UI mostraba "RUT 4.778.091-null" y el candidato quedaba
    // deshabilitado). El DV chileno es determinista, así que se calcula del
    // número cuando falta.
    let dv = d?.DIGITO != null && String(d.DIGITO).trim() !== '' ? String(d.DIGITO).trim().toUpperCase() : null
    if (rut != null && (dv == null || dv === 'NULL')) dv = computeRutDv(rut)
    return {
      rut,
      dv,
      clasif: d?.CLASIF != null ? String(d.CLASIF) : null,
      nombres: d?.DSPNOMBRES != null ? String(d.DSPNOMBRES) : null,
      apellidos: d?.DSPAPELLIDOS != null ? String(d.DSPAPELLIDOS) : null,
      razonSocial: d?.DSPORG != null ? String(d.DSPORG) : null,
      propietario: d?.PROPIETARIO != null ? String(d.PROPIETARIO) : null,
      similitud: numOrNull(d?.SIMILITUD),
      probabilidad: d?.PROBABILIDAD != null ? String(d.PROBABILIDAD) : null,
    }
  })

  return {
    retcode: result.retcode != null ? Number(result.retcode) : null,
    retmsg: result.retmsg != null ? String(result.retmsg) : null,
    candidatos,
    raw: parsed,
  }
}

// Para tipbusq="rol"/"direccion" el protocolo espera "valor, comuna" — si el
// usuario pega texto con espacios dobles (ej. tras una coma) o espacios al
// borde, el matching fuzzy de DealerNet para comuna puede no encontrar
// coincidencia y devolver 0 candidatos sin que sea un error real de
// DealerNet. Normalizamos espacios para no depender de que el usuario tipee
// perfecto — y para tener una clave de caché estable en dealernet-buscar.
export function normalizeBuscadorMultipleArgs(args: string): string {
  return args.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ')
}

export async function queryDealernetBuscadorMultiple(
  tipbusq: BuscadorMultipleTipo,
  args: string
): Promise<DealernetBuscadorMultipleResult> {
  const { user, pass } = getDealernetCreds()
  if (!user || !pass) {
    throw new Error('DEALERNET_USER / DEALERNET_PASSWORD no configurados en el entorno')
  }
  const normalizedArgs = normalizeBuscadorMultipleArgs(args)
  const body = buildBuscadorMultipleXml(tipbusq, normalizedArgs, user, pass)
  const res = await fetch(DEALERNET_WSDL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://dealernet.cl/webservices/CentralDeInformacion',
    },
    body,
  })
  const xml = await res.text()
  if (!res.ok) {
    throw new Error(`DealerNet HTTP ${res.status}: ${xml.slice(0, 500)}`)
  }
  return parseBuscadorMultipleResponse(xml)
}
