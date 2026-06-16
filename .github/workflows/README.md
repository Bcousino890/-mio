# Auto-deploy con GitHub Actions

El workflow [`deploy.yml`](deploy.yml) despliega casafari-mio en el CX33 por SSH
cada vez que haces push a la rama de deploy (o manualmente desde **Actions → Run workflow**).

## Qué hace
1. Conecta por SSH al VPS con una clave dedicada.
2. `git pull` de la rama.
3. `bash infra/deploy.sh` → build de la app + swap + health check.

> **No toca nginx ni certbot.** Eso ya lo dejó configurado `bootstrap.sh` la primera vez.
> Solo reconstruye y reinicia el contenedor de la app → **zintoleads intacto**.

---

## Configuración (una sola vez)

### 1. Crear una clave SSH dedicada para el deploy

En tu Mac (o donde sea):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/casafari_deploy -N "" -C "github-actions-casafari"
```

### 2. Autorizar la clave en el VPS

```bash
ssh-copy-id -i ~/.ssh/casafari_deploy.pub root@204.168.174.0
# o manualmente:
cat ~/.ssh/casafari_deploy.pub | ssh root@204.168.174.0 'cat >> ~/.ssh/authorized_keys'
```

### 3. Añadir los secrets en GitHub

En **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `VPS_HOST` | `204.168.174.0` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | contenido de `~/.ssh/casafari_deploy` (la clave **privada** completa) |
| `VPS_PORT` | `22` (opcional, solo si usas otro puerto) |

```bash
# Para copiar la clave privada al portapapeles (Mac):
pbcopy < ~/.ssh/casafari_deploy
```

### 4. Listo

A partir de ahora cada push a `claude/affectionate-albattani-leauui` que toque
`web/`, `db/` o `infra/` despliega solo. También puedes lanzarlo a mano en la
pestaña **Actions → Deploy a CX33 → Run workflow**.

---

## Seguridad

- La clave privada vive solo en los secrets cifrados de GitHub, nunca en el repo.
- Es una clave **dedicada**: si se compromete, la revocas del `authorized_keys`
  sin afectar tu acceso personal.
- Recomendado: en el VPS, restringir esa clave en `authorized_keys` con
  `command=`/`from=` si quieres acotar aún más.
