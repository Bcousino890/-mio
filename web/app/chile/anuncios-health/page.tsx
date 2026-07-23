import AnunciosHealthClient from './AnunciosHealthClient'

export const metadata = {
  title: 'Salud del scraping - Anuncios CL',
  description: 'Estado del pipeline de Anuncios CL en vivo: ingesta, dedup, corredoras y cobertura por comuna.',
}

export const dynamic = 'force-dynamic'

export default function AnunciosHealthPage() {
  return <AnunciosHealthClient />
}
