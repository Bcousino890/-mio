#!/bin/bash
# ─── Setup automático de deploy VPS → GitHub ──────────────────────────────────
# Ejecutar en tu MÁQUINA LOCAL (no en el VPS):
#   bash scripts/vps-setup.sh
#
# Requiere: sshpass  →  brew install sshpass  (Mac)
#           gh CLI   →  brew install gh  +  gh auth login

set -e

VPS_HOST="178.105.176.3"
VPS_USER="root"
REPO="bcousino890/smartbc"

echo ""
echo "🔐 Introduce la contraseña SSH del VPS (no se guarda en ningún archivo):"
read -s VPS_PASS
echo ""

echo "🔑 Paso 1/4 — Generando clave SSH de deploy..."
ssh-keygen -t rsa -b 4096 -f ~/.ssh/smartbc_deploy -N "" -C "github-actions-deploy" 2>/dev/null || true
PUBKEY=$(cat ~/.ssh/smartbc_deploy.pub)
PRIVKEY=$(cat ~/.ssh/smartbc_deploy)

echo "📤 Paso 2/4 — Copiando clave pública al VPS..."
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" \
  "mkdir -p ~/.ssh && echo '$PUBKEY' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"

echo "📁 Paso 3/4 — Detectando ruta del proyecto en VPS..."
VPS_PATH=$(sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" \
  "find /root /home -maxdepth 4 -name 'package.json' 2>/dev/null | xargs grep -l '\"name\": \"smartbc\"' 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo '/root/smartbc'")
echo "   Ruta: $VPS_PATH"

echo "🔐 Paso 4/4 — Guardando secrets en GitHub..."
gh secret set VPS_HOST    --body "$VPS_HOST"  --repo "$REPO"
gh secret set VPS_USER    --body "$VPS_USER"  --repo "$REPO"
gh secret set VPS_SSH_KEY --body "$PRIVKEY"   --repo "$REPO"
gh secret set VPS_PATH    --body "$VPS_PATH"  --repo "$REPO"

echo ""
echo "✅ ¡Listo! Cada push a main despliega automáticamente al VPS."
echo "   Estado: https://github.com/$REPO/actions"
