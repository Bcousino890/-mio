#!/usr/bin/env node
/**
 * Ejemplos prácticos de integración con fuentes NO-SII de datos inmobiliarios en Chile.
 * Cubre: IDE Chile (WFS), MBN (REST), datos.gob.cl (CKAN).
 *
 * Requisitos:
 *   npm install axios xml2js lodash moment
 *
 * Autor: Investigación Casafari MIO
 * Fecha: 21 de Junio 2026
 */

const axios = require('axios');
const xml2js = require('xml2js');
const _ = require('lodash');

// ============================================================================
// EJEMPLO 1: IDE CHILE - Consumir WFS para obtener predios
// ============================================================================

class IDEChileClient {
  constructor() {
    this.baseWFS = 'https://www.geoportal.cl/geoserver/wfs';
    this.timeout = 60000;
    this.headers = {
      'User-Agent': 'CasafariMIO/1.0 (Node.js axios)',
      'Accept': 'application/json'
    };
    this.axiosInstance = axios.create({
      timeout: this.timeout,
      headers: this.headers
    });
  }

  /**
   * Obtener predios dentro de un bounding box vía WFS GetFeature
   * @param {number} minx - Longitud mínima (oeste)
   * @param {number} miny - Latitud mínima (sur)
   * @param {number} maxx - Longitud máxima (este)
   * @param {number} maxy - Latitud máxima (norte)
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Array>} Array de features GeoJSON
   */
  async getPrediosByBbox(minx, miny, maxx, maxy, options = {}) {
    const {
      layer = 'geoportal:predios_catastro',
      limit = 1000,
      outputFormat = 'application/json'
    } = options;

    console.log(`[IDE Chile] Descargando predios del bbox [${minx}, ${miny}, ${maxx}, ${maxy}]...`);

    const params = {
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeName: layer,
      outputFormat,
      bbox: `${minx},${miny},${maxx},${maxy},EPSG:4326`,
      srsName: 'EPSG:4326',
      count: limit
    };

    try {
      const response = await this.axiosInstance.get(this.baseWFS, { params });
      const data = response.data;

      if (!data.features || data.features.length === 0) {
        console.warn('[IDE Chile] No se encontraron predios en la región');
        return [];
      }

      console.log(`[IDE Chile] ✓ Obtenidos ${data.features.length} predios`);

      // Normalizar features
      return data.features.map(feature => this._normalizeFeature(feature));

    } catch (error) {
      console.error(`[IDE Chile] Error en WFS GetFeature: ${error.message}`);
      throw error;
    }
  }

  /**
   * Buscar predios por dirección usando CQL_FILTER
   * @param {string} direccion - Parte de la dirección a buscar
   * @param {string} comuna - Comuna específica
   * @returns {Promise<Array>} Array de features
   */
  async getPrediosByAddress(direccion, comuna) {
    console.log(`[IDE Chile] Buscando: "${direccion}" en ${comuna}...`);

    const cqlFilter = `DIRECCION ILIKE '%${direccion}%' AND COMUNA = '${comuna}'`;

    const params = {
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeName: 'geoportal:predios_catastro',
      outputFormat: 'application/json',
      CQL_FILTER: cqlFilter,
      srsName: 'EPSG:4326',
      count: 100
    };

    try {
      const response = await this.axiosInstance.get(this.baseWFS, { params });
      console.log(`[IDE Chile] ✓ Encontrados ${response.data.features.length} predios`);
      return response.data.features.map(f => this._normalizeFeature(f));
    } catch (error) {
      console.error(`[IDE Chile] Error en búsqueda: ${error.message}`);
      return [];
    }
  }

  /**
   * Listar capas disponibles en el servidor WFS
   * @returns {Promise<Array>} Array de capas {name, title}
   */
  async listAvailableLayers() {
    console.log('[IDE Chile] Obteniendo capabilities...');

    const params = {
      service: 'WFS',
      version: '2.0.0',
      request: 'GetCapabilities'
    };

    try {
      const response = await this.axiosInstance.get(this.baseWFS, { params });

      // Parsear XML
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(response.data);

      const featureTypes = result.WFS_Capabilities?.FeatureTypeList?.[0]?.FeatureType || [];
      const layers = featureTypes.map(ft => ({
        name: ft.Name?.[0],
        title: ft.Title?.[0] || ft.Name?.[0],
        srs: ft.DefaultSRS?.[0] || 'EPSG:4326'
      }));

      console.log(`[IDE Chile] ✓ Encontradas ${layers.length} capas`);
      return layers;

    } catch (error) {
      console.error(`[IDE Chile] Error obteniendo capabilities: ${error.message}`);
      return [];
    }
  }

  /**
   * Normalizar propiedades de un predio
   * @private
   */
  _normalizeFeature(feature) {
    const props = feature.properties || {};

    return {
      ...feature,
      properties: {
        ...props,
        rol: props.ROL?.trim().toUpperCase() || null,
        destino: props.DESTINO?.trim() || null,
        superficie: parseFloat(props.SUPERFICIE) || null,
        comuna: props.COMUNA?.trim() || null,
        region: props.REGION?.trim() || null,
        direccion: props.DIRECCION?.trim() || null
      }
    };
  }
}


// ============================================================================
// EJEMPLO 2: DATOS.GOB.CL - Acceso CKAN API para buscar datasets
// ============================================================================

class DatosGobClClient {
  constructor(baseUrl = 'https://datos.gob.cl') {
    this.baseUrl = baseUrl;
    this.apiUrl = `${baseUrl}/api/action`;
    this.timeout = 60000;
    this.headers = {
      'User-Agent': 'CasafariMIO/1.0 (CKAN Client)',
      'Accept': 'application/json'
    };
    this.axiosInstance = axios.create({
      timeout: this.timeout,
      headers: this.headers
    });
  }

  /**
   * Listar datasets de una organización
   * @param {string} orgId - ID de la organización
   * @returns {Promise<Array>} Array de datasets
   */
  async listOrganizationDatasets(orgId) {
    console.log(`[datos.gob.cl] Listando datasets de: ${orgId}...`);

    try {
      const response = await this.axiosInstance.get(`${this.apiUrl}/organization_show`, {
        params: {
          id: orgId,
          include_datasets: true
        }
      });

      if (!response.data.success) {
        console.error('[datos.gob.cl] Respuesta no exitosa');
        return [];
      }

      const datasets = response.data.result?.packages || [];
      console.log(`[datos.gob.cl] ✓ Encontrados ${datasets.length} datasets`);

      return datasets;

    } catch (error) {
      console.error(`[datos.gob.cl] Error: ${error.message}`);
      return [];
    }
  }

  /**
   * Buscar datasets por palabra clave
   * @param {string} query - Término de búsqueda
   * @returns {Promise<Array>} Array de datasets
   */
  async searchDatasets(query) {
    console.log(`[datos.gob.cl] Buscando: "${query}"...`);

    try {
      const response = await this.axiosInstance.get(`${this.apiUrl}/package_search`, {
        params: {
          q: query,
          rows: 50
        }
      });

      if (!response.data.success) {
        return [];
      }

      const datasets = response.data.result?.results || [];
      console.log(`[datos.gob.cl] ✓ Encontrados ${datasets.length} datasets`);

      return datasets;

    } catch (error) {
      console.error(`[datos.gob.cl] Error en búsqueda: ${error.message}`);
      return [];
    }
  }

  /**
   * Obtener detalles de un recurso
   * @param {string} resourceId - ID del recurso
   * @returns {Promise<Object>} Detalles del recurso
   */
  async getResourceDetails(resourceId) {
    console.log(`[datos.gob.cl] Obteniendo detalles del recurso: ${resourceId}...`);

    try {
      const response = await this.axiosInstance.get(`${this.apiUrl}/resource_show`, {
        params: { id: resourceId }
      });

      if (!response.data.success) {
        return null;
      }

      return response.data.result;

    } catch (error) {
      console.error(`[datos.gob.cl] Error: ${error.message}`);
      return null;
    }
  }

  /**
   * Ejecutar query SQL en DataStore
   * @param {string} sql - Query SQL (resource IDs con guiones deben ir entre comillas)
   * @returns {Promise<Array>} Array de registros
   */
  async queryDatastoreSql(sql) {
    console.log('[datos.gob.cl] Ejecutando SQL query...');

    try {
      const response = await this.axiosInstance.get(`${this.apiUrl}/datastore_search_sql`, {
        params: { sql }
      });

      if (!response.data.success) {
        console.error('[datos.gob.cl] Query no exitosa');
        return [];
      }

      const records = response.data.result?.records || [];
      console.log(`[datos.gob.cl] ✓ Query retornó ${records.length} registros`);

      return records;

    } catch (error) {
      console.error(`[datos.gob.cl] Error en SQL: ${error.message}`);
      return [];
    }
  }

  /**
   * Buscar en DataStore usando filtros JSON
   * @param {string} resourceId - ID del recurso
   * @param {Object} filters - Filtros {campo: valor}
   * @param {number} limit - Máximo de registros
   * @param {number} offset - Offset para paginación
   * @returns {Promise<Array>} Array de registros
   */
  async queryDatastoreJson(resourceId, filters = {}, limit = 100, offset = 0) {
    console.log(`[datos.gob.cl] Buscando en recurso ${resourceId}...`);

    try {
      const params = {
        resource_id: resourceId,
        limit,
        offset
      };

      if (Object.keys(filters).length > 0) {
        params.filters = JSON.stringify(filters);
      }

      const response = await this.axiosInstance.get(`${this.apiUrl}/datastore_search`, {
        params
      });

      if (!response.data.success) {
        return [];
      }

      const records = response.data.result?.records || [];
      console.log(`[datos.gob.cl] ✓ Encontrados ${records.length} registros`);

      return records;

    } catch (error) {
      console.error(`[datos.gob.cl] Error: ${error.message}`);
      return [];
    }
  }

  /**
   * Descargar recurso en formato CSV
   * @param {string} resourceUrl - URL de descarga del recurso
   * @returns {Promise<string>} Contenido CSV
   */
  async downloadResourceCsv(resourceUrl) {
    console.log(`[datos.gob.cl] Descargando CSV...`);

    try {
      const response = await axios.get(resourceUrl, { timeout: this.timeout });
      console.log('[datos.gob.cl] ✓ CSV descargado');
      return response.data;

    } catch (error) {
      console.error(`[datos.gob.cl] Error descargando CSV: ${error.message}`);
      return null;
    }
  }
}


// ============================================================================
// EJEMPLO 3: Integración unificada con deduplicación
// ============================================================================

class UnifiedCatastroClient {
  constructor() {
    this.ide = new IDEChileClient();
    this.dgc = new DatosGobClClient();
    this.unifiedData = [];
  }

  /**
   * Obtener predios de una región desde múltiples fuentes
   * @param {string} region - Nombre de la región
   * @param {string} comuna - Comuna opcional
   * @returns {Promise<Array>} Predios consolidados y deduplicados
   */
  async getPrediosByRegion(region, comuna = null) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Obteniendo predios de ${region}${comuna ? ` / ${comuna}` : ''}...`);
    console.log(`${'='.repeat(70)}`);

    try {
      const bbox = this._getRegionBbox(region);
      if (!bbox) {
        console.error(`Región no soportada: ${region}`);
        return [];
      }

      // Fuente 1: IDE Chile
      console.log('\nFase 1: Descargando desde IDE Chile...');
      const ideFeatures = await this.ide.getPrediosByBbox(...bbox, { limit: 500 });

      if (ideFeatures.length > 0) {
        ideFeatures.forEach(f => f.source = 'IDE-Chile');
        this.unifiedData.push(...ideFeatures);
      }

      // Fuente 2: datos.gob.cl (simulado)
      console.log('\nFase 2: Explorando datos.gob.cl...');
      const datasets = await this.dgc.listOrganizationDatasets(
        'infraestructura-de-datos-geoespaciales-de-chile'
      );

      console.log(`Encontrados ${datasets.length} datasets`);
      datasets.slice(0, 3).forEach(ds => {
        console.log(`  - ${ds.name}: ${ds.title}`);
      });

      // Deduplicar
      console.log('\nDeduplicando...');
      const deduplicatedData = this._deduplicateByRol(this.unifiedData);

      console.log(`Total después de deduplicación: ${deduplicatedData.length}`);

      if (comuna) {
        return deduplicatedData.filter(
          p => p.properties?.comuna?.toLowerCase() === comuna.toLowerCase()
        );
      }

      return deduplicatedData;

    } catch (error) {
      console.error(`Error consolidando datos: ${error.message}`);
      return [];
    }
  }

  /**
   * Deduplicar por ROL
   * @private
   */
  _deduplicateByRol(features) {
    const seen = new Set();
    return features.filter(feature => {
      const rol = feature.properties?.rol;
      if (rol && seen.has(rol)) {
        return false;
      }
      if (rol) seen.add(rol);
      return true;
    });
  }

  /**
   * Obtener bounding box aproximado de una región
   * @private
   */
  _getRegionBbox(region) {
    const bboxes = {
      'Metropolitana': [-70.8, -33.6, -70.4, -33.2],
      'Valparaíso': [-71.8, -32.95, -71.4, -32.7],
      'Biobío': [-73.0, -37.5, -72.2, -36.8],
      'Los Ríos': [-73.2, -39.5, -72.4, -39.0],
      'Araucanía': [-72.8, -38.9, -71.8, -37.8],
    };
    return bboxes[region];
  }

  /**
   * Exportar como GeoJSON
   * @param {string} outputFile - Archivo de salida
   */
  exportGeoJson(outputFile) {
    if (this.unifiedData.length === 0) {
      console.error('No hay datos para exportar');
      return;
    }

    const geojson = {
      type: 'FeatureCollection',
      features: this.unifiedData
    };

    const fs = require('fs');
    fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
    console.log(`✓ Exportado a ${outputFile}`);
  }

  /**
   * Exportar como CSV
   * @param {string} outputFile - Archivo de salida
   */
  exportCsv(outputFile) {
    if (this.unifiedData.length === 0) {
      console.error('No hay datos para exportar');
      return;
    }

    const records = this.unifiedData.map(f => f.properties);
    const headers = Array.from(
      new Set(records.flatMap(r => Object.keys(r)))
    );

    const rows = [
      headers.join(','),
      ...records.map(record =>
        headers.map(h => {
          const value = record[h];
          if (value === null || value === undefined) return '';
          if (typeof value === 'string' && value.includes(',')) {
            return `"${value}"`;
          }
          return value;
        }).join(',')
      )
    ];

    const fs = require('fs');
    fs.writeFileSync(outputFile, rows.join('\n'));
    console.log(`✓ Exportado a ${outputFile}`);
  }
}


// ============================================================================
// MAIN - Ejemplos de uso
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('Ejemplos de integración con fuentes NO-SII de Chile');
  console.log('='.repeat(70));

  // Ejemplo 1: IDE Chile
  console.log('\n[EJEMPLO 1] IDE Chile - Obtener capas disponibles');
  console.log('-'.repeat(70));
  try {
    const ide = new IDEChileClient();
    const layers = await ide.listAvailableLayers();
    console.log('\nCapas disponibles (primeras 5):');
    layers.slice(0, 5).forEach(layer => {
      console.log(`  ${layer.name}`);
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }

  // Ejemplo 2: datos.gob.cl
  console.log('\n[EJEMPLO 2] datos.gob.cl - Explorar datasets');
  console.log('-'.repeat(70));
  try {
    const dgc = new DatosGobClClient();
    const datasets = await dgc.listOrganizationDatasets(
      'infraestructura-de-datos-geoespaciales-de-chile'
    );
    console.log('\nDatasets encontrados:');
    datasets.slice(0, 5).forEach(ds => {
      console.log(`  ${ds.name}: ${ds.resources?.length || 0} recursos`);
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }

  // Ejemplo 3: Integración unificada (comentado - requiere datos reales)
  console.log('\n[EJEMPLO 3] Integración unificada');
  console.log('-'.repeat(70));
  console.log('(Comentado - requiere acceso real a datos)');
  console.log('Para ejecutar descomentar las líneas siguientes...');
  /*
  try {
    const unified = new UnifiedCatastroClient();
    const predios = await unified.getPrediosByRegion('Metropolitana', 'Santiago');
    console.log(`\nTotal de predios: ${predios.length}`);
    if (predios.length > 0) {
      unified.exportGeoJson('/tmp/predios.geojson');
      unified.exportCsv('/tmp/predios.csv');
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
  */

  console.log('\n' + '='.repeat(70));
  console.log('Ejemplos completados');
  console.log('='.repeat(70));
}

// Ejecutar si se invoca directamente
if (require.main === module) {
  main().catch(console.error);
}

// Exportar para uso como módulo
module.exports = {
  IDEChileClient,
  DatosGobClClient,
  UnifiedCatastroClient
};
