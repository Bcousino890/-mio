import { NextRequest, NextResponse } from 'next/server'
import { resolveRolAtPoint, findCrmCaptacionByRol } from '@/lib/captar-pipeline'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chile/rol-at-point?lat=-33.39626&lng=-70.54309
//
// Resuelve, EN VIVO, la parcela SII (catastro) que hay debajo de un punto —
// point-in-polygon sobre cadastre_parcels_cl, mismo criterio que el visor de
// /chile/catastro — junto con la dirección exacta del rol y si el inmueble ya
// está captado en el CRM (dueño + teléfonos para llamar).
//
// Lo usa la ficha de Propiedades: cuando el equipo arrastra el "pin real",
// ve al instante el rol de abajo, la dirección exacta y el contacto guardado,
// antes de pulsar "Guardar ubicación" (que lo persiste vía PATCH property-cl).
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const lat = Number(sp.get('lat'))
  const lng = Number(sp.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ success: false, error: 'lat/lng requeridos' }, { status: 400 })
  }

  try {
    const parcel = await resolveRolAtPoint(lat, lng)
    if (!parcel) {
      // Sin parcela bajo el pin: el catastro no está cargado en esa zona (o el
      // pin cayó en calle/espacio público). No es un error — el cliente lo
      // muestra como "sin rol bajo el pin".
      return NextResponse.json({ success: true, parcel: null, crm: null })
    }
    const crm = await findCrmCaptacionByRol(parcel.rol, parcel.sii_comuna_code)
    return NextResponse.json({ success: true, parcel, crm })
  } catch (error) {
    console.error('rol-at-point error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
