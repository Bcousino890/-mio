import { NextRequest, NextResponse } from 'next/server'
import { resolveRolAtPoint, resolveRolByRol, findCrmCaptacionByRol } from '@/lib/captar-pipeline'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chile/rol-at-point?lat=-33.39626&lng=-70.54309
// GET /api/chile/rol-at-point?rol=3686-60&comuna=15161
//
// Resuelve, EN VIVO, la parcela SII (catastro) — de dos formas:
//
//   · Por PUNTO (lat/lng): point-in-polygon sobre cadastre_parcels_cl, mismo
//     criterio que el visor de /chile/catastro. Es lo que dispara arrastrar
//     el "pin real" sobre el mapa.
//   · Por ROL exacto (rol/comuna): para cuando el equipo YA SABE cuál es el
//     predio correcto (por dirección o por rol) y el pin no alcanza a
//     distinguirlo de sus vecinos casi idénticos — un mismo predio subdividido
//     en unidades contiguas ("CASA-A", "CASA-B"…) donde errar el pin por un
//     par de metros cae en la de al lado. Se usa tras elegir un resultado del
//     buscador (/api/chile/sii-search) desde la ficha.
//
// En ambos casos se devuelve la misma forma (parcela + dirección exacta +
// avalúo/superficie + si el inmueble ya está captado en el CRM con dueño y
// teléfonos para llamar), antes de pulsar "Guardar ubicación" (que lo
// persiste vía PATCH property-cl).
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const rol = sp.get('rol')?.trim()
  const comuna = sp.get('comuna')?.trim()

  try {
    let parcel
    if (rol) {
      if (!comuna) {
        return NextResponse.json({ success: false, error: 'comuna requerida junto con rol' }, { status: 400 })
      }
      parcel = await resolveRolByRol(comuna, rol)
    } else {
      const lat = Number(sp.get('lat'))
      const lng = Number(sp.get('lng'))
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return NextResponse.json({ success: false, error: 'lat/lng, o rol/comuna, requeridos' }, { status: 400 })
      }
      parcel = await resolveRolAtPoint(lat, lng)
    }
    if (!parcel) {
      // Sin parcela (bajo el pin, o para ese rol): el catastro no está cargado
      // en esa zona/rol (o el pin cayó en calle/espacio público). No es un
      // error — el cliente lo muestra como "sin rol" / "sin parcela gráfica".
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
