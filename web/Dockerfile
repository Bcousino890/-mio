# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Stage 3: runner (Next.js standalone) ─────────────────────────────────────
# Debian (no Alpine) en este stage: la ingesta de GeoParquet de catastral.cl
# usa geopandas, que depende de GDAL/GEOS/PROJ — Alpine (musl) no tiene
# wheels precompilados en PyPI para esas libs y compilarlas desde fuente es
# pesado y frágil. Debian sí trae python3-geopandas empaquetado con bindings
# de GDAL funcionando vía apt, sin compilar nada.
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# standalone output incluye un server.js mínimo con sus propias dependencias.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public

# unzip: la subida SII y la ingesta de catastral.cl extraen .zip a disco vía
# CLI en vez de cargarlos completos en memoria con una librería JS (soporta
# archivos grandes). python3-geopandas/pandas: ingesta de GeoParquet con
# geometría predial (catastral-parquet-ingest.ts).
#
# pyarrow vía pip, no apt: es el motor de lectura Parquet que usa geopandas
# (sin él, gpd.read_parquet() falla con "Missing optional dependency
# 'pyarrow.parquet'"), pero el paquete "python3-pyarrow" de Debian solo
# existe en sid/trixie, no en bookworm. PyPI sí publica wheels manylinux
# precompilados que funcionan en Debian sin compilar nada.
# --break-system-packages: Debian 12 marca el Python del sistema como
# "externally managed" (PEP 668) — ok en un contenedor de un solo propósito.
# GeoAlchemy2 también vía pip: gdf.to_postgis() lo requiere para mapear la
# columna geometry a un tipo PostGIS, y Debian bookworm no empaqueta
# "python3-geoalchemy2" (solo está en sid/trixie, igual que pyarrow).
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip python3 python3-geopandas python3-pandas python3-pip \
    python3-sqlalchemy libpq-dev \
  && pip3 install --no-cache-dir --break-system-packages pyarrow psycopg2-binary GeoAlchemy2 \
  && rm -rf /var/lib/apt/lists/*

# chromium: necesario para la consulta on-demand del Certificado de Deuda TGR
# (web/lib/tgr.ts, vía playwright-core) — corre en ESTE contenedor, distinto
# del VPS host donde scraper/tgr/run-tgr.sh instala su propio Google Chrome
# para el scraper masivo por lotes. El paquete apt de Debian (a diferencia
# del de Ubuntu, que reenvía al snap confinado por AppArmor) es un binario
# normal, sin restricciones de sandbox.
#
# En un RUN aparte, NO combinado con el apt-get de geopandas de arriba: dos
# deploys seguidos murieron con exit 137 (OOM) instalando ambos juntos en una
# sola transacción — reordenar los stages para que no corrieran en paralelo
# con `npm run build` no lo arregló, así que el problema real es el pico de
# memoria del propio `apt-get` procesando triggers (ca-certificates,
# fontconfig, ldconfig, mime-info) sobre las ~180 paquetes de golpe. Partirlo
# en dos transacciones más chicas reduce ese pico en el VPS de 8GB compartido
# con Postgres y otros contenedores.
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*

ENV CHROME_BINARY=/usr/bin/chromium

EXPOSE 3000
CMD ["node", "server.js"]
