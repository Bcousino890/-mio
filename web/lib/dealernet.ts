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
  categoria: 'probable' | 'alternativo'
  clasificacion: string | null
  ind_whatsapp: boolean | null
  idimagen: string | null
  relacion: string | null
  ranking: number | null
  calidad: number | null
  product_code: string
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

// "Relación" de un teléfono: de quién es el número cuando no es del titular
// (ej. cónyuge/hijo/sociedad). Se arma un solo string legible para UI/BD.
function extractPhoneRelacion(d: Record<string, unknown>): string | null {
  const entries = normalizedEntries(d)
  const relacion = firstScalar(entries, RELACION_ALIASES)
  const nombre = firstScalar(entries, RELACION_NOMBRE_ALIASES)
  if (relacion && nombre) return `${relacion} — ${nombre}`
  return relacion ?? nombre
}

// 3407 (Contactabilidad) y 3410 (Directorio Teléfonos) cuelgan los bloques
// telefono_contacto_*/correo_contacto_*/residencia_* directamente de <colect>;
// 3408 (Verificación Múltiple) los envuelve un nivel más adentro, en
// <telefonos>/<correos>/<direcciones> (protocolo v11, sección 2.6). Cada
// extractor mira primero el envoltorio y cae a <colect> si no existe.
function extractPhones(colect: any, productCode: string): DealernetPhone[] {
  const scope = colect?.telefonos ?? colect
  const out: DealernetPhone[] = []
  for (const categoria of ['probable', 'alternativo'] as const) {
    const block = scope?.[`telefono_contacto_${categoria}`]
    for (const d of toArray(block?.d)) {
      const raw = String(d?.telefono ?? '').trim()
      if (!raw) continue
      out.push({
        phone_raw: raw,
        phone_e164: normalizePhoneCl(raw),
        categoria,
        clasificacion: d?.clasificacion != null ? String(d.clasificacion) : null,
        ind_whatsapp: d?.ind_whatsapp != null ? String(d.ind_whatsapp) === '1' : null,
        idimagen: d?.idimagen != null ? String(d.idimagen) : null,
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
const REL_NOMBRE_ALIASES = ['nombre', 'nombrecompleto', 'razonsocial', 'dsporg', 'glsnombre', 'nomrelacionado']
const REL_NOMBRES_ALIASES = ['nombres', 'dspnombres']
const REL_APELLIDOS_ALIASES = ['apellidos', 'dspapellidos', 'apellido']

// 3421 (Registros de Relacionados) devuelve filas RUT/NOMBRE/RELACIÓN (la
// tabla "Relacionados" del portal DealerNet: Titular, Sociedad, Socio,
// Cónyuge, Hijo, Empleador, ...). Como la estructura exacta del XML no está
// en la doc versionada, se recorre el payload del producto en profundidad y
// se toma como relacionado cualquier nodo que tenga un campo de relación
// junto a un RUT o nombre — resistente a cambios de envoltorio/anidación.
function extractRelacionados(wrapper: unknown, productCode: string): DealernetRelacionado[] {
  const out: DealernetRelacionado[] = []
  const seen = new Set<string>()

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

  visit(wrapper)
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
    if (productCode === DEALERNET_PRODUCTS.REGISTROS_RELACIONADOS) {
      relacionados.push(...extractRelacionados(d, productCode))
    }
    const colect = d?.result?.colect
    if (!colect) continue
    phones.push(...extractPhones(colect, productCode))
    addresses.push(...extractAddresses(colect, productCode))
    emails.push(...extractEmails(colect, productCode))
  }

  return {
    retcode: result.retcode != null ? Number(result.retcode) : null,
    retmsg: result.retmsg != null ? String(result.retmsg) : null,
    nombreTitular,
    phones,
    addresses,
    emails,
    relacionados,
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

export async function queryDealernetBuscadorMultiple(
  tipbusq: BuscadorMultipleTipo,
  args: string
): Promise<DealernetBuscadorMultipleResult> {
  const { user, pass } = getDealernetCreds()
  if (!user || !pass) {
    throw new Error('DEALERNET_USER / DEALERNET_PASSWORD no configurados en el entorno')
  }
  // Para tipbusq="rol"/"direccion" el protocolo espera "valor, comuna" — si el
  // usuario pega texto con espacios dobles (ej. tras una coma) o espacios al
  // borde, el matching fuzzy de DealerNet para comuna puede no encontrar
  // coincidencia y devolver 0 candidatos sin que sea un error real de
  // DealerNet. Normalizamos espacios para no depender de que el usuario
  // tipee perfecto.
  const normalizedArgs = args.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ')
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
