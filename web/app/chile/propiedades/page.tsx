import PropiedadesChileClient from './PropiedadesChileClient'

export const metadata = {
  title: 'Propiedades - Portal Inmobiliario Chile',
  description: 'Inmuebles canónicos deduplicados: 1 propiedad = 1 ficha, aunque la publiquen N corredoras.',
}

export const dynamic = 'force-dynamic'

// Los filtros de la URL se leen AQUÍ, en el servidor, y bajan como props.
//
// El cliente los sacaba de `window.location.search`, que durante el render del
// servidor no existe: el HTML salía con los filtros vacíos y el navegador
// pintaba otra cosa al hidratar. Eso es un error de hidratación en toda regla
// —React lo lanza, lo registra y rehace el árbol entero— en CADA carga de un
// enlace con filtros (compartido, recargado o con la ficha abierta). Con la
// página en `force-dynamic` no hay motivo para esconderle la query al servidor:
// así los dos lados pintan lo mismo desde el principio.
export default async function PropiedadesChilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const initialParams: Record<string, string> = {}
  for (const [key, value] of Object.entries(sp)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first != null) initialParams[key] = first
  }
  return <PropiedadesChileClient initialParams={initialParams} />
}
