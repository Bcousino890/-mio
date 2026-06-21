import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import ThemeProvider from '@/components/ThemeProvider'
import ChatWidget from '@/components/ChatWidget'

export const metadata: Metadata = {
  title: 'Casafari Mio · Madrid',
  description: 'Plataforma de captación y análisis inmobiliario',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full" data-theme="dark">
      <body className="h-full overflow-hidden">
        <ThemeProvider>
          <Sidebar />
          <main
            style={{ marginLeft: 'var(--sidebar-w)', background: 'var(--c-bg)' }}
            className="h-full"
          >
            {children}
          </main>
          <ChatWidget />
        </ThemeProvider>
      </body>
    </html>
  )
}
