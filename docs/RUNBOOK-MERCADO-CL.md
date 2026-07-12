# Runbook — Datos de mercado CL (Fases 2-6)

Guía de ejecución paso a paso para las fases operativas del pipeline de mercado
(ver `docs/CBR-TRANSACCIONES-REPOS-2026.md` §6 para el diseño). **Correr en un
entorno con salida a `ide.minvu.cl` / `sii.cl` / portales CBR** (el entorno de
build de Claude los bloquea por política de red; estas fases son de ejecución).

Requisitos: `DATABASE_URL` en el entorno, Node ≥18, y las migraciones `0057-0059`
aplicadas.

```bash
export DATABASE_URL="postgres://..."      # BD de casafari-mio
# Aplicar migraciones nuevas (idempotentes):
psql "$DATABASE_URL" -f db/migrations/0057_mercado_agregado_cl.sql
psql "$DATABASE_URL" -f db/migrations/0058_sii_avaluo_historico_cl.sql
psql "$DATABASE_URL" -f db/migrations/0059_cbr_indice_cl.sql
```

---

## FASE 2 — Verificar fuentes + piloto

**A0 · Descubrir la capa MINVU real y sus campos:**
```bash
node scraper/a0-verify-fuentes.mjs                    # lista capas candidatas (suelo/valor/mercado)
node scraper/a0-verify-fuentes.mjs --describe <capa>  # campos + comando de ingesta ya rellenado
```
El `--describe` imprime el comando `ingest-minvu-suelo.mjs` con los flags
`--layer` / `--field-valor` / `--field-zona` / `--field-comuna` inferidos. Copiar ese comando.

**Piloto (1 comuna, primero en seco):**
```bash
node scraper/ingest-minvu-suelo.mjs \
  --wfs-url https://ide.minvu.cl/geoserver/wfs \
  --layer <capa> --field-valor <campo_uf_m2> [--field-zona <zona>] \
  --comuna 15108 --periodo 2024 --dry-run          # valida sin escribir
# quitar --dry-run para persistir en mercado_agregado_cl
```

**Verificar:**
```sql
SELECT count(*), min(valor_uf_m2), max(valor_uf_m2)
FROM mercado_agregado_cl WHERE fuente='minvu_suelo' AND sii_comuna_code='15108';
```
```bash
curl "http://localhost:3100/api/chile/avm?sii_comuna_code=15108&rol=<rol_real>"
# → el JSON debe traer "suelo_minvu" no-null
```
Criterio de salida: la tarjeta del informe muestra la banda "Suelo MINVU" con datos reales.

---

## FASE 3 — Carga a escala

**MINVU, comunas prioritarias** (repetir el comando de Fase 2 variando `--comuna`):
`15131` Vitacura · `15108` Las Condes · `15111` Lo Barnechea · `13119` Providencia ·
`13120` Ñuñoa · `13106` La Reina · `13101` Santiago · `13301` Colina.
(O quitar `--comuna` si la capa trae `--field-comuna` y cubre todo el país.)

**Estadísticas SII de transferencias** → CSV con columnas
`sii_comuna_code;periodo;n_operaciones;monto_total_uf` y cargar:
```bash
curl -X POST http://localhost:3100/api/admin/mercado-agregado-upload \
  -H "Content-Type: text/csv" --data-binary @transferencias_sii.csv
```

**Histórico de avalúo** → CSV con `sii_comuna_code;rol;periodo;avaluo_total;avaluo_exento`:
```bash
curl -X POST http://localhost:3100/api/admin/avaluo-historico-upload \
  -H "Content-Type: text/csv" --data-binary @avaluo_historico.csv
```

**Verificar:**
```sql
SELECT sii_comuna_code, count(*) FROM mercado_zona_actual_cl
WHERE fuente='minvu_suelo' GROUP BY 1 ORDER BY 2 DESC;
SELECT count(DISTINCT rol) FROM sii_avaluo_historico_cl WHERE sii_comuna_code='15108';
```

---

## FASE 4 — UI (ya en código; solo requiere datos de Fase 3)

Nada que ejecutar: el sparkline de avalúo (`informe-predio` **y ahora también el
visor `/chile/catastro`**, tarjeta "Tendencia de avalúo") y las bandas de
valoración (informe + visor) ya están y se pueblan solos cuando hay datos.
Verificar visualmente abriendo un rol con histórico y suelo cargados.

Pendiente opcional (4.3): coropleta de valor de suelo MINVU en el mapa
(polígonos de `mercado_agregado_cl`), reusando el patrón de coropleta de
avalúo/m² de `parcels-bbox?enrich=1`.

---

## FASE 5 — Catastro nacional (operacional)

```bash
# Refresh S1-2026 (cuando el CSV esté disponible):
node scraper/ingest-sii-s1-2026.mjs
# Polígonos (en el VPS, requiere gdal-bin):
bash scraper/load-gpkg-to-db.sh /ruta/gpkg/
# Centroides a sii_roles_cl (SQL en docs/INVESTIGACION-CATASTRO-CL-2026.md, Fase 3).
# Ampliar cola del scraper mapasui:
#   editar scraper/sii-scraper/comunas-queue.json y relanzar (watchdog ya existe).
```

---

## FASE 6 — Índice CBR (best-effort)

1. Abrir el Índice de Propiedad público de la comuna objetivo (Santiago primero) en
   `conservadoresdigitales.cl`, inspeccionar la petición de búsqueda (endpoint, params,
   forma de la respuesta) y ajustar `parseIndice` en `scraper/cbr-indice-cl.mjs`.
2. Correr con una lista piloto de nombres:
```bash
node scraper/cbr-indice-cl.mjs \
  --search-url "https://<portal-cbr>/indice/buscar" \
  --comuna 13101 --cbr "CBR Santiago" --names-file nombres.txt --dry-run
```
Criterio de salida: filas en `cbr_indice_cl` (foja/número/año, **sin monto**), tabla separada.

---

## Dependencias

Fase 2 → Fase 3 (no cargar a escala sin verificar capa/campos). Fase 4 solo necesita
datos de Fase 3. Fases 5 y 6 son independientes. **Nada de F.2890 scrapeado ni sistemas
con Clave Única en ninguna fase.**
