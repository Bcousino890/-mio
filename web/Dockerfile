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
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip python3 python3-geopandas python3-pandas python3-pip \
  && pip3 install --no-cache-dir --break-system-packages pyarrow \
  && rm -rf /var/lib/apt/lists/*

# standalone output incluye un server.js mínimo con sus propias dependencias
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public

EXPOSE 3000
CMD ["node", "server.js"]
