import AnunciosChileClient from './AnunciosChileClient'

export const metadata = {
  title: 'Anuncios - Portal Inmobiliario Chile',
  description: 'Anuncios de venta y arriendo de inmuebles en la Región Metropolitana de Chile, scrapeados de Portal Inmobiliario.',
}

export const dynamic = 'force-dynamic'

export default function AnunciosChilePage() {
  return <AnunciosChileClient />
}
