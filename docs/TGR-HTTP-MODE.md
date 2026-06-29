# TGR — Modo HTTP directo (experimental)

Resultado de las pruebas controladas para reemplazar Selenium por HTTP directo
en el scraper de certificados de deuda de Tesorería (TGR). **Nada de esto está
desplegado todavía**: el modo por defecto sigue siendo `selenium` y el commit
estable de producción es `f2ffb4f` ("Disparar scraper con verificación CSV
mejorada", deploy CX33 #293).

## Resumen ejecutivo (las preguntas que importaban)

| Pregunta | Respuesta |
|---|---|
| ¿HTTP directo funciona? | **Sí.** 200 OK con el certificado en PDF base64, idéntico a Selenium. |
| ¿El `g-recaptcha-response` se puede reutilizar? | **Irrelevante.** El servidor **no lo valida**: se envía vacío y responde igual. No hay token que reutilizar ni captcha que resolver. |
| ¿Conviene crear `--mode http`? | **Sí.** Implementado, aditivo, reusa el mismo parser. |
| ¿Conviene seguir con Selenium? | Solo como fallback. HTTP es ~90x más rápido. |
| ¿Conviene no guardar `raw_html`? | **Sí** para la corrida masiva (`--no-save-raw-html`): ahorra ~11 GB. |
| ¿Velocidad real lograda? | 273 reg/min a concurrencia 10 (vs 3 reg/min Selenium). |
| ¿Cuántos días tardaría? | ~2,6 días (conc. 10) / ~4,9 días (conc. 5) vs **236 días** Selenium. |
| ¿Se volvió a `f2ffb4f`? | Producción intacta en `f2ffb4f`. El trabajo HTTP vive en rama aparte, default `selenium`. |

## El hallazgo central: el reCAPTCHA no se valida server-side

El formulario (`Controller.jpf`) trae un reCAPTCHA v2 **invisible** ligado al
botón Buscar (`<button class="g-recaptcha" data-callback="onSubmit">`). Por eso
el scraper Selenium "no maneja captcha": al ser un navegador real, el reCAPTCHA
invisible se auto-resuelve y mete el token en el POST.

La prueba decisiva (`tgr_http_probe.py`): un POST a
`TraerCertificadoDeudasAction.do` con `g-recaptcha-response=""` (vacío) devuelve
**200 OK con el certificado completo**. El control existe en el cliente pero el
servidor no lo verifica. → HTTP directo es viable **sin** bypass, sin servicios
de captcha-solving, sin nada que evada un control: el control no se aplica.

## Flujo HTTP

1. `GET /CertDeudasRolCutAixWeb/Controller.jpf?RUT=0&DV=0&EMAIL=` → cookies
   (`JSESSIONID` + `TS*` del WAF F5).
2. `POST .../TraerCertificadoDeudasAction.do` con
   `region=13&comuna=<valor>&rol=<n>&subRol=<n>&g-recaptcha-response=`
   (Content-Type `application/x-www-form-urlencoded`, Origin/Referer del sitio).
3. Respuesta HTML con `data:application/pdf;base64,...` embebido → se pasa a
   `parsear_resultado()` (el MISMO parser que Selenium; cero duplicación).

El `comuna` del POST es un código TGR (Las Condes=71, Vitacura=331, …), distinto
del nombre del CSV. El mapa nombre→código de la RM está hardcodeado en
`COMUNAS_TGR_RM` (52 comunas) porque `begin.do` es intermitente; se normalizan
tildes ("Ñuñoa"→"NUNOA") al matchear.

## Benchmark (medido contra el sitio real, ráfagas cortas)

| Concurrencia | reg/min | errores | WAF block | t/req |
|---|---|---|---|---|
| 1  | 32  | 0 | no | 0,74 s |
| 3  | 99  | 0 | no | 0,64 s |
| 5  | 145 | 0 | no | 0,68 s |
| 10 | 273 | 0 | no | 0,74 s |

Selenium actual: ~3 reg/min, alto consumo (Chrome headless × N), y el WAF F5
bloqueaba con 4+ workers. HTTP no gatilló el WAF en ningún nivel.

**Caveat honesto:** el benchmark fueron ráfagas de decenas de requests, no horas
sostenidas. El F5 ASM podría tener umbrales que se disparen tras miles de
requests; eso solo se confirma en una corrida real prolongada. El `HTTPWorker`
ya detecta "Request Rejected" y aplica cooldown + sesión nueva, igual que el
modo Selenium.

## ETA correcta (1.019.740 roles)

```
días = pendientes / reg_por_min / 1440
Selenium  3/min  : 1.019.740 / 3   / 1440 ≈ 236 días
HTTP conc 5 (145): 1.019.740 / 145 / 1440 ≈ 4,9 días
HTTP conc 10(273): 1.019.740 / 273 / 1440 ≈ 2,6 días
```

## Cómo usarlo

```bash
# Estable (default, sin cambios):
python3 tgr_scraper.py --input roles.csv

# HTTP directo (experimental), prudente:
python3 tgr_scraper.py --mode http --workers 5 --no-save-raw-html --input roles.csv
```

Recomendación: empezar con `--workers 5` y vigilar errores/WAF antes de subir a
10. `--no-save-raw-html` para la corrida masiva (raw_html se conserva siempre en
errores, para diagnóstico).

## Cambios aplicados (todos aditivos)

- `scraper/tgr/tgr_http_probe.py` — probe de factibilidad standalone.
- `scraper/tgr/tgr_scraper.py` — clase `HTTPWorker`, `--mode {selenium,http}`
  (default selenium), `--delay-min/--delay-max`, `--no-save-raw-html`, mapa
  `COMUNAS_TGR_RM`. El modo Selenium **no se tocó**.
- `docs/TGR-HTTP-MODE.md` — este documento.

## Cómo volver al estado estable

El default ya es `selenium` y producción sigue en `f2ffb4f`. Para descartar todo
lo experimental: `git checkout f2ffb4f -- scraper/tgr/tgr_scraper.py` y borrar
`tgr_http_probe.py`, o no fusionar la rama.

## Prueba acotada en VPS (siguiente paso, antes de producción masiva)

Antes de lanzar `--mode http` contra toda la Región Metropolitana, hay una
corrida controlada de validación: una sola comuna, tiempo máximo acotado,
métricas de CPU/RAM/WAF/DB. Implementada en
`scraper/tgr/run-tgr-http-test.sh` + workflow manual
`.github/workflows/scrape-tgr-http-test.yml` (botón "Run workflow",
seleccionable desde esta rama sin tocar `main` ni el sentinel `.launch-tgr`).

Pasos:
1. Ejecutar **"Deploy a CX33"** (workflow_dispatch) eligiendo esta rama, para
   sincronizar el código (incluye `run-tgr-http-test.sh`) al VPS.
2. Ejecutar **"Scrape TGR — prueba acotada modo HTTP"** (workflow_dispatch)
   con `comuna=Las Condes`, `workers=5`, `max_seconds=3600` (1h).
3. El script filtra el CSV a esa comuna, corre con `--mode http
   --no-save-raw-html`, se corta solo con `timeout` al llegar a
   `max_seconds` (no espera a agotar la cola), y muestrea CPU/RAM cada 30s.
4. Al terminar deja en `scraper/output/` del VPS: `tgr-http-test-*.log` (log
   completo), `*-metrics.csv` (CPU/RAM cada 30s) y `*-resumen.txt`
   (procesados, reg/min, errores, bloqueos WAF, tamaño BD antes/después).
5. Si `WAF_BLOCKS = 0` y la corrida se sostuvo estable, repetir subiendo
   `workers` a 10. Si se sostiene varias horas, escalar comuna por comuna
   (Las Condes → Vitacura → Lo Barnechea → Colina → resto de RM) editando el
   input `comuna` y, para el resto de RM, usando el flujo masivo normal
   (`run-tgr.sh` con `--mode http`, pendiente de habilitar ahí cuando se
   apruebe la corrida completa).
6. Si aparece algún bloqueo WAF, bajar `workers` (o volver a Selenium, que
   sigue intacto como fallback) antes de reintentar.

## Extensión a todo Chile (pendiente, no implementado)

El mismo endpoint expone las 16 regiones (I–XVI); cada una tiene su propia lista
de comunas vía `begin.do?region=N`. El `HTTPWorker` hoy hardcodea solo la RM
(region=13). Generalizarlo requiere construir el mapa comuna→código por región
(parametrizar `REGION_METROPOLITANA_VALUE`). Técnicamente trivial con lo ya
probado.
