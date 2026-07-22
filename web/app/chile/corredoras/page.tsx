import CorredorasChileClient from './CorredorasChileClient'

export const metadata = {
  title: 'Corredoras - Portal Inmobiliario Chile',
  description: 'Directorio de corredoras consolidadas por advertiser_id de Mercado Libre, con stock, rotación y exclusividad.',
}

export const dynamic = 'force-dynamic'

export default function CorredorasChilePage() {
  return <CorredorasChileClient />
}
