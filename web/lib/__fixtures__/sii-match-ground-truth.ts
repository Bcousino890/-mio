// Casos reales de "Captar desde URL" con el rol correcto ya confirmado
// (por el usuario, vía TGR, o por otra verificación externa). Este archivo es
// el "ground truth" contra el que corre `scripts/eval-sii-matching.ts` — cada
// vez que se ajuste una señal o un peso en `sii-match-cl-v2.ts`, ese script
// mide el efecto real sobre estos casos en vez de calcularlo a mano.
//
// Cómo agregar un caso nuevo:
//   1. Captar la URL en /chile/captar-url y copiar el `listing` (raw_extracted
//      + sqm/bedrooms/etc de la captación) y el array `candidates` tal cual
//      quedó guardado en `captaciones_cl.candidates` (son las mismas filas que
//      devuelve `findSiiCandidatesV3`, ya con match_score calculado — solo se
//      necesitan los campos de entrada de SiiCandidateRow, no el resultado).
//   2. Agregar `correctRol` con el rol verdadero (confirmado manualmente).
//   3. Correr `npx tsx scripts/eval-sii-matching.ts` desde `web/` y revisar
//      que el nuevo caso quede en el reporte.
import type { ParsedListing, SiiCandidateRow } from '../sii-match-cl-v2'

export interface GroundTruthCase {
  name: string
  url?: string
  listing: ParsedListing
  candidates: SiiCandidateRow[]
  correctRol: string
  notes?: string
}

// Caso 1 — Camino La Tagua, Lo Barnechea ("Linda Casa Mediterránea - Bajo Su
// Valor - Santuario Del Valle", MLC-1996220639). Parcelación de ~12 lotes de
// tamaño casi idéntico en el mismo camino privado, sin numeración en la
// dirección del anuncio. El usuario confirmó que el rol correcto es 3806-11,
// que antes del fix de evidencia continua ni siquiera entraba al top 3
// (ganaba el más cercano en distancia, no el de terreno más parecido).
const listing1: ParsedListing = {
  address: 'Cam. La Tagua',
  address_full: 'Cam. La Tagua, Lo Barnechea',
  lat: -33.35,
  lng: -70.53,
  sqm_terreno: 889,
  sqm_construida: 420,
  floors: 3,
  year_built: 2018,
  has_pool: true,
  bedrooms: 5,
  bathrooms: 4,
  property_type: 'casa',
  operation: 'sale',
}

// Réplica de los 12 candidatos reales (terreno + distancia observados en la
// UI); superficie_construida_m2/numero_pisos/anio_construccion no se veían en
// la explicación mostrada (probablemente sin datos en sii_construcciones_cl
// para estos roles — ver PR #103), así que quedan en null hasta confirmar
// contra la base real.
const candidateBase: Omit<SiiCandidateRow, 'rol' | 'direccion' | 'superficie_terreno_m2' | 'distance_m' | 'avaluo_fiscal_total'> = {
  superficie_construida_m2: null,
  codigo_destino_principal: 'H',
  rol_padre: null,
  lat: null,
  lng: null,
  text_sim: null,
  numero_pisos: null,
  anio_construccion: null,
}

const candidates1: SiiCandidateRow[] = [
  { ...candidateBase, rol: '3808-27', direccion: 'CAMINO LA TAGUA 3633 LT 35', superficie_terreno_m2: 841, distance_m: 27, avaluo_fiscal_total: 579_000_000 },
  { ...candidateBase, rol: '3808-28', direccion: 'CAMINO LA TAGUA 3635 LT 36', superficie_terreno_m2: 855, distance_m: 33, avaluo_fiscal_total: 591_000_000 },
  { ...candidateBase, rol: '3806-15', direccion: 'CAMINO LA TAGUA 3632 LT 76', superficie_terreno_m2: 878, distance_m: 34, avaluo_fiscal_total: 799_000_000 },
  { ...candidateBase, rol: '3808-26', direccion: 'CAMINO LA TAGUA 3631 LT 34', superficie_terreno_m2: 840, distance_m: 39, avaluo_fiscal_total: 640_000_000 },
  { ...candidateBase, rol: '3806-13', direccion: 'CAMINO LA TAGUA 3638 LT 74', superficie_terreno_m2: 883, distance_m: 42, avaluo_fiscal_total: 776_000_000 },
  { ...candidateBase, rol: '3806-16', direccion: 'CAMINO LA TAGUA 3630 LT 11', superficie_terreno_m2: 878, distance_m: 53, avaluo_fiscal_total: 599_000_000 },
  { ...candidateBase, rol: '3808-25', direccion: 'CAMINO LA TAGUA 3629 LT 33', superficie_terreno_m2: 840, distance_m: 59, avaluo_fiscal_total: 652_000_000 },
  { ...candidateBase, rol: '3806-12', direccion: 'CAMINO LA TAGUA 3640 LT 73', superficie_terreno_m2: 889, distance_m: 64, avaluo_fiscal_total: 933_000_000 },
  { ...candidateBase, rol: '3806-17', direccion: 'CAMINO LA TAGUA 3626 LT 78', superficie_terreno_m2: 895, distance_m: 74, avaluo_fiscal_total: 633_000_000 },
  { ...candidateBase, rol: '3808-24', direccion: 'CAMINO LA TAGUA 3627 LT 32', superficie_terreno_m2: 840, distance_m: 81, avaluo_fiscal_total: 610_000_000 },
  { ...candidateBase, rol: '3806-11', direccion: 'CAMINO LA TAGUA 3646 LT 72', superficie_terreno_m2: 906, distance_m: 90, avaluo_fiscal_total: 947_000_000 },
  { ...candidateBase, rol: '3808-31', direccion: 'CAMINO LA TAGUA 3641 LT 39', superficie_terreno_m2: 915, distance_m: 96, avaluo_fiscal_total: 734_000_000 },
]

export const GROUND_TRUTH: GroundTruthCase[] = [
  {
    name: 'Camino La Tagua, Lo Barnechea (parcelación, 12 lotes similares)',
    url: 'https://www.portalinmobiliario.com/MLC-1996220639-linda-casa-mediterranea-bajo-su-valor-santuario-del-valle-_JM',
    listing: listing1,
    candidates: candidates1,
    correctRol: '3806-11',
    notes:
      'Confirmado por el usuario el 2026-07-04. Sin numero de calle en el anuncio (address evidence no discrimina). ' +
      'Con datos de terreno+distancia únicamente, hay ~9 candidatos casi indistinguibles entre sí — ' +
      'pendiente confirmar si sii_construcciones_cl tiene pisos/año/construida para estos roles, que sería la señal ' +
      'que realmente debería separar al 3806-11 del resto.',
  },
  // TODO: agregar el caso "Arquitecto Mardones En Condominio Valle Escondido"
  // (Sendero Las Lomas 2936, Lo Barnechea) en cuanto se confirme el rol
  // correcto — los 12 candidatos que devolvió el pipeline eran todos de un
  // condominio distinto ("Camino de la Laguna 15301") a 586 m del pin, lo que
  // sugiere que el rol real no está en sii_roles_cl con lat/lng válido, o que
  // el pin del portal está mal ubicado. Sin el rol correcto y sus datos SII
  // reales no se puede armar un caso de ground truth útil todavía (ver PR #103).
]
