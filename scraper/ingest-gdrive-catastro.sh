#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ingest-gdrive-catastro.sh — Descarga catastro_YYYY_N.csv desde Google Drive
# y lo ingiere directamente en la BD usando el endpoint HTTP interno del VPS.
#
# USO (en el VPS):
#   bash /opt/casafari/scraper/ingest-gdrive-catastro.sh <FILE_ID>
#
# Ejemplo:
#   bash /opt/casafari/scraper/ingest-gdrive-catastro.sh 163AkvTTnjNRjdON5QHruUBgyLBm5Yo8o
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FILE_ID="${1:?Uso: $0 <google_drive_file_id>}"
DEST="/tmp/catastro_gdrive_$$.csv"
APP_URL="http://127.0.0.1:3000"

cleanup() { rm -f "$DEST" /tmp/gdrive_cookies_$$.txt; }
trap cleanup EXIT

echo "▶ [1/3] Descargando desde Google Drive (id=$FILE_ID)..."

# Google Drive añade una página de confirmación de virus para archivos >25MB.
# Obtenemos la cookie de confirmación primero, luego descargamos con ella.
curl -sc /tmp/gdrive_cookies_$$.txt \
  "https://drive.google.com/uc?export=download&id=${FILE_ID}" \
  -o /dev/null --silent

CONFIRM=$(curl -sb /tmp/gdrive_cookies_$$.txt \
  "https://drive.google.com/uc?export=download&id=${FILE_ID}" \
  --silent | grep -o 'confirm=[^&"]*' | head -1 | cut -d= -f2 || true)

if [ -n "$CONFIRM" ]; then
  curl -L -b /tmp/gdrive_cookies_$$.txt \
    "https://drive.google.com/uc?export=download&confirm=${CONFIRM}&id=${FILE_ID}" \
    -o "$DEST" --progress-bar
else
  # Intento directo (archivos pequeños o sin confirmación)
  curl -L "https://drive.google.com/uc?export=download&id=${FILE_ID}" \
    -o "$DEST" --progress-bar
fi

SIZE=$(du -sh "$DEST" | cut -f1)
echo "  Descargado: $DEST ($SIZE)"

# Verificar que no descargamos HTML de error
HEAD=$(head -c 200 "$DEST")
if echo "$HEAD" | grep -qi '<html'; then
  echo "❌ El archivo descargado parece HTML (posible error de Google Drive o archivo privado)"
  echo "   Primeros 200 bytes: $HEAD"
  exit 1
fi

echo ""
echo "▶ [2/3] Enviando al endpoint de ingesta (streaming)..."
echo "   (puede tardar 30-60 minutos para 9.4M filas)"
echo ""

# Enviamos el archivo al endpoint interno — la app ya corre en 127.0.0.1:3000
# y el endpoint acepta multipart igual que el navegador. Usamos curl con --no-buffer
# para ver el progreso en tiempo real.
curl -sN --no-buffer \
  -F "files=@${DEST};filename=catastro_gdrive.csv" \
  -F "comunaId=" \
  "${APP_URL}/api/admin/sii-upload" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    # Parsear las líneas NDJSON de progreso
    if echo "$line" | grep -q '"done":true'; then
      if echo "$line" | grep -q '"success":true'; then
        echo ""
        echo "✅ Ingesta completada."
        echo "$line" | python3 -c "
import sys, json
d = json.load(sys.stdin)
results = d.get('data', {}).get('results', [])
skipped = d.get('data', {}).get('skipped', [])
for r in results:
    counts = r.get('counts', {})
    roles = counts.get('roles_no_agricolas', 0) + counts.get('roles_agricolas', 0)
    print(f\"  Comuna {r['comunaCode']}: {roles:,} roles\")
if skipped:
    print(f'  Ignorados: {skipped}')
" 2>/dev/null || echo "$line"
      else
        echo ""
        echo "❌ Error en ingesta:"
        echo "$line"
      fi
    elif echo "$line" | grep -q '"status":"ok"'; then
      COMUNA=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('comunaCode','?'))" 2>/dev/null || echo "?")
      echo "  ✓ $COMUNA procesada"
    elif echo "$line" | grep -q '"status":"procesando"'; then
      COMUNA=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('comunaCode','?'))" 2>/dev/null || echo "?")
      echo "  ⏳ Procesando $COMUNA..."
    elif echo "$line" | grep -q '"status":"error"'; then
      echo "  ⚠️  Error: $line"
    fi
  done

echo ""
echo "▶ [3/3] Listo."
