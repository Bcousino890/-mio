# MATRIZ RÁPIDA DE REFERENCIA - Fuentes de Datos Inmobiliarios Chile

## TABLA MAESTRA DE ACCESO

| # | FUENTE | URL | DATOS CLAVE | COBERTURA | FORMATO | LICENCIA | SCRAPING | AUTENTICACIÓN | MEJOR PARA |
|---|--------|-----|----------|-----------|---------|---------|----------|---------------|-----------|
| 1 | **SII Catastro Fiscal** | https://www.sii.cl + https://www4.sii.cl/mapasui | Roles, avalúos, contribuciones, destino | Nacional | Web viewer, mapas | Pública restringida | ❌ NO | Clave Tributaria | Avalúos y roles |
| 2 | **Catastral.cl** ⭐ | https://catastral.cl | 9.4M propiedades + SII procesado | 342 comunas | CSV, GeoPackage | CC0-like | ✅ SÍ | NO | **MEJOR descarga SII** |
| 3 | **IDE Chile** ⭐ | https://geoportal.cl | Marco Catastral (9.4M parcelas), límites, vías | Nacional | SHP, GeoJSON, KML, CSV | **CC0** | ✅ SÍ | NO | **GEOMETRÍA OFICIAL** |
| 4 | **CBRS - Conservador** | https://conservador.cl/portal/consultas_en_linea | Propietarios, transacciones, hipotecas, folios | Nacional | Web consulta, PDF certificados | Público | ⚠️ Depende | NO consulta | Propietarios + transacciones |
| 5 | **Archivo Nacional** | https://documentos.archivonacional.cl | Registros históricos (1859-presente), 3.4M docs | Nacional histórica | PDF digitalizado | Dominio público | ✅ SÍ | NO consulta | Historial propiedades |
| 6 | **SIT Rural** ⭐ | https://www.sitrural.cl | Propiedades rurales, suelos, agroclimatología | Rural (100 mun) | SHP, web viewer | Abierto | ✅ SÍ | NO | **PROPIEDADES RURALES** |
| 7 | **IDE Minagri** | https://ide.minagri.gob.cl | SIT Rural data, IDE services, WMS/WFS | Rural + Nacional | SHP, WMS/WFS, CSV | Abierto | ✅ SÍ | NO | Descargas SIT Rural |
| 8 | **CIREN** | https://www.ciren.cl + https://ide.minagri.gob.cl | Suelos, propiedades rurales, erosión | Atacama-Aysén | SHP, vectorial | Abierto | ✅ SÍ | NO | Análisis de suelos |
| 9 | **IDE Bienes Nacionales** | https://idembn.bienes.cl | Propiedad fiscal, SNASPE, patrimonio | Fiscal nacional | SHP, KML, GeoJSON | Abierto | ✅ SÍ | NO | Propiedades públicas |
| 10 | **INE - Geodatos** | https://www.geoine-ine-chile.opendata.arcgis.com | Censo 2017/2022, permisos edificación, vivienda | Nacional (agregado) | CSV, SHP, KML, GeoJSON | CC0 | ✅ SÍ | NO | Análisis territorial |
| 11 | **MINVU Geoportal** | https://ide.minvu.cl | Vivienda social (1930-2016), campamentos | Nacional | SHP, CSV, KML, GeoJSON | Abierto | ✅ SÍ | NO | Vivienda social |
| 12 | **DGA Catastro Aguas** | https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas | Derechos de agua, embalses, hidrografía | Nacional (cuencas) | Portal búsqueda | Público | ✅ SÍ | NO | Derechos de agua |
| 13 | **CONAF SIT** | https://sit.conaf.cl | Catastro vegetacional, bosques nativos | Nacional | Web viewer, SHP | Abierto | ✅ SÍ | NO | Cobertura forestal |
| 14 | **INFOR** | https://ifn.infor.cl | Inventario forestal nacional, volumetrías | Nacional | Estadísticas, descarga | Abierto | ✅ SÍ | NO | Recursos forestales |
| 15 | **SBAP** | https://sbap.gob.cl | Áreas protegidas nacionales | Nacional | ArcGIS, web | Abierto | ✅ SÍ | NO | Áreas protegidas |
| 16 | **datos.gob.cl** | https://datos.gob.cl | Agregador institucional (variable) | Nacional (variable) | Depende dataset | Variable | Depende | NO | Búsqueda centralizada |

⭐ = Recomendadas como base de "Datainmobilaria"

---

## ACCESO RÁPIDO POR NECESIDAD

### 📍 "Necesito GEOMETRÍA de parcelas"
```
PRIMERA OPCIÓN:  IDE Chile (Geoportal.cl) 
                 → CC0, oficial, vectorial
                 → Descarga: Geoportal → "Planning and Cadastre"
                 
ALTERNATIVA:     Catastral.cl 
                 → Ya procesado con datos SII
                 → Descarga: CSV + GeoPackage
```

### 💰 "Necesito AVALÚOS y ROLES SII"
```
PRIMERA OPCIÓN:  Catastral.cl ⭐
                 → Datos SII en CSV/GeoPackage
                 → Descarga directa por comuna
                 
ACCESO OFICIAL:  https://www4.sii.cl/mapasui (web viewer)
                 → Consultas individuales, no descarga masiva
```

### 👤 "Necesito PROPIETARIOS y TRANSACCIONES"
```
PRIMERA OPCIÓN:  CBRS - Conservador
                 → https://conservador.cl/portal/consultas_en_linea
                 → Búsqueda por apellido/folio/dirección
                 → Certificados descargables (PDF, $15-30 USD)
                 
HISTÓRICO:       Archivo Nacional
                 → https://documentos.archivonacional.cl
                 → Registros 1859-presente, gratis
```

### 🌾 "Necesito PROPIEDADES RURALES"
```
PRIMERA OPCIÓN:  SIT Rural ⭐
                 → https://www.sitrural.cl
                 → 100 municipios más rurales
                 → Descarga SHP desde IDE Minagri
                 
COMPLEMENTO:     CIREN (suelos)
                 → https://ide.minagri.gob.cl
```

### 🏘️ "Necesito VIVIENDA SOCIAL y CAMPAMENTOS"
```
OPCIÓN ÚNICA:    MINVU Geoportal
                 → https://ide.minvu.cl
                 → Catastro viviendas sociales (1930-2016)
                 → Catastro de campamentos
```

### 📊 "Necesito ANÁLISIS TERRITORIAL/DEMOGRÁFICO"
```
OPCIÓN ÚNICA:    INE Geodatos
                 → https://www.geoine-ine-chile.opendata.arcgis.com
                 → Censo 2017, 2022 por zona censal
                 → Permisos edificación
```

### 💧 "Necesito DERECHOS DE AGUA"
```
OPCIÓN ÚNICA:    DGA Catastro Público
                 → https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/
                 → Búsqueda de derechos por cuenca
```

---

## MATRIZ DE DESCARGA Y FORMATOS

| Fuente | CSV | SHP | GeoJSON | KML | WMS | WFS | PDF | Descarga Automática |
|--------|-----|-----|---------|-----|-----|-----|-----|-------------------|
| IDE Chile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ Directo |
| Catastral.cl | ✅ | - | - | - | - | - | - | ✅ Directo |
| SIT Rural | ✅ | ✅ | - | - | ✅ | ✅ | - | ✅ IDE Minagri |
| IDE Minagri | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ Directo |
| CIREN | - | ✅ | - | - | ✅ | ✅ | - | ✅ IDE |
| IDE MBN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ Directo |
| INE | ✅ | ✅ | ✅ | ✅ | - | - | - | ✅ ArcGIS |
| MINVU | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ Directo |
| SII | - | - | - | - | - | - | ✅ | ❌ Prohibido |
| CBRS | - | - | - | - | - | - | ✅ | ⚠️ Limitado |

---

## ESTRATEGIA DE INTEGRACIÓN PARA DATAINMOBILARIA

### FASE 1: Núcleo (Obligatorio)
```
┌─────────────────────────────────────┐
│ Geometría: IDE Chile (9.4M parcelas)│
│ Atributos: Catastral.cl (datos SII) │
│ Enlace: Rol SII                     │
└─────────────────────────────────────┘
        ↓
  9+ millones de propiedades
  con localización + avalúo
```

### FASE 2: Propietarios
```
┌─────────────────────────────────────┐
│ CBRS (búsqueda web + Archivo Nac.)  │
│ Enlace: Folio + dirección           │
└─────────────────────────────────────┘
  Información de propietarios
  + transacciones históricas
```

### FASE 3: Extensión Rural
```
┌─────────────────────────────────────┐
│ SIT Rural (100 municipios)          │
│ CIREN (suelos + capacidad uso)      │
│ DGA (derechos de agua)              │
└─────────────────────────────────────┘
  Propiedades rurales
  con contexto agrícola
```

### FASE 4: Agregados Territoriales
```
┌─────────────────────────────────────┐
│ INE (demografía)                    │
│ MINVU (vivienda social)             │
│ Permiso construcción (edificación)  │
└─────────────────────────────────────┘
  Análisis por zona censal
  y conjunto residencial
```

---

## RESTRICCIONES LEGALES

### ❌ PROHIBIDO (Sin autorización)
- SII.cl: Scraping explícitamente prohibido en TyC
- CBRS portal: Sin descarga masiva automatizada
- Conservador: Acceso individual solo

### ✅ PERMITIDO (Usar)
- IDE Chile: CC0 - uso libre
- Catastral.cl: Datos SII ya procesados legalmente
- SIT Rural: Acceso libre
- MINVU: CC0 equivalente
- INE: CC0
- Archivo Nacional: Dominio público

### ⚠️ GRIS (Consultar)
- Data Inmobiliaria: Usa APIs privadas (pago)
- SimpleAPI: Acceso SII (requiere licencia)
- CBRS: Certificados individuales con costo

---

## TABLA DE ACTUALIZACIÓN

| Fuente | Frecuencia | Latencia |
|--------|-----------|----------|
| IDE Chile | 8 meses | ~2 semanas |
| Catastral.cl | Periódica | ~1 mes |
| SII (Mapas) | Variable | ~1 mes |
| SIT Rural | Periódica | ~2 meses |
| CIREN | Periódica | ~3 meses |
| CBRS | INMEDIATA | Transacciones reales |
| INE | Anual/Quinquenal | ~3 meses |
| MINVU | Periódica | ~1 mes |
| DGA | Mensual | ~2 semanas |

---

## COSTOS

| Fuente | Descarga | Certificados | API |
|--------|----------|--------------|-----|
| IDE Chile | ✅ GRATIS | - | - |
| Catastral.cl | ✅ GRATIS | - | - |
| SIT Rural | ✅ GRATIS | - | - |
| IDE Minagri | ✅ GRATIS | - | - |
| CIREN | ✅ GRATIS | - | - |
| IDE MBN | ✅ GRATIS | - | - |
| INE | ✅ GRATIS | - | - |
| MINVU | ✅ GRATIS | - | - |
| DGA | ✅ GRATIS | - | - |
| **CBRS** | ✅ GRATIS consulta | 💰 $15-30 USD | - |
| **Archivo Nac.** | ✅ GRATIS consulta | 💰 Varía | - |
| **SII** | ❌ No | ❌ No | 💰 APIs privadas |
| **Data Inmobiliaria** | ❌ No | - | 💰 PAGO |

---

## RECOMENDACIÓN FINAL

### Para "Datainmobilaria" GRATUITO y LEGAL:

**Stack Mínimo:**
1. IDE Chile (Geometría) + Catastral.cl (Atributos SII)
2. SIT Rural (Rurales)
3. CBRS consultas públicas (Propietarios)
4. Archivo Nacional (Histórico)

**Costo Total:** $0 USD  
**Propiedades Cubiertas:** 9.4+ millones  
**Actualización:** Mensual  
**Licencia:** CC0 / Dominio Público

---

## CONTACTOS Y SOPORTE

| Institución | Email Soporte | Teléfono | Web |
|-------------|--------------|----------|-----|
| IDE Chile | - | - | https://www.ide.cl |
| SII | - | +56 2 2675 8000 | https://www.sii.cl |
| CBRS | info@conservador.cl | +56 2 2585 8118 | https://conservador.cl |
| Archivo Nac. | - | - | https://www.archivonacional.gob.cl |
| MINAGRI | - | - | https://minagri.gob.cl |
| MINVU | - | - | https://www.minvu.gob.cl |
| INE | - | +56 2 2476 8200 | https://www.ine.gob.cl |

---

**Versión:** 1.0  
**Fecha:** Junio 2026  
**Formato:** Referencia rápida  
**Actualización:** Consultar sitios principales mensualmente
