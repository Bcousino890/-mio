#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# load-gpkg-to-db.sh — Carga GeoPackages de catastral.cl en cadastre_parcels_cl
#
# Los GeoPackages tienen la geometría de los predios (polígonos) vectorizados
# desde los planos del SII por el proyecto catastral.cl / Tremen SpA.
#
# USO (en el VPS, después de subir los .gpkg o .parquet via SFTP):
#   bash /opt/casafari/scraper/load-gpkg-to-db.sh /ruta/a/los/gpkg/
#
# PREREQUISITOS en el VPS:
#   apt-get install -y gdal-bin    # para ogr2ogr
#   # O si están en formato Parquet:
#   pip install geopandas pyarrow psycopg2-binary
#
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

GPKG_DIR="${1:?Uso: $0 <directorio-con-gpkg-o-parquet>}"
DB_URL="${DATABASE_URL:?DATABASE_URL no definido}"

# Cargar .env si existe y DATABASE_URL no está en el entorno
if [ -z "${DATABASE_URL:-}" ] && [ -f /opt/casafari/.env ]; then
  export $(grep -E '^DATABASE_URL=' /opt/casafari/.env | head -1)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL no definido. Exporta la variable o pon el .env en /opt/casafari/.env"
  exit 1
fi

echo "▶ Directorio: $GPKG_DIR"
echo "▶ DB: ${DATABASE_URL%%@*}@..."
echo ""

# ── GeoPackages (.gpkg) ───────────────────────────────────────────────────────
GPKG_COUNT=$(find "$GPKG_DIR" -name "*.gpkg" | wc -l)
if [ "$GPKG_COUNT" -gt 0 ]; then
  echo "▶ Cargando $GPKG_COUNT GeoPackage(s) con ogr2ogr..."

  # Asegurar que la tabla destino existe con la extensión PostGIS
  psql "$DATABASE_URL" -c "
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE TABLE IF NOT EXISTS cadastre_parcels_cl (
      id              bigserial PRIMARY KEY,
      sii_comuna_code text,
      rol             text,
      geom            geometry(MultiPolygon, 4326),
      source          text DEFAULT 'catastral_cl',
      created_at      timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cadastre_parcels_cl_geom
      ON cadastre_parcels_cl USING gist(geom);
    CREATE INDEX IF NOT EXISTS idx_cadastre_parcels_cl_rol
      ON cadastre_parcels_cl(sii_comuna_code, rol);
  " 2>/dev/null || true

  OK=0; FAIL=0
  for gpkg in "$GPKG_DIR"/*.gpkg; do
    fname=$(basename "$gpkg" .gpkg)
    echo -n "  [$fname] ... "

    # ogr2ogr detecta el CRS del .gpkg y reproyecta a EPSG:4326 (-t_srs).
    # -nlt PROMOTE_TO_MULTI evita errores si hay polígonos simples mezclados.
    if ogr2ogr \
        -f PostgreSQL "$DATABASE_URL" "$gpkg" \
        -nln cadastre_parcels_cl \
        -nlt PROMOTE_TO_MULTI \
        -t_srs EPSG:4326 \
        -append \
        -progress \
        2>/dev/null; then
      echo "✓"
      ((OK++)) || true
    else
      echo "✗ (ver error arriba)"
      ((FAIL++)) || true
    fi
  done
  echo ""
  echo "  GeoPackages: $OK ok, $FAIL fallidos"
fi

# ── Parquet (.parquet) ────────────────────────────────────────────────────────
PARQUET_COUNT=$(find "$GPKG_DIR" -name "*.parquet" | wc -l)
if [ "$PARQUET_COUNT" -gt 0 ]; then
  echo ""
  echo "▶ Cargando $PARQUET_COUNT Parquet(s) con Python/GeoPandas..."

  python3 - "$GPKG_DIR" "$DATABASE_URL" <<'PYEOF'
import sys, os, glob
import geopandas as gpd
from sqlalchemy import create_engine, text

gpkg_dir, db_url = sys.argv[1], sys.argv[2]
engine = create_engine(db_url)

# Crear tabla si no existe
with engine.connect() as conn:
    conn.execute(text("""
        CREATE EXTENSION IF NOT EXISTS postgis;
        CREATE TABLE IF NOT EXISTS cadastre_parcels_cl (
          id              bigserial PRIMARY KEY,
          sii_comuna_code text,
          rol             text,
          geom            geometry(MultiPolygon, 4326),
          source          text DEFAULT 'catastral_cl',
          created_at      timestamptz DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_cadastre_parcels_cl_geom
          ON cadastre_parcels_cl USING gist(geom);
        CREATE INDEX IF NOT EXISTS idx_cadastre_parcels_cl_rol
          ON cadastre_parcels_cl(sii_comuna_code, rol);
    """))
    conn.commit()

ok = fail = 0
for path in sorted(glob.glob(os.path.join(gpkg_dir, '*.parquet'))):
    fname = os.path.basename(path)
    print(f"  [{fname}] ... ", end='', flush=True)
    try:
        gdf = gpd.read_parquet(path)
        # Normalizar CRS a WGS84
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(4326)
        # Mapear columnas del formato catastral.cl
        col_map = {}
        for col in gdf.columns:
            cl = col.lower()
            if cl in ('cod_comuna', 'comuna', 'cut'):
                col_map[col] = 'sii_comuna_code'
            elif cl in ('rol', 'rol_avaluo'):
                col_map[col] = 'rol'
        if col_map:
            gdf = gdf.rename(columns=col_map)
        # Solo las columnas que necesitamos
        keep = [c for c in ['sii_comuna_code', 'rol'] if c in gdf.columns]
        gdf = gdf[keep + [gdf.geometry.name]]
        gdf = gdf.rename_geometry('geom')
        gdf['source'] = 'catastral_cl'
        # Forzar MultiPolygon
        from shapely.geometry import MultiPolygon
        gdf['geom'] = gdf['geom'].apply(lambda g: MultiPolygon([g]) if g.geom_type == 'Polygon' else g)
        gdf.to_postgis('cadastre_parcels_cl', engine, if_exists='append', index=False)
        print(f"✓ {len(gdf):,} predios")
        ok += 1
    except Exception as e:
        print(f"✗ {e}")
        fail += 1

print(f"\n  Parquet: {ok} ok, {fail} fallidos")
PYEOF
fi

# ── Estadísticas finales ──────────────────────────────────────────────────────
echo ""
echo "▶ Conteo en BD:"
psql "$DATABASE_URL" -c "
  SELECT sii_comuna_code, count(*) AS predios
  FROM cadastre_parcels_cl
  GROUP BY sii_comuna_code
  ORDER BY predios DESC
  LIMIT 20;
"

echo ""
echo "✅ Listo. Los polígonos ya están disponibles en /chile/street"
