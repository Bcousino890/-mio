# Despliegue — casafari-mio

**Servidor:** Hetzner **CX33** · IP **204.168.174.0**
**Dominio público:** `crm.cremme.es`
**Convivencia:** el CX33 es compartido (corre además `zinto-v2`, `zinto-crm`,
`powerchat` y el nginx que sirve `:80`/`:443` para todos). casafari-mio usa
puertos aislados para Postgres/Redis/app y solo se conecta al nginx
compartido — nunca toca la config de los otros stacks.

| Servicio | Puerto en host | Visible desde |
|---|---|---|
| Postgres (casafari) | `5433` | solo localhost |
| Redis (casafari) | `6380` | solo localhost |
| Next.js app | `3000` | solo localhost |
| nginx compartido (Docker) | `80` / `443` | público — sirve `crm.cremme.es` (y los otros dominios del VPS) |

---

## 🚀 Instalación automática (recomendada)

Un solo script hace todo de forma **aislada de los demás stacks** (DB →
migraciones → app → registro en el nginx compartido → TLS), con rollback si
algo falla:

```bash
ssh root@204.168.174.0
git clone https://github.com/Bcousino890/casafari-mio.git /opt/casafari
cd /opt/casafari
cp .env.example .env && nano .env      # pon POSTGRES_PASSWORD
bash infra/bootstrap.sh
```

→ Web pública en **https://crm.cremme.es**

> **Garantía de aislamiento:** `bootstrap.sh` detecta el contenedor nginx que
> ya sirve el `:80` (`SHARED_NGINX`), conecta `casafari-app` a su red Docker,
> y copia dentro de ese contenedor un `casafari.conf` aditivo
> (`infra/nginx-casafari-shared.conf`) con `server_name crm.cremme.es` —
> nunca edita ni borra la config de los otros dominios. Antes de recargar
> nginx hace `nginx -t`; si falla, revierte el archivo y aborta.

---

## Cómo funciona el enrutamiento (nginx compartido en Docker)

El VPS no tiene un nginx "del sistema": el `:80`/`:443` los sirve un
contenedor Docker que ya existe (compartido con los demás stacks). Por eso
`bootstrap.sh`/`deploy.sh`/`ensure-tls.sh` no tocan `/etc/nginx` del host —
en su lugar:

1. Detectan ese contenedor (`docker ps --filter "publish=80"`) y su red.
2. Conectan `casafari-app` a esa misma red (`docker network connect`), para
   que el nginx compartido pueda resolver `casafari-app:3000` por nombre.
3. Copian `infra/nginx-casafari-shared.conf` (HTTP) o, una vez emitido el
   certificado, `infra/nginx-casafari-shared-ssl.conf` (HTTPS) dentro del
   contenedor vía `docker cp` a `/etc/nginx/conf.d/casafari.conf`.
4. Validan con `nginx -t` dentro del contenedor y recargan; si la config es
   inválida, revierten ese único archivo.

`infra/ensure-tls.sh` emite/renueva el certificado Let's Encrypt de
`crm.cremme.es` con `certbot certonly --manual` (reto HTTP-01 vía `docker cp`
hacia el contenedor, sin plugin de nginx) y luego instala el cert dentro del
contenedor compartido en `/etc/casafari-ssl/crm.cremme.es/`.

### 2. Configurar `.env`

```bash
cp .env.example .env
nano .env
# Mínimo obligatorio: POSTGRES_PASSWORD=<una_contraseña_segura>
```

### 7. Build y arrancar la app (deploy manual paso a paso, si no usas bootstrap.sh)

```bash
cd /opt/casafari
bash infra/deploy.sh
```

✅ App disponible en **https://crm.cremme.es**

---

## Deploys sucesivos (actualizar código)

```bash
ssh root@204.168.174.0 "cd /opt/casafari && bash infra/deploy.sh"
```

El script hace: build de la app → swap del contenedor → reconectar a la red
del nginx compartido → asegurar TLS → aplicar migraciones SQL
(`post-deploy.sh`).

> En producción esto lo dispara automáticamente `.github/workflows/deploy.yml`
> al hacer push a `main` (rsync del repo al VPS + `infra/deploy.sh` remoto).

---

## Comandos de operación

```bash
COMPOSE="docker compose -p casafari --env-file /opt/casafari/.env -f /opt/casafari/infra/docker-compose.yml"

# Logs en tiempo real
$COMPOSE logs -f app

# Estado de contenedores
$COMPOSE ps

# Reiniciar solo la app (sin rebuild)
$COMPOSE restart app

# Abrir psql
$COMPOSE exec postgres psql -U casafari -d casafari

# Parar todo
$COMPOSE down
```

---

## DNS (entrada A en tu proveedor de `cremme.es`)

| Nombre | Tipo | Valor |
|---|---|---|
| `crm` | A | `204.168.174.0` |

---

## Aislamiento con los demás stacks del VPS

- Los contenedores corren en la red Docker `casafari_default` (propia),
  además de conectarse a la red del nginx compartido solo para que este
  pueda enrutarle tráfico a `casafari-app`.
- Postgres en `5433`, Redis en `6380` — no colisionan con los puertos de
  `zinto-v2`/`zinto-crm`/`powerchat`.
- En el nginx compartido, `server_name crm.cremme.es` solo afecta las
  peticiones a ese dominio; el resto de `server_name` de otros stacks
  vive en sus propios archivos `.conf`, que `bootstrap.sh`/`deploy.sh`
  nunca tocan.
- Los certificados TLS de casafari-mio viven en
  `/etc/casafari-ssl/crm.cremme.es/` dentro del contenedor compartido,
  separados de los de los demás dominios.
