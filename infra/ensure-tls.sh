#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · ensure-tls.sh — emite/redeploya el certificado Let's Encrypt
# de $DOMAIN en el nginx COMPARTIDO (Docker), sin tocar zinto.conf ni nada
# ajeno. Certbot corre en el HOST (sin plugin de nginx); el reto HTTP-01 y la
# instalación del cert se hacen vía `docker cp` hacia el contenedor — el
# mismo patrón aditivo que ya usa bootstrap.sh para casafari.conf.
#
# Llamado por bootstrap.sh y deploy.sh. Idempotente: si el cert ya existe,
# solo lo redeploya (por si el contenedor nginx se recreó).
#
# Variables requeridas: DOMAIN, SHARED_NGINX
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${DOMAIN:?DOMAIN no definido}"
SHARED_NGINX="${SHARED_NGINX:?SHARED_NGINX no definido}"
CERT_LIVE="/etc/letsencrypt/live/$DOMAIN"

deploy_ssl() {
  local tmp_ssl
  tmp_ssl="$(mktemp -d)"
  cp -L "$CERT_LIVE/fullchain.pem" "$CERT_LIVE/privkey.pem" "$tmp_ssl/"
  docker exec "$SHARED_NGINX" mkdir -p "/etc/casafari-ssl/$DOMAIN"
  docker cp "$tmp_ssl/fullchain.pem" "$SHARED_NGINX:/etc/casafari-ssl/$DOMAIN/fullchain.pem"
  docker cp "$tmp_ssl/privkey.pem" "$SHARED_NGINX:/etc/casafari-ssl/$DOMAIN/privkey.pem"
  rm -rf "$tmp_ssl"

  docker cp "$REPO_DIR/infra/nginx-casafari-shared-ssl.conf" "$SHARED_NGINX:/etc/nginx/conf.d/casafari.conf"
  if docker exec "$SHARED_NGINX" nginx -t >/dev/null 2>&1; then
    docker exec "$SHARED_NGINX" nginx -s reload
    echo "  ✅ HTTPS activo para $DOMAIN"
  else
    echo "  ⚠️  nginx -t falló con la conf SSL, revirtiendo a http"
    docker cp "$REPO_DIR/infra/nginx-casafari-shared.conf" "$SHARED_NGINX:/etc/nginx/conf.d/casafari.conf"
    docker exec "$SHARED_NGINX" nginx -s reload || true
  fi
}

if [ -f "$CERT_LIVE/fullchain.pem" ]; then
  deploy_ssl
  exit 0
fi

command -v certbot >/dev/null || { apt-get update -qq && apt-get install -y -qq certbot; }
docker exec "$SHARED_NGINX" mkdir -p /usr/share/nginx/html/.well-known/acme-challenge

auth_hook="$(mktemp)"
clean_hook="$(mktemp)"
cat > "$auth_hook" <<HOOK
#!/usr/bin/env bash
echo -n "\$CERTBOT_VALIDATION" > "/tmp/\$CERTBOT_TOKEN"
docker cp "/tmp/\$CERTBOT_TOKEN" "$SHARED_NGINX:/usr/share/nginx/html/.well-known/acme-challenge/\$CERTBOT_TOKEN"
HOOK
cat > "$clean_hook" <<HOOK
#!/usr/bin/env bash
docker exec "$SHARED_NGINX" rm -f "/usr/share/nginx/html/.well-known/acme-challenge/\$CERTBOT_TOKEN" || true
rm -f "/tmp/\$CERTBOT_TOKEN"
HOOK
chmod +x "$auth_hook" "$clean_hook"

if certbot certonly --manual --preferred-challenges http \
    --manual-auth-hook "$auth_hook" --manual-cleanup-hook "$clean_hook" \
    -d "$DOMAIN" --non-interactive --agree-tos -m "admin@zinto.app" \
    --deploy-hook "DOMAIN=$DOMAIN SHARED_NGINX=$SHARED_NGINX bash $REPO_DIR/infra/ensure-tls.sh"; then
  if ! crontab -l 2>/dev/null | grep -q "casafari-mio"; then
    (crontab -l 2>/dev/null; echo "17 3 * * * DOMAIN=$DOMAIN SHARED_NGINX=$SHARED_NGINX certbot renew --quiet # casafari-mio") | crontab -
  fi
else
  echo "  ⚠️  certbot falló — sigue en http"
fi
rm -f "$auth_hook" "$clean_hook"
