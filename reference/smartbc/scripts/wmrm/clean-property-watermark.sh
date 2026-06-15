#!/usr/bin/env bash
# Re-procesa las fotos YA almacenadas de una propiedad para quitar la marca de
# agua dinámica (de la agencia anunciante). Descarga de storage -> motor
# dinámico -> sube de vuelta (mismo path) -> refresca last_synced_at (caché).
#
#   clean-property-watermark.sh <slug_like>
set -uo pipefail
SLUG_LIKE="${1:?uso: clean-property-watermark.sh <slug_like>}"
APP=/opt/smartbc-app
PY=/opt/wmrm/bin/python
ENGINE=/opt/wmrm/wm_remove_dynamic.py
SVC=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" "$APP/.env.local" | cut -d= -f2-)
BASE=https://crm.bcousinoprop.com/storage/v1/object
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -qtA"

work=$(mktemp -d); mkdir -p "$work/in" "$work/out"
# 1) URLs de las fotos
mapfile -t urls < <($PSQL -c "SELECT pp.url FROM property_photos pp JOIN properties p ON p.id=pp.property_id WHERE p.slug LIKE '%${SLUG_LIKE}%' ORDER BY pp.position;")
echo "fotos: ${#urls[@]}"
[ "${#urls[@]}" -eq 0 ] && { echo "sin fotos"; exit 1; }
# 2) descargar (el nombre = path relativo, para reconstruir al subir)
declare -A PATHOF
i=0
for u in "${urls[@]}"; do
  rel="${u#*/object/public/properties-photos/}"   # synced/.../N.webp
  fn=$(printf '%03d.webp' "$i"); PATHOF["$fn"]="$rel"
  curl -s "$u" -o "$work/in/$fn" --max-time 30
  i=$((i+1))
done
# 3) motor dinámico
"$PY" "$ENGINE" "$work/in" "$work/out"
# 4) subir de vuelta (upsert) cada foto limpia a su path original
up=0
for fn in $(ls "$work/out"); do
  rel="${PATHOF[$fn]}"
  [ -z "$rel" ] && continue
  code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/properties-photos/$rel" \
    -H "Authorization: Bearer $SVC" -H "x-upsert: true" -H "Content-Type: image/webp" \
    --data-binary @"$work/out/$fn" --max-time 40)
  [ "$code" = "200" ] && up=$((up+1)) || echo "  fallo subida $rel ($code)"
done
echo "subidas: $up/${#urls[@]}"
# 5) refrescar last_synced_at para invalidar la caché del proxy
$PSQL -c "UPDATE properties SET last_synced_at=now() WHERE slug LIKE '%${SLUG_LIKE}%';" >/dev/null
rm -rf "$work"
echo "OK"
