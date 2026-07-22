import PropiedadesChileClient from './PropiedadesChileClient'

export const metadata = {
  title: 'Propiedades - Portal Inmobiliario Chile',
  description: 'Inmuebles canónicos deduplicados: 1 propiedad = 1 ficha, aunque la publiquen N corredoras.',
}

export const dynamic = 'force-dynamic'

export default function PropiedadesChilePage() {
  return <PropiedadesChileClient />
}
