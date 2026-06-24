// Cliente del web service SOAP de DealerNet ("Central de Información").
// Protocolo: un único método `CentralDeInformacion` que recibe un RUT y N
// códigos de "producto", documentado en DEALERNET - Protocolo Web-Services
// v11. No existe búsqueda por dirección en este protocolo — solo por RUT.
import { XMLParser } from 'fast-xml-parser'

const DEALERNET_WSDL_URL = process.env.DEALERNET_WSDL_URL || 'http://infows.dealernet.cl/wsinfodlnt.asmx'
const DEALERNET_USER = process.env.DEALERNET_USER
const DEALERNET_PASSWORD = process.env.DEALERNET_PASSWORD

export const DEALERNET_PRODUCTS = {
  CONTACTABILIDAD: '3407',
  VERIFICACION_MULTIPLE: '3408',
  DIRECTORIO_TELEFONOS: '3410',
} as const

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

function buildRequestXml(rut: ParsedRut, productCodes: string[]): string {
  const user = escapeXml(DEALERNET_USER ?? '')
  const pass = escapeXml(DEALERNET_PASSWORD ?? '')
  const prods = productCodes.map(cod => `<prod cod="${escapeXml(cod)}" gls="" />`).join('')
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://dealernet.cl/webservices/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:CentralDeInformacion>
      <web:ctausr>${user}</web:ctausr>
      <web:ctapwd>${pass}</web:ctapwd>
      <web:input>
        <root>
          <tipocns>O</tipocns>
          <ruts>
            <rut num="${rut.num}" dv="${escapeXml(rut.dv)}" serie="" />
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

function extractPhones(colect: any, productCode: string): DealernetPhone[] {
  const out: DealernetPhone[] = []
  for (const categoria of ['probable', 'alternativo'] as const) {
    const block = colect?.[`telefono_contacto_${categoria}`]
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
        ranking: numOrNull(d?.ranking),
        calidad: numOrNull(d?.calidad),
        product_code: productCode,
      })
    }
  }
  return out
}

function extractAddresses(colect: any, productCode: string): DealernetAddress[] {
  const out: DealernetAddress[] = []
  for (const categoria of ['probable', 'alternativo'] as const) {
    const block = colect?.[`residencia_${categoria === 'probable' ? 'probable' : 'alternativa'}`]
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
  const out: DealernetEmail[] = []
  for (const categoria of ['probable', 'alternativo'] as const) {
    const block = colect?.[`correo_contacto_${categoria}`]
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

export interface DealernetLookupResult {
  retcode: number | null
  retmsg: string | null
  nombreTitular: string | null
  phones: DealernetPhone[]
  addresses: DealernetAddress[]
  emails: DealernetEmail[]
  productsRequested: string[]
  raw: unknown
}

function parseDealernetResponse(xml: string, productsRequested: string[]): DealernetLookupResult {
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

  for (const prd of prds) {
    const productCode = prd?.['@_cod'] != null ? String(prd['@_cod']) : ''
    const wrapper = getProductWrapper(prd)
    const d = wrapper?.ROOT?.D
    if (!d) continue
    if (!nombreTitular && d['@_nombre']) nombreTitular = String(d['@_nombre'])
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
    productsRequested,
    raw: parsed,
  }
}

export async function queryDealernet(
  rut: ParsedRut,
  productCodes: string[] = DEFAULT_DEALERNET_PRODUCTS
): Promise<DealernetLookupResult> {
  if (!DEALERNET_USER || !DEALERNET_PASSWORD) {
    throw new Error('DEALERNET_USER / DEALERNET_PASSWORD no configurados en el entorno')
  }
  const body = buildRequestXml(rut, productCodes)
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
