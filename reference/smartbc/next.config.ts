import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Por defecto Next limita el body de las server actions a 1MB, lo que
      // rompía "Subir video (.mp4)" y la subida de planos/fotos grandes.
      // El límite máximo de la app para videos es 5GB.
      bodySizeLimit: "5gb",
    },
  },
  // Estos paquetes usan `require()` dinámico y APIs nativas (binarios de
  // Chromium) que Next.js no puede bundlear. Los marcamos como externos
  // del server runtime para que se carguen tal cual en Node.js.
  serverExternalPackages: [
    "playwright",
    "playwright-extra",
    "puppeteer-extra-plugin-stealth",
    "puppeteer-extra-plugin",
    "merge-deep",
    "clone-deep",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        // Backend self-host en Hetzner (Supabase Storage). Las fotos
        // sincronizadas con watermark se sirven desde aquí.
        protocol: "https",
        hostname: "crm.bcousinoprop.com",
        pathname: "/storage/v1/object/public/**",
      },
      // Import-by-link: al crear, las fotos de la GALERÍA se guardan primero con
      // su URL de ORIGEN y se re-alojan a nuestro storage en segundo plano.
      // Durante esa ventana, la galería del admin (next/image) necesita poder
      // cargar el origen de los portales que soportamos. (La PORTADA se procesa
      // síncrona, así que el catálogo siempre apunta a nuestro storage.)
      {
        // Clikalia sirve sus fotos desde este bucket.
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
      {
        // UrbantecHome.
        protocol: "https",
        hostname: "urbantechome.com",
      },
    ],
  },
};

export default nextConfig;
