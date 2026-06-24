import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseRut, isValidRut } from '@/lib/dealernet'

function getDealernetCreds() {
  const user = process.env.DEALERNET_USER
  const pass = process.env.DEALERNET_PASSWORD
  if (user && pass) return { user, pass }
  try {
    const content = readFileSync(join(process.cwd(), '.env'), 'utf-8')
    const parse = (key: string) => content.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? null
    return { user: user ?? parse('DEALERNET_USER'), pass: pass ?? parse('DEALERNET_PASSWORD') }
  } catch {
    return { user: null, pass: null }
  }
}

function escapeXml(v: string) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// GET /api/chile/dealernet-debug?rut=8.546.024-2&products=3410,3407
// Returns the raw SOAP XML so we can inspect the actual response structure
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const rutParam = sp.get('rut')?.trim()
  const products = (sp.get('products') ?? '3410').split(',').map(s => s.trim()).filter(Boolean)

  if (!rutParam) return NextResponse.json({ error: 'rut requerido' }, { status: 400 })

  const rut = parseRut(rutParam)
  if (!rut) return NextResponse.json({ error: 'RUT inválido' }, { status: 400 })
  if (!isValidRut(rut)) return NextResponse.json({ error: 'Dígito verificador incorrecto' }, { status: 400 })

  const { user, pass } = getDealernetCreds()
  if (!user || !pass) return NextResponse.json({ error: 'Credenciales no configuradas' }, { status: 500 })

  const prods = products.map(cod => `<prod cod="${escapeXml(cod)}" gls="" />`).join('')
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://dealernet.cl/webservices/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:CentralDeInformacion>
      <web:ctausr>${escapeXml(user)}</web:ctausr>
      <web:ctapwd>${escapeXml(pass)}</web:ctapwd>
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

  const wsdl = process.env.DEALERNET_WSDL_URL ?? 'http://infows.dealernet.cl/wsinfodlnt.asmx'

  try {
    const res = await fetch(wsdl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://dealernet.cl/webservices/CentralDeInformacion',
      },
      body,
    })
    const xml = await res.text()
    // Return raw XML as plain text so it can be inspected
    return new Response(xml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error de red' }, { status: 502 })
  }
}
