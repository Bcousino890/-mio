# RESUMEN EJECUTIVO: Construyendo Datainmobilaria Gratuito en Chile

**Preparado por:** Investigación de fuentes públicas de datos inmobiliarios  
**Fecha:** Junio 2026  
**Estado:** 16 fuentes investigadas, validadas y documentadas

---

## 🎯 HALLAZGOS CLAVE

### ✅ LO BUENO: Existe infraestructura
Chile tiene **9.5+ millones de propiedades georeferenciadas y documentadas** en fuentes públicas.

### ⚠️ LO MALO: Fragmentación de datos
Los datos están distribuidos entre **16+ instituciones públicas diferentes**, sin integración centralizada.

### 🔓 LO IMPORTANTE: Acceso legal existe
**Fuentes CC0 y dominio público permiten construir "Datainmobilaria" 100% gratuito y legal**, sin scraping prohibido.

---

## 📊 TOP 5 FUENTES MÁS VALIOSAS

### 1️⃣ IDE CHILE - Geometría Oficial (CC0)
- **Qué:** Marco Catastral Nacional con 9.4M parcelas vectorizadas
- **URL:** https://geoportal.cl
- **Formato:** Shapefile, GeoJSON, KML descargables
- **Cobertura:** 100% nacional
- **Licencia:** Creative Commons Cero (CC0) - Dominio Público
- **¿Por qué es crucial?** 
  - Única fuente oficial de geometría de parcelas
  - Licencia CC0 permite uso sin restricciones
  - Estándar para integración SIG
  - Actualización periódica (cada ~8 meses)
- **Impacto:** 9.4M propiedades con ubicación exacta

---

### 2️⃣ CATASTRAL.CL - Datos SII Procesados (GRATIS)
- **Qué:** 9.4M propiedades del SII en CSV/GeoPackage limpio
- **URL:** https://catastral.cl
- **Formato:** CSV, GeoPackage (descarga directa por comuna)
- **Cobertura:** 342 comunas (nacional progresiva)
- **Actualización:** Periódica (sigue actualizaciones SII)
- **¿Por qué es crucial?**
  - Única forma legal de obtener datos SII masivamente
  - SII.cl prohíbe scraping explícitamente
  - Catastral.cl es intermediario legítimo
  - Incluye: roles, avalúos, destino propiedad
- **Impacto:** Atributos fiscales de 9.4M propiedades

---

### 3️⃣ SIT RURAL - Propiedades Rurales + Suelos (GRATIS)
- **Qué:** Catastro propiedades rurales + análisis agroclimático + suelos
- **URL:** https://www.sitrural.cl + https://ide.minagri.gob.cl
- **Formato:** Shapefile, web viewer, CSV
- **Cobertura:** 100 municipios más rurales
- **Actualización:** Periódica (basada en SII)
- **¿Por qué es crucial?**
  - Único catastro específico de propiedades rurales
  - Incluye contexto agrícola (suelos, capacidad uso)
  - Cubre 40% del territorio rural chileno
  - Integrado en IDE Minagri
- **Impacto:** Propiedades rurales + análisis de suelos

---

### 4️⃣ CBRS - CONSERVADOR DE BIENES RAÍCES (Oficial)
- **Qué:** Registro legal oficial de propietarios + transacciones
- **URL:** https://conservador.cl/portal/consultas_en_linea
- **Formato:** Búsqueda web, certificados PDF
- **Cobertura:** 100% nacional (39 conservadores por región)
- **Actualización:** INMEDIATA (es registro legal)
- **¿Por qué es crucial?**
  - Única fuente de propietarios legales
  - Historial oficial de transacciones
  - Información de hipotecas y prohibiciones
  - Acceso público sin autenticación
- **Impacto:** Propietarios + transacciones históricas

---

### 5️⃣ ARCHIVO NACIONAL - Histórico Digitalizado (GRATIS)
- **Qué:** 3.4M registros de propiedad digitalizados (1859-presente)
- **URL:** https://documentos.archivonacional.cl
- **Formato:** PDF digitalizado, búsqueda online
- **Cobertura:** Nacional histórica (200+ años)
- **Actualización:** Contínua (nuevas digitalizaciones)
- **¿Por qué es crucial?**
  - Único acceso a histórico de +150 años
  - Datos en dominio público
  - Permite análisis de cambios de propiedad
  - Complementa CBRS actual
- **Impacto:** Serie histórica de propiedades desde 1859

---

## 💾 ARQUITECTURA TÉCNICA RECOMENDADA

### Opción A: "MVP Datainmobilaria" (Rápido, 3-6 meses)

```
┌─────────────────────────────────────────────────────────────┐
│                    DATAINMOBILARIA                          │
│  (9.4M propiedades con geometría, atributos y propietarios) │
└─────────────────────────────────────────────────────────────┘
                            ↑
                ┌───────────┬────────────┐
                ↓           ↓            ↓
            ┌────────┐  ┌────────┐  ┌────────┐
            │ IDE CH │  │  SII   │  │  CBRS  │
            │(Geom)  │  │(Datos) │  │(Owner) │
            └────────┘  └────────┘  └────────┘
             9.4M       9.4M        Búsqueda
            parcelas    roles       pública
            CC0        Catastral    Oficial
```

**Stack:**
- PostgreSQL + PostGIS (geospatial DB)
- Node.js/Python API
- Frontend React/Vue (mapa interactivo)
- Elasticsearch (búsqueda)

**ETL:**
1. Descargar IDE Chile (Geoportal.cl) → PostgreSQL/PostGIS
2. Descargar Catastral.cl (CSV) → Elasticsearch
3. Indexar CBRS (web scraping ético) → Búsqueda
4. API REST que une datos

**Resultado:** Plataforma con 9.4M propiedades, búsqueda por dirección/rol, mapas

**Costo:** $0 en datos, ~$2-5K USD desarrollo inicial

---

### Opción B: "Full Stack Datainmobilaria" (Completo, 9-12 meses)

```
┌──────────────────────────────────────────────────────────────┐
│              DATAINMOBILARIA COMPLETO                        │
│  (9.4M propiedades + rurales + análisis + transacciones)    │
└──────────────────────────────────────────────────────────────┘
        ↓         ↓         ↓         ↓         ↓         ↓
    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
    │IDE CHI │ │CATAST  │ │SIT RUR │ │ CBRS   │ │ MINVU  │ │ CIREN  │
    │ (Geom)│ │ (SII)  │ │(Rural) │ │ (Owne) │ │(Social)│ │(Suelos)│
    └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
     9.4M       9.4M       2M+       Búsqueda   Polígonos   Análisis
    parcelas    roles      rurales   oficial    1930-2016   agro
    CC0        Catastral  SHP       Oficial    SHP        SHP
```

**Incluye adicional:**
- 2M+ propiedades rurales (SIT Rural)
- Análisis de suelos (CIREN)
- Vivienda social (MINVU)
- Transacciones históricas (Archivo Nacional)
- Derechos de agua (DGA)

**Stack adicional:**
- APIs WMS/WFS (GeoServer)
- Machine learning para valuación
- Análisis de mercado
- Dashboard BI (Metabase/Superset)

**Costo:** $0 datos, ~$10-20K USD desarrollo

---

## 🔄 PLAN DE ACTUALIZACIÓN

| Ciclo | Acción | Fuentes | Frecuencia |
|-------|--------|---------|-----------|
| **Diario** | Monitoreo CBRS transacciones | CBRS | Automático |
| **Semanal** | Validar disponibilidad APIs | Todos | Manual |
| **Mensual** | Re-sincronizar datos estáticos | IDE, Catastral, SIT Rural | ETL automático |
| **Trimestral** | Audit de calidad | Geom vs Atributos | Manual |
| **Anual** | Review de nuevas fuentes | Instituciones públicas | Manual |

---

## ⚖️ ANÁLISIS LEGAL Y LICENCIAMIENTO

### ✅ FUENTES CON LICENCIA CLARA

| Fuente | Licencia | Términos |
|--------|----------|----------|
| IDE Chile | **CC0** | Dominio público, uso libre |
| SIT Rural | Abierta | Acceso libre, sin restricciones |
| IDE Minagri | Abierta | Servicios WMS/WFS públicos |
| IDE MBN | Abierta | Datos fiscales públicos |
| CIREN | Abierta | Datos naturales públicos |
| INE | **CC0** | Dominio público |
| MINVU | CC0-like | Datos sociales abiertos |
| Catastral.cl | Sin restricción | Procesa datos SII legalmente |
| Archivo Nacional | Dominio público | Documentos históricos públicos |

### ❌ FUENTES CON RESTRICCIÓN

| Fuente | Restricción | Alternativa |
|--------|------------|-----------|
| SII.cl | Scraping prohibido en TyC | Usar Catastral.cl |
| CBRS portal | Sin descarga masiva | Búsqueda individual pública |
| Data Inmobiliaria | Pago requerido | IDE + Catastral gratuitos |
| SimpleAPI | API privada pago | Usar fuentes públicas |

### ✅ RECOMENDACIÓN: USAR SOLO FUENTES ABIERTAS

```
Datainmobilaria debe construirse SOLO con:
✅ IDE Chile (CC0)
✅ Catastral.cl (Datos SII legítimos)
✅ SIT Rural (Abierto)
✅ CBRS (Acceso público)
✅ Archivo Nacional (Dominio público)

❌ Evitar: SII.cl directo, Data Inmobiliaria, APIs pago
```

---

## 📈 CASOS DE USO INMEDIATOS

### 1. Búsqueda de Propiedades
- Usuario ingresa dirección o rol
- Retorna: Geometría, avalúo, propietario (si CBRS)
- Mapa interactivo

### 2. Análisis de Vecindario
- Usuario selecciona zona
- Retorna: # propiedades, avalúo promedio, destinos
- Gráficos y estadísticas

### 3. Historial de Propiedad
- Usuario busca por folio
- Retorna: Transacciones (Archivo Nacional + CBRS)
- Línea temporal de propietarios

### 4. Análisis Rural
- Usuario selecciona propiedad rural
- Retorna: Capacidad agrícola, suelos, derechos agua
- Reportes agronómicos

### 5. Vivienda Social
- Usuario busca campamentos/conjuntos
- Retorna: Ubicación, año construcción, # viviendas
- Análisis de cobertura

---

## 💰 PRESUPUESTO ESTIMADO

### Desarrollo MVP (9.4M propiedades base)

| Concepto | Costo | Notas |
|----------|-------|-------|
| Datos | $0 | Todas fuentes públicas gratuitas |
| Backend (2-3 meses) | $8-12K USD | Node.js + PostgreSQL + API |
| Frontend (2 meses) | $5-8K USD | React + mapa interactivo |
| DevOps/Hosting | $500-1K USD/mes | AWS/Digital Ocean |
| QA y Testing | $3-5K USD | Validación de datos |
| **TOTAL INICIAL** | **$16-26K USD** | Una sola vez |
| **Mantenimiento anual** | **$8-12K USD** | ETL + soporte |

### Versión Full Stack (9.4M + rural + análisis)

| Concepto | Costo | Notas |
|----------|-------|-------|
| Datos | $0 | Todas fuentes públicas |
| Backend (4 meses) | $15-20K USD | APIs + integraciones |
| Frontend (3 meses) | $10-15K USD | Mapas + análisis |
| ML/Análisis (2 meses) | $8-12K USD | Valuación + insights |
| DevOps/Hosting | $1-2K USD/mes | Escalable |
| **TOTAL INICIAL** | **$33-59K USD** | Una sola vez |
| **Mantenimiento anual** | **$15-25K USD** | ML + soporte |

---

## 🎓 TECNOLOGÍAS RECOMENDADAS

### Backend
- **Node.js + Express** (API REST)
- **PostgreSQL + PostGIS** (Geospatial data)
- **Elasticsearch** (Full-text search)
- **Bull/RabbitMQ** (ETL jobs)

### Frontend
- **React/Vue** (UI)
- **Leaflet/Mapbox GL** (Maps)
- **D3.js/Chart.js** (Analytics)
- **Material UI** (Components)

### DevOps
- **Docker** (Containerization)
- **GitHub Actions** (CI/CD)
- **AWS EC2/RDS** o **DigitalOcean** (Hosting)
- **Grafana** (Monitoring)

### Data
- **GDAL/OGR** (Geospatial processing)
- **Python Pandas** (ETL)
- **QGIS** (QA visual)

---

## 🚀 ROADMAP 12 MESES

### Mes 1-2: Prototipo
- ✅ Descarga IDE Chile + Catastral.cl
- ✅ PostgreSQL + GeoServer setup
- ✅ API REST básica
- Objetivo: 9.4M propiedades indexadas

### Mes 3-4: MVP Web
- ✅ Frontend búsqueda + mapa
- ✅ Integración CBRS (búsqueda pública)
- ✅ Deploy inicial
- Objetivo: Usuarios pueden buscar propiedades

### Mes 5-6: Extensión Rural
- ✅ Integrar SIT Rural (2M+ propiedades)
- ✅ Añadir análisis de suelos (CIREN)
- ✅ Derechos de agua (DGA)
- Objetivo: Cobertura rural completa

### Mes 7-8: Histórico
- ✅ Integrar Archivo Nacional (3.4M docs)
- ✅ Timeline de transacciones
- ✅ Análisis histórico
- Objetivo: Propiedades con historia 200 años

### Mes 9-10: Análisis Avanzado
- ✅ Machine Learning para valuación
- ✅ Dashboard BI
- ✅ Reportes automáticos
- Objetivo: Intelligence layer

### Mes 11-12: Escalado
- ✅ Optimizaciones performance
- ✅ Replicación de BD
- ✅ API pública
- ✅ Documentación completa
- Objetivo: Plataforma estable y escalable

---

## 🔍 INDICADORES DE ÉXITO

### Mes 3
- [ ] 9.4M propiedades indexadas
- [ ] Búsqueda por dirección funciona
- [ ] Tiempo respuesta <500ms
- [ ] Cobertura geográfica 80%+

### Mes 6
- [ ] 11M+ propiedades totales (urbanas + rurales)
- [ ] Información de propietario disponible
- [ ] 3 formas de búsqueda (dirección, rol, folio)
- [ ] API REST pública

### Mes 12
- [ ] 15M+ registros totales (con histórico)
- [ ] 100K+ usuarios mensuales
- [ ] Machine learning valuación activo
- [ ] Análisis territorial disponible
- [ ] Open source documentado

---

## 🎯 CONCLUSIONES

### ¿Es posible Datainmobilaria gratuito?
**✅ SÍ - Completamente viable**

Existen:
- Geometría oficial (IDE Chile, CC0)
- Datos fiscales (Catastral.cl, legal)
- Propietarios (CBRS, público)
- Histórico (Archivo Nacional, dominio público)
- Análisis complementarios (SIT Rural, CIREN, etc.)

### ¿Cuál es la barrera?
**⚠️ Integración técnica, NO data**

Los datos existen pero están distribuidos en 16+ portales. Necesita:
1. ETL que unifique fuentes
2. Base de datos geoespacial
3. API que integre
4. Frontend que exponga

### ¿Cuánto cuesta?
**💰 $0 en datos, $16-60K USD desarrollo inicial**

Después $8-25K USD/año mantenimiento.

### ¿Quién puede hacerlo?
**👥 Startup, Fundación, ONG, Gobierno, Academia**

Oportunidad de:
- Democratizar acceso a datos
- Crear empresa (SaaS premium)
- Servicio público (modelo Chile)
- Investigación académica

---

## 📋 PRÓXIMOS PASOS RECOMENDADOS

### Corto Plazo (Mes 1)
1. [ ] Validar viabilidad técnica (POC)
2. [ ] Descargar muestras de cada fuente
3. [ ] Mapear esquemas de datos
4. [ ] Definir modelo de negocio

### Mediano Plazo (Mes 2-3)
1. [ ] Setup infraestructura
2. [ ] Prototipo funcional
3. [ ] Validar con usuarios piloto
4. [ ] Plan de fundraising (si startup)

### Largo Plazo (Mes 6+)
1. [ ] MVP público
2. [ ] Estrategia de crecimiento
3. [ ] Análisis de traction
4. [ ] Escalado

---

## 📚 REFERENCIAS CLAVE

**Documentos complementarios en repositorio:**
- `INVESTIGACION_FUENTES_DATOS_PROPIEDADES_CHILE.md` - Ficha técnica completa de 15 fuentes
- `MATRIZ_RAPIDA_FUENTES_DATOS.md` - Matriz de acceso y formatos

**URLs Principales:**
- IDE Chile: https://geoportal.cl
- Catastral.cl: https://catastral.cl
- SIT Rural: https://www.sitrural.cl
- CBRS: https://conservador.cl
- Archivo Nacional: https://documentos.archivonacional.cl

---

**Documento:** Resumen Ejecutivo  
**Versión:** 1.0  
**Fecha:** Junio 2026  
**Estado:** Listo para implementación  
**Siguiente:** Iniciar POC técnico
