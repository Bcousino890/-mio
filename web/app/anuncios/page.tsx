import AnunciosClient from './AnunciosClient'

// Next.js ignores `dynamic = 'force-dynamic'` when declared in a 'use client'
// file, so it must live here in the Server Component shell, not in AnunciosClient.
export const dynamic = 'force-dynamic'

export default function AnunciosPage() {
  return <AnunciosClient />
}
