# Despliegue — casafari-mio

**Servidor:** Hetzner **CX33** · ref #123878962 · host `zinto.leads` · IP **204.168.174.0**
**Infra:** solo VPS + proxies. Sin Supabase, sin Vercel.

> ⚠️ **Capacidad:** el plan maestro se dimensionó para un CX43 (8 vCPU / 16 GB / 160 GB).
> El CX33 es más pequeño (~4 vCPU / 8 GB). Para las **5 zonas de prueba** sobra; al
> escalar a toda la Comunidad de Madrid habrá que vigilar RAM/disco (INSPIRE + histórico)
> y, llegado el caso, subir de máquina o separar Postgres. El `docker-compose.yml` ya
> viene tuneado para 8 GB.

## 1. Preparar el VPS (una vez)
```bash
ssh root@204.168.174.0
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh        # Docker + compose plugin
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. Traer el código
```bash
git clone https://github.com/Bcousino890/casafari-mio.git /opt/casafari
cd /opt/casafari
cp .env.example .env && nano .env             # rellenar POSTGRES_PASSWORD, proxies Geonode, etc.
```

## 3. Levantar la base de datos
```bash
cd infra
docker compose --env-file ../.env up -d postgres redis
docker compose exec postgres pg_isready -U casafari
```

## 4. Aplicar migraciones (en orden)
```bash
for f in /migrations/0001 /migrations/0002 ... ; do :; done   # o:
docker compose exec postgres sh -c \
  'for f in /migrations/*.sql; do echo ">> $f"; psql -U casafari -d casafari -f "$f" || break; done'
```

## 5. Cargar cartografía INSPIRE (5 zonas de prueba)
- Descargar el GML de Catastro/INSPIRE de los municipios objetivo (Madrid, Pozuelo, Alcobendas).
- Importar reproyectando a 4326:
```bash
ogr2ogr -f PostgreSQL "PG:host=localhost user=casafari dbname=casafari" \
  CADASTRALPARCEL.gml -t_srs EPSG:4326 -nln cadastre_parcel_raw -overwrite
# luego INSERT ... SELECT a cadastre_parcel (rc14 = referencia, geom).
```

## 6. (Cuando exista la app) build + arrancar
```bash
# descomentar servicios app + caddy en docker-compose.yml
docker compose --env-file ../.env up -d --build
```
URL temporal mientras no haya dominio: **http://204.168.174.0** (Caddy en :80).
Con dominio: poner el host en `infra/Caddyfile` y Caddy emite TLS solo.

## 7. Importar los 2.500 legacy
Ver [`db/etl/import_legacy_particulares.sql`](../db/etl/import_legacy_particulares.sql).

## Acceso para deploy automatizado
Para que el deploy lo dispare CI/asistente, añadir una **clave SSH pública** al
`~/.ssh/authorized_keys` del VPS (NO compartir contraseñas en claro). Recomendado:
deshabilitar login por contraseña una vez configurada la clave.
