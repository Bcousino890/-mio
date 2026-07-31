# Scraper de mapasui SII — integración y aviso de procedencia

## Qué es

`scraper/sii-scraper/` (Python, `aiohttp`) extrae predios reales del SII
consultando de forma **automatizada** el backend del visor de mapas
(`mapasFacadeService` en `www4.sii.cl`), en vez de depender de la descarga
manual de archivos planos. Recorre `(comuna, manzana, predio)` y obtiene rol,
avalúo (total/afecto/exento), lat/lng, dirección, área homogénea y banda de
superficie — ver `scraper/sii-scraper/README.md` para el detalle de
configuración, etapas (`regiones` → `manzanas`/`manzanas-geo` → `predios` →
`found-predios`) y uso de proxy.

## ⚠️ Aviso de procedencia — leer antes de usar

Este repositorio documentó explícitamente, en `db/migrations/0020_cadastre_chile.sql`,
`0021_sii_catastro_cl.sql` y `docs/RC-CHILE-INVESTIGACION.md`, que:

- Los términos de uso de `sii.cl`/`mapasui` **prohíben expresamente** la
  captura automatizada y **cualquier uso comercial** (uso declarado
  "personal y no comercial").
- Se confirmaron bloqueos **HTTP 403** reales contra ese dominio (WAF activo).
- Por eso el diseño original **nunca asume `sii.cl` como fuente** de
  geometría/datos — solo IDE Chile/Geoportal (WMS/WFS) y archivos planos
  descargados a mano.

`scraper/sii-scraper/` hace exactamente lo que esa investigación descartó:
peticiones HTTP automatizadas contra `www4.sii.cl`, con rotación de IP (vía
la cuenta SmartProxy CL — `SMARTPROXY_CL_*`, la misma ya usada para
Portalinmobiliario) para sobrevivir a los bloqueos del WAF. Se integró en
este repo a petición explícita del responsable del proyecto (2026-07-04),
bajo su criterio de que el uso no es comercial. Por eso:

- Sus resultados viven en una tabla **separada**, `sii_mapasui_predios_cl`
  (0052), y **nunca se mezclan** con `sii_roles_cl` (procedencia oficial).
- La UI (`web/app/chile/street/page.tsx`) marca estos resultados con un
  badge **"no oficial"** cuando `sii-search` cae al fallback de mapasui.
- No usar esta tabla para redistribución, comercialización, ni como fuente
  única de verdad legal — solo como señal de apoyo interna.

Si en algún momento se decide no asumir este riesgo, basta con dejar de
correr el scraper y de llamar a `ingest-sii-mapasui.mjs`; el resto del
sistema sigue funcionando igual con `sii_roles_cl`.

## Operación 24/7 — cola de comunas, velocidad y botón de relanzamiento

El objetivo operativo es **scrapear sin pausas y sin caerse**. Tres piezas:

1. **Cola de comunas (`comunas-queue.json`)** — `run-sii-mapasui.sh` recorre
   las comunas en orden, una tras otra: al terminar Las Condes arranca sola con
   Vitacura, y así con las que agregues a la cola. Cada comuna terminada deja
   `output/.complete-<code>`; un relanzamiento salta las completas y retoma la
   primera pendiente **desde sus checkpoints** (no reinicia). Al completar toda
   la cola escribe `output/.sii-mapasui-complete`.

2. **Proxies a full** — defaults `SII_RPS=8` y `SII_CONCURRENCY=8` (antes 2/2),
   apoyados en el proxy residencial rotable (SmartProxy CL, IP por sesión). Si
   el WAF empieza a devolver 403/429 sostenidos, **bajar** estos valores: ir
   demasiado rápido provoca bloqueos largos que estancan el 24/7.

3. **Botón de (re)lanzamiento** — editar/pushear
   `scraper/sii-scraper/.launch-sii-mapasui` en `main` dispara
   `scrape-sii-mapasui.yml`, que mata el scrape en curso y relanza en modo cola
   (continúa donde quedó). No hace falta apretarlo para caídas normales: el
   **watchdog** (`scraper/sii-scraper/watchdog-ingest.sh`, en el cron del VPS
   cada 30 min, instalado por `infra/deploy.sh`) ya relanza solo si el proceso
   murió o se colgó ≥6 h. El botón es para forzar el relanzamiento de inmediato
   o reanudar tras un incidente mayor.

   La ingesta que ese watchdog dispara es **incremental en dos niveles**: si el
   `.jsonl` no cambió desde la última corrida ni se abre la BD (marcador
   `.mtime`), y si sí creció se leen solo los bytes nuevos desde el checkpoint
   de `sii_mapasui_ingest_state_cl` (migración 0090) en lotes de 500 filas. Esto
   último es lo que hace barata la comuna **en curso**, que es justo la que el
   atajo por mtime nunca puede saltarse: releerla entera fila a fila es lo que
   reventaba el túnel SSH del workflow con «Broken pipe» a los 5 minutos.

Para forzar **una sola comuna** (ignorando la cola), usar el `workflow_dispatch`
de `scrape-sii-mapasui.yml` con el input `comuna_code` (vacío = cola).

## Cómo correrlo (manual, una comuna)

```bash
cd scraper/sii-scraper
python3 -m venv venv && . venv/bin/activate
pip install -r requirements.txt
cp config.example.json config.json   # ajustar comunas/regiones

# opcional pero recomendado para corridas sostenidas — misma cuenta
# SmartProxy CL que scraper/lib/fetch.mjs (perfil 'portalinmobiliario'):
cat > .env <<EOF
SMARTPROXY_CL_HOST=us.smartproxy.net
SMARTPROXY_CL_PORT=3121
SMARTPROXY_CL_USER=...
SMARTPROXY_CL_PASS=...
EOF

python run.py manzanas --config config.json   # 1. descubrir manzanas
python run.py predios  --config config.json   # 2. extraer predios → output/predios/<comuna>.jsonl
```

## Cómo ingestarlo en la base de datos

```bash
cd scraper
node ingest-sii-mapasui.mjs --dir sii-scraper/output/predios
# o un solo archivo:
node ingest-sii-mapasui.mjs --file sii-scraper/output/predios/vitacura.jsonl
```

Requiere `DATABASE_URL` en el entorno. La migración `0052` debe estar
aplicada (crea `sii_mapasui_predios_cl`).

## Cómo consultarlo

- `GET /api/chile/sii-search?q=<rol o dirección>&comuna=<sii_comuna_code>` —
  busca primero en `sii_roles_cl` (oficial); si no hay resultados, cae a
  `sii_mapasui_predios_cl` y marca `source: "mapasui_scrape"` en cada
  resultado.
- Programático: `scraper/lib/sii-mapasui-cl.mjs` expone
  `getMapasuiPredioForRol({ comunaCode, rol })` y
  `findMapasuiPredioByAddress({ comunaCode, address })`, con la misma firma
  que sus equivalentes oficiales en `sii-catastro-cl.mjs`.

## Qué aporta frente al flujo oficial existente

- **Cobertura sin descarga manual por comuna**: no hay que ir a sii.cl y
  bajar/descomprimir archivos comuna por comuna.
- **Lat/lng nativo por predio** (`ubicacionX`/`ubicacionY` de mapasui) —
  el Detalle Catastral oficial solo trae lat/lon desde el dataset S2-2025 en
  adelante, y no para todas las comunas.
- **Área homogénea + banda de superficie** resueltas dinámicamente por
  comuna vía `listServiciosComunas` (capa WMS), útil como señal de tamaño
  aproximado cuando no hay Detalle Catastral cargado para esa comuna.
- **Descubrimiento geográfico (`manzanas-geo`)** para comunas con manzanas
  dispersas en IDs altos (ej. Vitacura, 103–3625) donde la enumeración
  clásica no encuentra nada.
