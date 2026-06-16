#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · bootstrap.sh — instalación completa AISLADA en el CX33
#
# ⚠️  CONVIVE con zintoleads y otros stacks. Este script:
#     • NO toca ningún archivo de nginx que no sea casafari.conf
#     • Hace BACKUP de la config de nginx antes de cualquier cambio
#     • Verifica `nginx -t` antes de cada reload (si falla, restaura el backup)
#     • Usa puertos aislados (5433 / 6380 / 3000, solo localhost)
#     • certbot solo emite cert para 204-168-174-0.nip.io (server block propio)
#
# Uso en el VPS:
#   git clone https://github.com/Bcousino890/casafari-mio.git /opt/casafari
#   cd /opt/casafari && bash infra/bootstrap.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="204-168-174-0.nip.io"
COMPOSE="docker compose -p casafari --env-file $REPO_DIR/.env -f $REPO_DIR/infra/docker-compose.yml"

# Email para Let's Encrypt (avisos de expiración). Cambia si quieres.
LE_EMAIL="${LE_EMAIL:-admin@zinto.app}"

log()  { echo -e "\n▶ $*"; }
ok()   { echo "  ✅ $*"; }
fail() { echo "  ❌ $*"; exit 1; }

# ── 0. Comprobaciones previas ────────────────────────────────────────────────
log "[0/7] Comprobaciones previas..."
command -v docker  >/dev/null || fail "Docker no está instalado (curl -fsSL https://get.docker.com | sh)"
command -v nginx   >/dev/null || fail "nginx no está instalado en el host"
[ -f "$REPO_DIR/.env" ] || fail "Falta $REPO_DIR/.env — copia .env.example y rellena POSTGRES_PASSWORD"
grep -q '^POSTGRES_PASSWORD=..*' "$REPO_DIR/.env" || fail "POSTGRES_PASSWORD vacío en .env"
ok "Docker, nginx y .env OK"

# ── 1. Backup de la config de nginx (por si acaso) ───────────────────────────
log "[1/7] Backup de nginx..."
BACKUP="/root/nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$BACKUP" /etc/nginx 2>/dev/null || true
ok "Backup en $BACKUP"

# ── 2. Postgres + Redis (puertos aislados) ───────────────────────────────────
log "[2/7] Levantando Postgres (5433) + Redis (6380)..."
$COMPOSE up -d postgres redis
for i in $(seq 1 30); do
  if $COMPOSE exec -T postgres pg_isready -U casafari >/dev/null 2>&1; then break; fi
  sleep 2
done
$COMPOSE exec -T postgres pg_isready -U casafari >/dev/null 2>&1 || fail "Postgres no arrancó"
ok "Postgres y Redis arriba"

# ── 3. Migraciones ───────────────────────────────────────────────────────────
log "[3/7] Aplicando migraciones..."
$COMPOSE exec -T postgres sh -c \
  'for f in $(ls /migrations/*.sql 2>/dev/null | sort); do echo "   >> $f"; psql -U casafari -d casafari -f "$f" || exit 1; done' \
  || fail "Fallo aplicando migraciones"
ok "Migraciones aplicadas"

# ── 4. Build + arrancar la app (3000, solo localhost) ────────────────────────
log "[4/7] Build + arranque de la app..."
$COMPOSE build app
$COMPOSE up -d --no-deps app
sleep 8
curl -sf http://127.0.0.1:3000 >/dev/null || { $COMPOSE logs app --tail=40; fail "La app no responde en :3000"; }
ok "App respondiendo en 127.0.0.1:3000"

# ── 5. nginx — instalar SOLO nuestro server block ────────────────────────────
log "[5/7] Registrando server block de casafari (aislado)..."
mkdir -p /etc/nginx/snippets
cp "$REPO_DIR/infra/nginx-casafari-proxy.conf" /etc/nginx/snippets/casafari-proxy.conf
cp "$REPO_DIR/infra/nginx-casafari.conf"       /etc/nginx/conf.d/casafari.conf
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  ok "nginx recargado (casafari.conf activo, resto intacto)"
else
  echo "  ⚠️  nginx -t falló — restaurando backup y abortando"
  rm -f /etc/nginx/conf.d/casafari.conf /etc/nginx/snippets/casafari-proxy.conf
  tar xzf "$BACKUP" -C / 2>/dev/null || true
  nginx -t && systemctl reload nginx
  fail "Config de nginx inválida — se restauró el estado anterior (zintoleads intacto)"
fi

# ── 6. TLS con Certbot — SOLO para nuestro dominio ───────────────────────────
log "[6/7] Emitiendo certificado TLS para $DOMAIN..."
if ! command -v certbot >/dev/null; then
  apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx
fi
# --nginx solo edita el server block cuyo server_name = $DOMAIN (casafari.conf).
# zintoleads tiene otro server_name → certbot ni lo mira.
certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive --agree-tos --redirect \
  --email "$LE_EMAIL" \
  --cert-name casafari-mio \
  || echo "  ⚠️  Certbot no pudo emitir (¿DNS/80 ocupado?). La app sigue en HTTP."
nginx -t && systemctl reload nginx
ok "TLS configurado (si Certbot tuvo éxito)"

# ── 7. Fin ───────────────────────────────────────────────────────────────────
log "[7/7] ✅ Bootstrap completado"
echo ""
echo "  🌐  http://$DOMAIN   (y https:// si Certbot funcionó)"
echo "  📦  contenedores:  $COMPOSE ps"
echo "  📜  logs app:      $COMPOSE logs -f app"
echo ""
echo "  zintoleads y el resto del VPS NO se han tocado."
