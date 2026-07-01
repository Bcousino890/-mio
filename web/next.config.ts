import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // El tracer de archivos de Next (@vercel/nft) sigue requires estáticos,
  // pero playwright-core carga varios de sus módulos (registro de
  // navegadores, protocolo, utilsBundle) con requires calculados en
  // runtime — sin este include explícito, la copia "standalone" solo
  // trae ~8 de los 106 archivos del paquete y la consulta TGR on-demand
  // (web/lib/tgr.ts) revienta en producción con "Cannot find module".
  outputFileTracingIncludes: {
    '/api/chile/tgr-lookup/**': ['./node_modules/playwright-core/**'],
  },
}

export default nextConfig
