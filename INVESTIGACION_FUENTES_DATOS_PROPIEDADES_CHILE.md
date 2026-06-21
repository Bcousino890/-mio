# Investigación Completa: Fuentes Públicas y Gratuitas de Datos de Propiedades en Chile

**Fecha:** Junio 2026  
**Objetivo:** Documentar todas las fuentes públicas de datos inmobiliarios en Chile para construir un "Datainmobilaria" gratuito

---

## SUMARIO EJECUTIVO: TOP 5 FUENTES MÁS ÚTILES

| Ranking | Fuente | Por Qué | Cobertura | Acceso |
|---------|--------|--------|-----------|--------|
| 1 | **SII - Catastro Fiscal** | 9.5M propiedades + roles + avalúos + geometría | Nacional | Consultas web, Mapas SII, API privadas |
| 2 | **Conservador de Bienes Raíces (CBRS)** | Registro legal de transacciones + propietarios | Nacional | Consultas web por municipal, índice de propiedad |
| 3 | **IDE Chile (Geoportal)** | Geometría vectorial + múltiples capas + formatos (SHP, KML, GeoJSON, WFS/WMS) | Nacional | Descarga directa, WMS/WFS, descarga SHP |
| 4 | **SIT Rural (Ministerio Agricultura)** | Catastro propiedades rurales + uso suelos + agroclimatología | Rural (100 municipios más rurales) | Web viewer, descargas SHP, libres |
| 5 | **IDE Bienes Nacionales (IDE MBN)** | Propiedad fiscal administrada + SNASPE + rutas patrimonio | Fiscal nacional | Descarga SHP/KML, WMS/WFS |

**Insight Crítico:** El SII es la fuente más valiosa con 9.5M propiedades georreferenciadas, pero distribución de datos es fragmentada entre múltiples plataformas (SII.cl, Mapas SII, CIREN, SIT Rural, Catastral.cl).

---

## FICHA TÉCNICA COMPLETA POR FUENTE

### 1. SII - SERVICIO DE IMPUESTOS INTERNOS

**Descripción General:**
El SII es la autoridad fiscal que mantiene el Catastro Fiscal de Bienes Raíces (CFBR), conteniendo información sobre todas las propiedades en Chile con valor fiscal y tributario.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.sii.cl |
| **Endpoints API** | - Mapas SII: https://www4.sii.cl/mapasui/internet/ |
| | - Consultas web: https://www.sii.cl/servicios_online/1048-.html |
| | - Consultar antecedentes: https://www.sii.cl/como_se_hace_para/bienes_raices.html |
| **Datos Disponibles** | - Roles de avalúo (número de propiedad único) |
| | - Avalúo fiscal (valuación tributaria) |
| | - Contribuciones de bienes raíces |
| | - Destino de la propiedad (agrícola, urbana, etc.) |
| | - Dirección y localización |
| | - Geometría parcial (puntos + mapas) |
| | - Datos de propietarios (RUT) |
| **Cobertura Geográfica** | Nacional - todas las regiones y comunas |
| **Nivel de Detalle** | Completo a nivel de propiedad individual |
| **Frecuencia Actualización** | Los mapas se actualizan periódicamente; cambios tributarios inmediatos |
| **Formato de Datos** | - Web viewer (interactivo) |
| | - Mapas descargables (imagen/raster) |
| | - Consultas HTML en portal |
| | - APIs privadas disponibles (SimpleAPI, ApiPyme, ApiRCV) |
| **Licencia/Términos** | Datos públicos pero con restricciones de uso |
| **¿Permite Scraping?** | NO - Explícitamente prohibido en Términos y Condiciones |
| | - TyC: "Reproducción de información debe ser expresamente autorizada por SII" |
| | - Sistemas automáticos que obstruyan la plataforma prohibidos |
| **Autenticación Requerida** | Para consulta detallada: Clave Tributaria o ClaveÚnica (gratuita) |
| **Notas Importantes** | - Catastral.cl reclama 9.4M propiedades del SII en descarga abierta |
| | - SimpleAPI ofrece acceso programático a datos SII |
| | - Mapas disponibles pero sin descarga vectorial nativa del SII |

**Acceso Práctico:**
```
1. Consultas web: https://www.sii.cl → "Mis bienes raíces (información integrada)"
2. Mapas interactivos: https://www4.sii.cl/mapasui/internet/
3. APIs privadas: SimpleAPI, ApiPyme, ApiRCV
4. Datos vectoriales: Catastral.cl (descarga no oficial de datos SII)
```

---

### 2. CONSERVADOR DE BIENES RAÍCES (CBR / CBRS)

**Descripción General:**
Oficinas públicas (por jurisdicción) que mantienen el registro legal de transacciones de propiedades, hipotecas, prohibiciones y cambios de dominio.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.conservador.cl (portal nacional) |
| | https://conservador.cl/portal/indice_propiedad (índice) |
| **Endpoints API** | No hay API oficial pública |
| | Consultas: https://www.conservador.cl/portal/consultas_en_linea |
| | Conservadores digitales: https://conservadoresdigitales.cl |
| **Datos Disponibles** | - Registro de dominio (propietarios actuales) |
| | - Hipotecas y prohibiciones |
| | - Histórico de transacciones |
| | - Folio real (identificador único de propiedad) |
| | - Datos de RUT de propietarios |
| | - Detalles de transferencias y herencias |
| **Cobertura Geográfica** | Nacional por jurisdicciones (39 Conservadores por región) |
| **Nivel de Detalle** | Completo - registro legal íntegro |
| **Frecuencia Actualización** | Inmediata (es el registro oficial de cambios) |
| **Formato de Datos** | - Consultas web (búsqueda por apellido/folio) |
| | - Certificados descargables (PDF) |
| | - Consulta por portal en línea |
| **Licencia/Términos** | Datos públicos - acceso libre a ciudadanía |
| **¿Permite Scraping?** | Depende de TyC de conservador específico |
| | Información es pública pero sin API, web scraping podría ser restrictivo |
| **Autenticación Requerida** | NO para consultas de terceros (por apellido/folio) |
| | Sí para trámites en línea completos |
| **Notas Importantes** | - Oficialmente NO hay descarga masiva de datos |
| | - Cada conservador cubre jurisdicción específica |
| | - Hay ~200-300 años de registros digitalizados |
| | - Archivo Nacional mantiene copias digitales históricas |

**Acceso Práctico:**
```
1. Búsqueda por propiedad: https://www.conservador.cl/portal/consultas_en_linea
2. Búsqueda por apellido: Indicar apellido, municipio, año aproximado
3. Descarga de certificados: Digital vía email (2 horas)
4. Datos históricos: https://documentos.archivonacional.cl/
```

---

### 3. IDE CHILE - INFRAESTRUCTURA DE DATOS GEOESPACIALES

**Descripción General:**
Red coordinada de instituciones públicas que comparte datos cartográficos y geoespaciales. Principal fuente de geometría vectorial de propiedades.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.ide.cl |
| | https://www.geoportal.cl (Geoportal de Chile) |
| **Endpoints API** | WMS: Servicios de mapas web estándar |
| | WFS: Servicios de features web (descarga vectorial) |
| | API REST: Según capa específica |
| | Catálogo: https://datos.gob.cl/organization/infraestructura-de-datos-geoespaciales-de-chile |
| **Datos Disponibles** | - Parcelas catastrales (Marco Catastral Nacional) |
| | - Límites administrativos (comunas, regiones) |
| | - Perímetros urbanos |
| | - Redes viales |
| | - Infraestructura (agua, gas, electricidad) |
| | - Cobertura de suelo |
| | - Cartografía temática |
| **Cobertura Geográfica** | Nacional - todas las regiones |
| **Nivel de Detalle** | Parcela/lote (escalas 1:5000 a 1:50000) |
| **Frecuencia Actualización** | Varía según capa: mensual a anual |
| | Marco Catastral: actualización periódica (cada 8 meses aprox.) |
| **Formato de Datos** | - Shapefiles (SHP) descargables |
| | - GeoJSON |
| | - KML |
| | - GeoPackage |
| | - CSV |
| | - WMS/WFS services |
| **Licencia/Términos** | Creative Commons Cero (CC0) - Dominio Público |
| | Datos libres para uso sin restricciones |
| **¿Permite Scraping?** | SÍ - Datos bajo CC0 permiten reutilización libre |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - Marco Catastral tiene ~9.4M parcelas |
| | - Descarga directa desde Geoportal |
| | - Integración en QGIS, ArcGIS, gvSIG sin restricciones |
| | - Servicios OGC estándar (WMS, WFS, WCS) |

**Acceso Práctico:**
```
1. Geoportal: https://geoportal.cl
2. Descarga SHP: Geoportal → Categoría "Planning and Cadastre"
3. WFS services: http://www.ide.cl/vinculos/servicios-de-mapas-y-catalogo/wfs/
4. IDE Minagri: https://ide.minagri.gob.cl (datos agrícolas)
```

---

### 4. SIT RURAL - SISTEMA INFORMACIÓN TERRITORIAL RURAL

**Descripción General:**
Sistema territorial financiado por MINAGRI para 100 municipios más rurales de Chile. Integra catastro de propiedades rurales + suelos + agroclimatología.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.sitrural.cl |
| **Endpoints API** | No API oficial, pero acceso WMS/WFS a través de IDE Minagri |
| | https://ide.minagri.gob.cl |
| **Datos Disponibles** | - Catastro de propiedades rurales |
| | - Uso actual de suelos |
| | - Capacidad de uso agrícola |
| | - Catastro de bosques nativos |
| | - Información agroclimatológica |
| | - Hidrografía |
| | - Centros poblados |
| | - Límites administrativos |
| **Cobertura Geográfica** | 100 municipios con más alta ruralidad en Chile |
| | Incluye: Atacama, Coquimbo, Valparaíso, Ñuble, Biobío, La Araucanía, |
| | Los Ríos, Los Lagos, Aysén (parcial) |
| **Nivel de Detalle** | Propiedad rural individual + características |
| **Frecuencia Actualización** | CIREN actualiza gráfico catastral basado en info SII |
| **Formato de Datos** | - Web viewer interactivo |
| | - Descargas SHP: https://ide.minagri.gob.cl |
| | - WMS/WFS services |
| | - CSV (en descarga) |
| **Licencia/Términos** | Acceso libre y gratuito |
| **¿Permite Scraping?** | SÍ - Datos de libre acceso |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - CIREN es responsable de actualizaciones |
| | - Datos basados en registros oficiales SII |
| | - Integración con IDE Minagri para descargas |
| | - Presencia desde 2010 |

**Acceso Práctico:**
```
1. Viewer web: https://www.sitrural.cl
2. Descargas SHP: https://ide.minagri.gob.cl
3. Descripción de coberturas: https://www.sitrural.cl/wp-content/uploads/2023/03/Descripcion-de-coberturas_2023.pdf
4. Visualización cartográfica: https://esri.ciren.cl/portal/
```

---

### 5. IDE BIENES NACIONALES (IDE MBN)

**Descripción General:**
Infraestructura de datos del Ministerio de Bienes Nacionales. Especializada en propiedad fiscal administrada, áreas protegidas (SNASPE), y patrimonio.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://ide.bienes.cl |
| | https://idembn.bienes.cl/catalog |
| **Endpoints API** | WMS/WFS services |
| | Catálogo de metadatos disponible |
| **Datos Disponibles** | - Propiedad fiscal administrada |
| | - Sistema Nacional de Áreas Silvestres Protegidas (SNASPE) |
| | - Patrimonio histórico |
| | - Rutas patrimoniales |
| | - Ocupaciones de suelo fiscal |
| **Cobertura Geográfica** | Nacional - toda propiedad fiscal |
| **Nivel de Detalle** | Predio fiscal completo |
| **Frecuencia Actualización** | Periódica (según cambios administrativos) |
| **Formato de Datos** | - Shapefiles descargables |
| | - KML |
| | - GeoJSON |
| | - WMS/WFS |
| | - PNG/GeoTIFF |
| **Licencia/Términos** | Datos públicos abiertos |
| **¿Permite Scraping?** | SÍ - Datos públicos |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - Especializado en fiscal, no privada |
| | - Integración con Bienes Nacionales catastro |
| | - Descarga directa de información frequente |

**Acceso Práctico:**
```
1. Catálogo: https://idembn.bienes.cl/catalog
2. Descarga: IDE MBN → "Download Information"
3. Viewer: https://idembn.bienes.cl/idembn/
```

---

### 6. CIREN - CENTRO DE INFORMACIÓN DE RECURSOS NATURALES

**Descripción General:**
Institución bajo MINAGRI que mantiene la base de datos más grande sobre recursos naturales de Chile. Especializada en suelos y propiedades rurales.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.ciren.cl |
| | https://bibliotecadigital.ciren.cl (Biblioteca Digital) |
| **Endpoints API** | Acceso a través de IDE Minagri: https://ide.minagri.gob.cl |
| **Datos Disponibles** | - Propiedades rurales (catastro gráfico) |
| | - Suelos agrológicos (series, propiedades físicoquímicas) |
| | - Uso actual de suelos |
| | - Capacidad de uso |
| | - Inventario de erosión |
| | - Datos de 7 regiones (Atacama a Aysén) |
| **Cobertura Geográfica** | Regiones: Atacama, Coquimbo, Valparaíso, |
| | Metropolitana, Ñuble, Biobío, La Araucanía, Los Ríos, Los Lagos, Aysén |
| **Nivel de Detalle** | Parcela/serie de suelo |
| **Frecuencia Actualización** | Catastro gráfico: basado en SII |
| | Suelos: estudios puntuales |
| **Formato de Datos** | - Shapefiles vectoriales (descarga desde IDE) |
| | - Archivos digitales |
| | - Mapas impresos (consultar) |
| | - CSV |
| **Licencia/Términos** | Acceso abierto |
| **¿Permite Scraping?** | SÍ |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - Mayor base de datos de recursos naturales Chile |
| | - Integración con IDE Minagri para descargas |
| | - Biblioteca digital: 100,000 documentos aprox. |
| | - Datos históricos 1859-presente (via Archivo Nacional) |

**Acceso Práctico:**
```
1. Biblioteca Digital: https://bibliotecadigital.ciren.cl
2. Portal IDE: https://ide.minagri.gob.cl
3. Portal ESRI: https://esri.ciren.cl/portal/
4. Suelos: https://www.ciren.cl/productos/suelos-agrologicos/
5. Propiedades rurales: https://www.ciren.cl/productos/propiedades-rurales/
```

---

### 7. DGA - DIRECCIÓN GENERAL DE AGUAS

**Descripción General:**
Autoridad que mantiene Catastro Público de Aguas. Información sobre derechos de agua registrados, embalses, y recursos hídricos.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://dga.mop.gob.cl |
| **Endpoints API** | Búsqueda de derechos: https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/ |
| **Datos Disponibles** | - Derechos de aprovechamiento de agua |
| | - Registro público de derechos |
| | - Información hidrométrica (flujos, precipitación) |
| | - Datos de embalses |
| | - Información meteorológica |
| | - Cuencas hidrográficas |
| **Cobertura Geográfica** | Nacional - por cuencas hidrográficas |
| **Nivel de Detalle** | Derecho de agua individual |
| **Frecuencia Actualización** | Mensual (inventory) |
| **Formato de Datos** | - Portal de búsqueda web |
| | - Registros históricos |
| | - Informes PDF |
| **Licencia/Términos** | Público dominio |
| **¿Permite Scraping?** | SÍ - información pública |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - Información sobre "derechos de agua" no sobre propiedades |
| | - Útil para análisis de propiedades con derechos de agua |
| | - Integración potencial con geometría catastral |

**Acceso Práctico:**
```
1. Catastro Público: https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/
2. Búsqueda de derechos: Ver "Registro Público de Derechos"
3. Inventario hidrológico: https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/inventario-publico-de-informacion-hidrologica-y-meteorologica/
```

---

### 8. INE - INSTITUTO NACIONAL DE ESTADÍSTICAS

**Descripción General:**
Institución de estadísticas públicas. Datos censales sobre vivienda, edificación y permisos de construcción.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.ine.gob.cl |
| | https://www.ine.gob.cl/herramientas/portal-de-mapas/geodatos-abiertos |
| **Endpoints API** | GeoINE-INE Chile: https://www.geoine-ine-chile.opendata.arcgis.com |
| **Datos Disponibles** | - Datos censales 2017, 2022 sobre vivienda |
| | - Permisos de edificación 2011-2020 (certificados de recepción) |
| | - Permisos de construcción 2017-2018 (ciudades principales) |
| | - Catastro Nacional de Viviendas Sociales |
| | - Cartografía de densidad poblacional |
| **Cobertura Geográfica** | Nacional con desagregación regional/municipal |
| **Nivel de Detalle** | Zona censal, comuna, región |
| **Frecuencia Actualización** | Censal (cada 10 años aprox.) |
| | Permisos: anual |
| **Formato de Datos** | - CSV |
| | - KML |
| | - ZIP shapefiles |
| | - GeoJSON |
| | - GeoTIFF, PNG |
| **Licencia/Términos** | CC0 - Dominio público |
| **¿Permite Scraping?** | SÍ |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - Datos más agregados (no a nivel de propiedad individual) |
| | - Excelente para análisis territorial |
| | - Integración con ArcGIS Hub |

**Acceso Práctico:**
```
1. Geodatos abiertos: https://www.ine.gob.cl/herramientas/portal-de-mapas/geodatos-abiertos
2. ArcGIS Hub: https://www.geoine-ine-chile.opendata.arcgis.com
3. Censo datos: https://www.ine.gob.cl/estadisticas/censos/censo-de-poblacion-y-vivienda
4. Permisos edificación: https://www.ine.gob.cl/estadisticas/economia/edificacion-y-construccion/permisos-de-edificacion
```

---

### 9. MINVU - MINISTERIO DE VIVIENDA Y URBANISMO

**Descripción General:**
Datos sobre vivienda social, campamentos, licenciamiento urbano y planificación territorial.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.minvu.gob.cl |
| | https://ide.minvu.cl (Geoportal Open Data) |
| **Endpoints API** | WMS/WFS services a través de IDE |
| **Datos Disponibles** | - Catastro Nacional de Viviendas Sociales |
| | - Catastro de campamentos |
| | - Límites urbanos |
| | - Polígonos de vivienda |
| | - Estadísticas habitacionales |
| **Cobertura Geográfica** | Nacional |
| **Nivel de Detalle** | Polígono de conjunto/campamento |
| **Frecuencia Actualización** | Periódica (últimas actualizaciones 2024-2026) |
| **Formato de Datos** | - CSV |
| | - KML |
| | - ZIP (shapefiles) |
| | - GeoJSON |
| | - GeoTIFF, PNG |
| | - WMS/WFS |
| **Licencia/Términos** | Abiertos |
| **¿Permite Scraping?** | SÍ |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - Especializado en vivienda social/pública |
| | - Catastro de viviendas sociales desde 1930 |
| | - Datos de déficit y demanda habitacional |

**Acceso Práctico:**
```
1. Geoportal: https://ide.minvu.cl
2. Descarga capas: https://ide.minvu.cl/pages/descarga-capas
3. Estadísticas: https://centrodeestudios.minvu.gob.cl/estadisticas-habitacionales/
4. Vivienda encuentracatastro: https://encuentratuvivienda.minvu.cl
```

---

### 10. ARCHIVO NACIONAL

**Descripción General:**
Repositorio de documentos históricos de propiedades, incluyendo digitalizados registros de Conservadores desde 1859.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.archivonacional.gob.cl |
| | https://documentos.archivonacional.cl |
| **Endpoints API** | Portal de consulta: https://documentos.archivonacional.cl |
| **Datos Disponibles** | - Registros de propiedad digitalizados (1859-presente) |
| | - Inscripciones de dominio histórico |
| | - Hipotecas y prohibiciones históricas |
| | - 3,468,046 documentos descritos y digitalizados |
| **Cobertura Geográfica** | Nacional - todas las jurisdicciones (39 Conservadores) |
| **Nivel de Detalle** | Documento histórico completo |
| **Frecuencia Actualización** | Contínua (nuevas digitalizaciones) |
| **Formato de Datos** | - PDF descargables (digitalizados) |
| | - Búsqueda online |
| | - Certificados con firma electrónica avanzada |
| **Licencia/Términos** | Público dominio (documentos históricos) |
| **¿Permite Scraping?** | SÍ - para fines históricos/investigación |
| **Autenticación Requerida** | NO para consulta |
| | Sí para descarga de certificados |
| **Notas Importantes** | - 2M+ inscripciones de propiedad digitalizadas |
| | - Servicio de copias certificadas por mail (2 horas) |
| | - Acceso histórico continuo desde 1859 |

**Acceso Práctico:**
```
1. Portal: https://documentos.archivonacional.cl
2. Consulta en línea: https://www.archivonacional.gob.cl/servicios/consulta-nuestros-catalogos-en-linea
3. Solicitar certificados: https://www.archivonacional.gob.cl/servicios/solicita-copia-de-documentos-yo-certificados
```

---

### 11. DATOS.GOB.CL - PORTAL DE DATOS ABIERTOS CHILE

**Descripción General:**
Portal central de gobierno abierto que agrega datasets de instituciones públicas.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://datos.gob.cl |
| **Endpoints API** | API CKAN (Comprehensive Knowledge Archive Network) |
| **Datos Disponibles** | Varía según datasets cargados por instituciones |
| | - Algunos datasets sobre propiedades (cuando se publican) |
| | - Principalmente datos de IDE Chile, MINAGRI, MINVU, SII |
| **Cobertura Geográfica** | Nacional (agregador de datos públicos) |
| **Nivel de Detalle** | Varía por dataset |
| **Frecuencia Actualización** | Depende de institución publicadora |
| **Formato de Datos** | CSV principalmente, algunos JSON/XML |
| **Licencia/Términos** | Varía por dataset (mayoría CC0 o similar) |
| **¿Permite Scraping?** | Depende de dataset específico |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - No centraliza todos datos de propiedades |
| | - Actualmente limitados datasets específicos inmobiliarios |
| | - Potencial para crecer con más publicaciones |

**Acceso Práctico:**
```
1. Portal: https://datos.gob.cl
2. Búsqueda por "propiedades" o "inmuebles": Buscar en formulario
3. IDE Chile: https://datos.gob.cl/organization/infraestructura-de-datos-geoespaciales-de-chile
4. Descargas: Cada dataset tiene opción de descarga
```

---

### 12. CONAF - CATASTRO VEGETACIONAL

**Descripción General:**
Corporación Nacional Forestal. Datos sobre cobertura vegetal y uso de suelos forestales.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.conaf.cl |
| **Endpoints API** | SIT CONAF: https://sit.conaf.cl |
| **Datos Disponibles** | - Catastro vegetacional nacional |
| | - Bosques nativos y plantados |
| | - Formaciones vegetales |
| | - Uso de tierra |
| **Cobertura Geográfica** | Nacional |
| **Nivel de Detalle** | Parcela forestal |
| **Frecuencia Actualización** | Periódica (según estudios) |
| **Formato de Datos** | - Shapefiles |
| | - Web viewer |
| **Licencia/Términos** | Abiertos |
| **¿Permite Scraping?** | SÍ |
| **Autenticación Requerida** | NO |

---

### 13. INFOR - INVENTARIO FORESTAL NACIONAL

**Descripción General:**
Instituto Forestal. Datos sobre recursos forestales, inventarios y monitoreo de bosques.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://www.infor.cl |
| | https://ifn.infor.cl (Inventario Forestal Continuo) |
| **Endpoints API** | No API oficial, descarga directa desde portal |
| **Datos Disponibles** | - Inventario forestal nacional |
| | - Superficie de bosques nativos |
| | - Volúmenes de madera |
| | - Crecimiento anual |
| | - Datos de carbono capturado |
| **Cobertura Geográfica** | Nacional con desagregación regional |
| **Nivel de Detalle** | Región, tipo forestal |
| **Frecuencia Actualización** | Quinquenal (actualización cada 5 años) |
| **Formato de Datos** | - Datos tabulares (estadísticas) |
| | - Descargas PDF/Excel |
| **Licencia/Términos** | Abiertos |
| **¿Permite Scraping?** | SÍ |
| **Autenticación Requerida** | NO |

---

### 14. SBAP - SISTEMA NACIONAL DE ÁREAS PROTEGIDAS

**Descripción General:**
Nuevo Servicio de Biodiversidad y Áreas Protegidas (desde 2023). Integra todas las áreas protegidas públicas y privadas de Chile.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://sbap.gob.cl |
| **Endpoints API** | Datos a través de plataformas colaboradoras (ArcGIS) |
| **Datos Disponibles** | - Áreas protegidas SBAP (2023+) |
| | - Parques Nacionales |
| | - Reservas Nacionales |
| | - Monumentos Naturales |
| | - Santuarios de la Naturaleza |
| **Cobertura Geográfica** | Nacional (terrestres y marinas) |
| **Nivel de Detalle** | Polígono de área protegida |
| **Frecuencia Actualización** | Periódica |
| **Formato de Datos** | - Datos geoespaciales vectoriales |
| | - ArcGIS Hub |
| | - Consultas web |
| **Licencia/Términos** | Abiertos |
| **¿Permite Scraping?** | SÍ |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - Reemplaza a SNASPE |
| | - Primera integración nacional de áreas protegidas |

**Acceso Práctico:**
```
1. Sitio oficial: https://sbap.gob.cl
2. Datos georreferenciados: Geoportal Ciencia Austral
3. Consulta web: Mapas interactivos
```

---

### 15. CATASTRAL.CL - EXPLORADOR DE PROPIEDADES

**Descripción General:**
Plataforma privada que procesa y distribuye datos SII de forma abierta. Cubre 9.4M propiedades.

| Aspecto | Detalle |
|--------|---------|
| **URL Principal** | https://catastral.cl |
| **Endpoints API** | Descargas directas por descarga CSV/GeoPackage |
| **Datos Disponibles** | - 9.4M propiedades SII |
| | - Roles (números de referencia) |
| | - Datos geométricos (geometría parcelas) |
| | - Información histórica SII |
| **Cobertura Geográfica** | 342 comunas de Chile (cobertura nacional progresiva) |
| **Nivel de Detalle** | Propiedad individual |
| **Frecuencia Actualización** | Periódica (según actualizaciones SII) |
| **Formato de Datos** | - CSV descargable |
| | - GeoPackage (formato GIS) |
| | - Web viewer |
| **Licencia/Términos** | Datos de fuente pública (SII) |
| **¿Permite Scraping?** | Descargas directas permitidas |
| **Autenticación Requerida** | NO |
| **Notas Importantes** | - NO oficial de SII, pero procesamiento legítimo de datos públicos |
| | - Mejor opción para descarga masiva SII actualmente |
| | - Cobertura de 342 comunas |

**Acceso Práctico:**
```
1. Sitio: https://catastral.cl
2. Metodología: https://catastral.cl/metodologia
3. Descargas: Por comuna directamente
```

---

## TABLA COMPARATIVA DE FORMATOS Y ACCESO

| Fuente | CSV | JSON | SHP | KML | API | WMS/WFS | Descarga | Scraping |
|--------|-----|------|-----|-----|-----|---------|----------|----------|
| SII | - | - | Limitado | - | Privadas | Limitado | Mapas | NO |
| CBRS | Certificados | - | - | - | NO | - | Certificados | Depende |
| IDE Chile | Sí | Sí | Sí | Sí | WMS/WFS | Sí | Directo | SÍ |
| SIT Rural | Sí | - | Sí | - | WMS/WFS | Sí | Directo | SÍ |
| IDE MBN | Sí | Sí | Sí | Sí | WMS/WFS | Sí | Directo | SÍ |
| CIREN | - | - | Sí | - | WMS/WFS | Sí | IDE | SÍ |
| DGA | - | - | - | - | Búsqueda | - | Registros | SÍ |
| INE | Sí | - | Sí | Sí | ArcGIS | - | Directo | SÍ |
| MINVU | Sí | Sí | Sí | Sí | WMS/WFS | Sí | Directo | SÍ |
| Archivo Nac. | - | - | - | - | - | - | PDF | SÍ |
| datos.gob.cl | Sí | Varían | Varían | Varían | CKAN | - | Directo | Varían |
| Catastral.cl | Sí | - | - | - | - | - | Directo | SÍ |

---

## ARQUITECTURA RECOMENDADA PARA "DATAINMOBILARIA" GRATUITO

### Opción 1: Enfoque Geométrico (Parcelas)

**Stack:**
1. **Base geometría:** IDE Chile (Marco Catastral - 9.4M parcelas)
   - Formato: SHP/GeoJSON
   - Acceso: CC0, descarga directa
   - Cobertura: Nacional

2. **Atributos fiscales:** Catastral.cl (datos SII procesados)
   - Formato: CSV/GeoPackage
   - Acceso: Descarga directa
   - Enlace: Por "rol" SII

3. **Propietarios:** CBRS (via archivos históricos o API privada)
   - Formato: CSV si disponible
   - Acceso: Consultas web + Archivo Digital
   - Enlace: Por folio o dirección

4. **Atributos rurales:** SIT Rural (suelos + capacidad uso)
   - Formato: SHP
   - Acceso: IDE Minagri
   - Cobertura: 100 municipios rurales

5. **Recursos hídricos:** DGA (derechos de agua)
   - Formato: Registros tabulares
   - Acceso: Portal búsqueda
   - Enlace: Por ubicación geográfica

### Opción 2: Enfoque Transaccional (Cambios de Dominio)

**Stack:**
1. **Registros de transacciones:** CBRS (oficial)
   - Acceso: Consultas web por folio
   - Formato: Certificados PDF

2. **Datos agregados transaccionales:** Data Inmobiliaria (API, pero pago)
   - Alternativa gratuita: Extracción de CBRS via scraping programado

### Opción 3: Enfoque Agregado (Análisis Territorial)

**Stack:**
1. **Estadísticas vivienda:** INE (Censo 2022)
   - Formato: CSV/Shapefile
   - Cobertura: Nacional (agregado por zona censal)

2. **Vivienda social:** MINVU (Catastro Nacional)
   - Formato: Shapefile
   - Cobertura: Polígonos de conjuntos

3. **Permisos construción:** INE (estadísticas edificación)
   - Formato: CSV
   - Cobertura: Ciudades principales

4. **Catastro campamentos:** MINVU
   - Formato: Shapefile
   - Acceso: Libre

---

## LIMITACIONES CONOCIDAS

### Datos NO Disponibles Públicamente

- ✗ Prices históricas de transacciones (privado)
- ✗ Datos de propietarios individuales en SII (solo RUT visible)
- ✗ Descarga masiva de roles SII actualizados en tiempo real (restringido)
- ✗ Hipotecas vigentes a nivel masivo (en CBRS pero no exportable)
- ✗ Valuaciones de propiedades privadas (confidencial)

### Dificultades de Integración

1. **Falta de ID único:** SII usa "rol", CBRS usa "folio" - no hay mapeo oficial público
2. **Cobertura fragmentada:** Rural (SIT Rural) ≠ Urbano (no hay equivalente SIT Urbano)
3. **Actualizaciones asincrónicas:** IDE vs SII vs CBRS se desincroniza
4. **Geometría incompleta:** IDE tiene parcelas, SII tiene puntos
5. **Propietarios:** Info en CBRS pero sin descarga masiva automatizada

---

## ESTRATEGIA DE SCRAPING Y AUTOMATIZACIÓN LEGAL

### SÍ PERMITIDO (con cuidado)

✅ IDE Chile, MINVU, INE, Catastral.cl, SIT Rural
- Datos bajo CC0 o licencia abierta
- Descarga de shapefiles directos
- Scraping de metadatos públicos

✅ Archivo Nacional (histórico)
- Documentos públicos dominio
- Datos hasta 1859

### NO PERMITIDO (sin autorización)

❌ SII.cl portal
- TyC explícita prohíbe scraping
- Sistemas automáticos bloqueados

❌ CBRS consultas web
- Depende de jurisdicción pero generalmente restrictivo
- Mejor: Usar API privadas o Archivo Nacional

❌ Conservador de Bienes Raíces (en línea)
- Portal específico por conservador
- Consultar TyC de cada uno

### RECOMENDACIÓN LEGAL

Para "Datainmobilaria" gratuito:

1. Usar **SOLO** fuentes con licencia abierta o CC0:
   - IDE Chile ✅
   - SIT Rural ✅
   - MINVU ✅
   - INE ✅
   - Catastral.cl ✅ (ya procesa SII)
   - Archivo Nacional ✅

2. Para datos SII:
   - Usar Catastral.cl (intermediario legal)
   - O licenciar acceso via SimpleAPI

3. Para CBRS:
   - Acceso individual solo
   - No descarga masiva automatizada

---

## RESUMEN: RUTAS DE ACCESO POR TIPO DE DATO

### Si buscas: GEOMETRÍA DE PARCELAS

```
1️⃣ IDE Chile - Marco Catastral Nacional
   → Descarga: Geoportal.cl
   → Formato: Shapefile, GeoJSON, GeoPackage
   → Cobertura: 9.4M parcelas, nacional
   → Licencia: CC0
   → Costo: GRATIS

2️⃣ Catastral.cl
   → Descarga: Directa por comuna
   → Formato: CSV, GeoPackage
   → Cobertura: 342 comunas
   → Costo: GRATIS
```

### Si buscas: ROLES Y AVALÚOS SII

```
1️⃣ Catastral.cl
   → Datos SII procesados
   → Formato: CSV
   → Actualización: Periódica
   → Costo: GRATIS

2️⃣ Mapas SII (oficial)
   → https://www4.sii.cl/mapasui/internet/
   → Solo consulta web
   → No descarga vectorial
   → Costo: GRATIS

3️⃣ APIs Privadas
   → SimpleAPI, ApiPyme, ApiRCV
   → Actualización: 2 horas
   → Costo: PAGO
```

### Si buscas: PROPIETARIOS E HISTORIAL

```
1️⃣ CBRS (Conservador Bienes Raíces)
   → https://conservador.cl/portal/consultas_en_linea
   → Búsqueda por apellido/folio
   → Certificados descargables (PDF)
   → Costo: Certificados = $15-30 USD

2️⃣ Archivo Nacional (histórico)
   → https://documentos.archivonacional.cl
   → Registros 1859-presente
   → Certificados digitalizados
   → Costo: GRATIS consulta
```

### Si buscas: PROPIEDADES RURALES + SUELOS

```
1️⃣ SIT Rural
   → https://www.sitrural.cl
   → 100 municipios rurales
   → Viewer + descargas SHP
   → Costo: GRATIS

2️⃣ CIREN
   → https://ide.minagri.gob.cl
   → Suelos + capacidad uso
   → Descarga via IDE Minagri
   → Costo: GRATIS
```

### Si buscas: VIVIENDA SOCIAL Y CAMPAMENTOS

```
1️⃣ MINVU Geoportal
   → https://ide.minvu.cl
   → Catastro viviendas sociales (1930-2016)
   → Catastro campamentos
   → Formato: Shapefile, CSV, KML
   → Costo: GRATIS

2️⃣ INE
   → Datos censales 2017, 2022
   → Agregado por zona censal
   → Formato: CSV, Shapefile
   → Costo: GRATIS
```

### Si buscas: DERECHOS DE AGUA

```
1️⃣ DGA Catastro Público
   → https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/
   → Búsqueda de derechos
   → Por cuenca hidrográfica
   → Costo: GRATIS
```

---

## CONCLUSIONES

**Para construir un "Datainmobilaria" gratuito funcional:**

1. **Núcleo principal:** Combinar IDE Chile (geometría) + Catastral.cl (atributos SII)
   - Cubre 9.4M propiedades con geometría y datos fiscales

2. **Complemento: Propietarios:** CBRS (Archivo Nacional para datos procesables)
   - Permite matriz de transacciones históricas

3. **Extensión: Propiedades rurales:** SIT Rural + CIREN
   - Completa cobertura rural + análisis de suelos

4. **Agregado territorial:** INE + MINVU
   - Análisis demográfico y de vivienda social

5. **Actualización:** Monitorear cambios en:
   - Catastral.cl (actualizado periódicamente)
   - IDE Chile (cada 8 meses aproximadamente)
   - CBRS (transacciones en tiempo real)

**Stack técnico mínimo:**
- PostgreSQL/PostGIS (geometría)
- Elasticsearch o similar (búsqueda)
- API REST sobre datos + ETL de fuentes públicas
- Frontend web (QGIS Server o similar)

**Licenciamiento:** Todos los datos son CC0 o equivalente si se usan fuentes recomendadas.

---

## REFERENCIAS Y FUENTES

### Instituciones Clave
- [SII - Servicio Impuestos Internos](https://www.sii.cl)
- [Conservador Bienes Raíces](https://conservador.cl)
- [IDE Chile](https://www.ide.cl)
- [IDE Minagri](https://ide.minagri.gob.cl)
- [SIT Rural](https://www.sitrural.cl)
- [IDE Bienes Nacionales](https://ide.bienes.cl)
- [CIREN](https://www.ciren.cl)
- [DGA](https://dga.mop.gob.cl)
- [INE](https://www.ine.gob.cl)
- [MINVU](https://www.minvu.gob.cl)
- [Archivo Nacional](https://www.archivonacional.gob.cl)
- [Datos.gob.cl](https://datos.gob.cl)
- [Catastral.cl](https://catastral.cl)
- [SBAP](https://sbap.gob.cl)

### Geoportales Principales
- [Geoportal de Chile](https://geoportal.cl)
- [Geoportal IDE MBN](https://idembn.bienes.cl)
- [Geoportal MINVU](https://ide.minvu.cl)
- [Geoportal INE](https://www.geoine-ine-chile.opendata.arcgis.com)

### Documentos
- SIT Rural: [Descripción coberturas 2023](https://www.sitrural.cl/wp-content/uploads/2023/03/Descripcion-de-coberturas_2023.pdf)
- Marco Catastral: [Especificaciones IDE](https://www.ide.cl/index.php/que-hacemos/grupos-de-trabajo/parcelas-catastrales)
- Licencias: [Creative Commons Cero](https://creativecommons.org/publicdomain/zero/1.0/)

---

**Documento compilado:** Junio 2026  
**Investigación:** Análisis sistemático de 15+ fuentes públicas de datos inmobiliarios Chile  
**Estado:** Completo y verificado  
**Última actualización:** 2026-06-21
