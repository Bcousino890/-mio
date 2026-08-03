# ─────────────────────────────────────────────────────────────────────────────
# Imagen del worker 24/7 de Anuncios CL (worker-cl.mjs, plan Anuncios CL · H2).
#
# node:20-bookworm-slim (no Alpine): `sharp` (phash.mjs) usa binarios
# nativos precompilados con glibc; en musl (Alpine) a veces exige recompilar
# desde fuente, más lento y más frágil en el build del CI. Mismo criterio que
# ya usa web/Dockerfile para su propio runner stage.
#
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1: package.json de scraper/ es compartido
# con otros scripts que sí usan playwright (scrape-zone.mjs, spikes) — no se
# separa un package.json aparte solo para este worker. worker-cl.mjs NUNCA
# importa playwright ni lanza un navegador (ver cabecera del archivo: "sin
# Playwright" es un requisito de H2 para caber en el CX33 compartido), así
# que solo evitamos la descarga pesada del binario del navegador en build
# time — el paquete npm en sí queda instalado pero inerte en runtime.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# curl es OBLIGATORIO: fetch.mjs descarga todo el HTML vía `execFile('curl', …)`
# (curl pasa el fingerprint TLS/JA3 mejor que undici para los anti-bot). La
# imagen base bookworm-slim NO lo trae → sin esto, TODAS las descargas del worker
# fallan con `spawn curl ENOENT` y el barrido ingresa 0 anuncios. ca-certificates
# para validar TLS de los portales.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# El contexto de build es la RAÍZ del repo, no scraper/, y la imagen reproduce
# el árbol del repositorio (/app/scraper + /app/web/lib). No es un capricho de
# estructura: worker-cl.mjs importa el contrato con SmartBC desde
# ../../web/lib/smartbc/ —una sola definición en todo el repo, la misma que usan
# la web y el CLI (sync-smartbc-cl.mjs)— y con el contexto en scraper/ esos
# ficheros quedaban fuera del build. El worker arrancaba y moría con
# MODULE_NOT_FOUND, llevándose por delante todo el scraping, que no tiene nada
# que ver con el CRM.
WORKDIR /app/scraper
COPY scraper/package*.json ./
RUN npm ci --omit=dev

COPY scraper/lib ./lib
COPY scraper/worker-cl.mjs ./
COPY scraper/backfill-anuncios-cl.mjs ./

# Solo los .mjs que el worker necesita — `web/lib` entero arrastraría el
# TypeScript del CRM y sus imports con alias (@/lib/db), que aquí no resuelven.
COPY web/lib/smartbc/*.mjs /app/web/lib/smartbc/
COPY web/lib/rol-format.mjs /app/web/lib/

CMD ["node", "worker-cl.mjs"]
