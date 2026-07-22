import CorredoraFichaClient from './CorredoraFichaClient'

export const metadata = {
  title: 'Ficha de corredora - Chile',
  description: 'Identidad, métricas e inventario de una corredora consolidada.',
}

export const dynamic = 'force-dynamic'

export default async function CorredoraFichaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CorredoraFichaClient id={id} />
}
