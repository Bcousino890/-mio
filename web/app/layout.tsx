import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'Casafari Mio · Madrid',
  description: 'Plataforma de captación y análisis inmobiliario',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Sidebar />
        <main
          style={{ marginLeft: 'var(--sidebar-w)' }}
          className="min-h-screen bg-[#0a0d14]"
        >
          {children}
        </main>
      </body>
    </html>
  )
}
