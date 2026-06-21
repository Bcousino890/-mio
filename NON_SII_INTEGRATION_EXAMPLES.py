#!/usr/bin/env python3
"""
Ejemplos prácticos de integración con fuentes NO-SII de datos inmobiliarios en Chile.
Cubre: IDE Chile (WFS), MBN (GeoJSON), datos.gob.cl (CKAN).

Requisitos:
    pip install geopandas folium requests ckanapi psycopg2-binary shapely pyproj pandas

Autor: Investigación Casafari MIO
Fecha: 21 de Junio 2026
"""

import requests
import json
import pandas as pd
import geopandas as gpd
from typing import List, Dict, Optional, Tuple
import time
from datetime import datetime
from shapely.geometry import box, Point
import logging

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================================================
# EJEMPLO 1: IDE CHILE - Descarga de predios vía WFS
# ============================================================================

class IDEChileIntegration:
    """
    Integración con IDE Chile para obtener datos catastrales vía WFS.

    Ejemplo de uso:
        ide = IDEChileIntegration()
        gdf = ide.get_predios_bbox(-70.8, -33.6, -70.4, -33.2)
        print(gdf[['ROL', 'DESTINO', 'SUPERFICIE']])
    """

    def __init__(self):
        self.base_wfs = "https://www.geoportal.cl/geoserver/wfs"
        self.timeout = 60
        self.headers = {
            'User-Agent': 'CasafariMIO/1.0 (Python Integration)',
            'Accept': 'application/json'
        }
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    def list_available_layers(self) -> List[Dict]:
        """
        Obtener lista de capas disponibles en el servidor WFS de IDE Chile.

        Returns:
            Lista de diccionarios con estructura: {name, title, bounds, srs}
        """
        logger.info("Obteniendo capabilities de IDE Chile...")

        params = {
            'service': 'WFS',
            'version': '2.0.0',
            'request': 'GetCapabilities'
        }

        try:
            response = self.session.get(
                self.base_wfs,
                params=params,
                timeout=self.timeout
            )
            response.raise_for_status()

            # Parsear XML
            from lxml import etree
            root = etree.fromstring(response.content)
            ns = {'wfs': 'http://www.opengis.net/wfs/2.0'}

            layers = []
            for feature_type in root.findall('.//wfs:FeatureType', ns):
                name_elem = feature_type.find('wfs:Name', ns)
                title_elem = feature_type.find('wfs:Title', ns)

                if name_elem is not None:
                    layers.append({
                        'name': name_elem.text,
                        'title': title_elem.text if title_elem is not None else name_elem.text
                    })

            logger.info(f"Encontradas {len(layers)} capas")
            return layers

        except Exception as e:
            logger.error(f"Error obteniendo capabilities: {e}")
            return []

    def get_predios_bbox(self, minx: float, miny: float, maxx: float, maxy: float,
                        layer: str = 'geoportal:predios_catastro',
                        limit: int = 1000) -> Optional[gpd.GeoDataFrame]:
        """
        Obtener predios dentro de un bounding box vía WFS GetFeature.

        Args:
            minx, miny, maxx, maxy: Coordenadas WGS84
            layer: Nombre de la capa
            limit: Máximo de registros por request

        Returns:
            GeoDataFrame con geometría y propiedades
        """
        logger.info(f"Descargando predios del bbox [{minx}, {miny}, {maxx}, {maxy}]...")

        params = {
            'service': 'WFS',
            'version': '2.0.0',
            'request': 'GetFeature',
            'typeName': layer,
            'outputFormat': 'application/json',
            'bbox': f'{minx},{miny},{maxx},{maxy},EPSG:4326',
            'srsName': 'EPSG:4326',
            'count': limit
        }

        try:
            response = self.session.get(
                self.base_wfs,
                params=params,
                timeout=self.timeout
            )
            response.raise_for_status()

            data = response.json()

            if not data.get('features'):
                logger.warning("No se encontraron predios en la región")
                return gpd.GeoDataFrame()

            # Crear GeoDataFrame desde GeoJSON
            gdf = gpd.GeoDataFrame.from_features(
                data['features'],
                crs='EPSG:4326'
            )

            logger.info(f"Obtenidos {len(gdf)} predios")

            # Normalizar campos
            self._normalize_predios(gdf)

            return gdf

        except requests.exceptions.Timeout:
            logger.error("Request WFS timeout - dataset muy grande")
            return None
        except Exception as e:
            logger.error(f"Error en WFS GetFeature: {e}")
            return None

    def get_predios_by_address(self, direccion: str, comuna: str) -> Optional[gpd.GeoDataFrame]:
        """
        Buscar predios por dirección usando CQL_FILTER.

        Args:
            direccion: Dirección o parte de ella
            comuna: Comuna donde buscar

        Returns:
            GeoDataFrame con resultados
        """
        logger.info(f"Buscando predios: {direccion}, {comuna}...")

        # Construir filtro CQL
        cql_filter = f"DIRECCION ILIKE '%{direccion}%' AND COMUNA = '{comuna}'"

        params = {
            'service': 'WFS',
            'version': '2.0.0',
            'request': 'GetFeature',
            'typeName': 'geoportal:predios_catastro',
            'outputFormat': 'application/json',
            'CQL_FILTER': cql_filter,
            'srsName': 'EPSG:4326',
            'count': 100
        }

        try:
            response = self.session.get(
                self.base_wfs,
                params=params,
                timeout=self.timeout
            )
            response.raise_for_status()

            data = response.json()
            gdf = gpd.GeoDataFrame.from_features(
                data['features'],
                crs='EPSG:4326'
            )

            self._normalize_predios(gdf)
            return gdf

        except Exception as e:
            logger.error(f"Error en búsqueda por dirección: {e}")
            return None

    def _normalize_predios(self, gdf: gpd.GeoDataFrame) -> None:
        """Normalizar campos de predios en-place"""
        # Normalizar ROL
        if 'ROL' in gdf.columns:
            gdf['ROL'] = gdf['ROL'].str.strip().str.upper()

        # Convertir SUPERFICIE a float
        if 'SUPERFICIE' in gdf.columns:
            gdf['SUPERFICIE'] = pd.to_numeric(gdf['SUPERFICIE'], errors='coerce')

        # Normalizar DESTINO
        if 'DESTINO' in gdf.columns:
            gdf['DESTINO'] = gdf['DESTINO'].str.strip().str.title()

        # Normalizar COMUNA
        if 'COMUNA' in gdf.columns:
            gdf['COMUNA'] = gdf['COMUNA'].str.strip().str.title()


# ============================================================================
# EJEMPLO 2: datos.gob.cl - Búsqueda y consulta SQL via CKAN
# ============================================================================

class DatosGobClIntegration:
    """
    Integración con datos.gob.cl para acceder a datasets vía API CKAN.

    Ejemplo de uso:
        dgc = DatosGobClIntegration()
        df = dgc.query_datastore_sql(
            'SELECT * FROM "resource-id" WHERE comuna = "Santiago" LIMIT 100'
        )
        print(df)
    """

    def __init__(self, base_url: str = "https://datos.gob.cl"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api/action"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'CasafariMIO/1.0 (CKAN Client)',
            'Accept': 'application/json'
        })
        self.timeout = 60

    def search_organization_datasets(self, org_id: str) -> List[Dict]:
        """
        Listar todos los datasets de una organización.

        Args:
            org_id: ID de la organización (ej: "infraestructura-de-datos-geoespaciales-de-chile")

        Returns:
            Lista de datasets
        """
        logger.info(f"Listando datasets de organización: {org_id}...")

        try:
            response = self.session.get(
                f"{self.api_url}/organization_show",
                params={
                    'id': org_id,
                    'include_datasets': True
                },
                timeout=self.timeout
            )
            response.raise_for_status()

            data = response.json()
            if data.get('success'):
                packages = data.get('result', {}).get('packages', [])
                logger.info(f"Encontrados {len(packages)} datasets")
                return packages

            return []
        except Exception as e:
            logger.error(f"Error en búsqueda de datasets: {e}")
            return []

    def get_resource_details(self, resource_id: str) -> Optional[Dict]:
        """Obtener metadatos de un recurso"""
        try:
            response = self.session.get(
                f"{self.api_url}/resource_show",
                params={'id': resource_id},
                timeout=self.timeout
            )
            response.raise_for_status()

            data = response.json()
            if data.get('success'):
                return data.get('result', {})

            return None
        except Exception as e:
            logger.error(f"Error obteniendo detalles de recurso: {e}")
            return None

    def query_datastore_sql(self, sql: str) -> Optional[pd.DataFrame]:
        """
        Ejecutar query SQL en DataStore de CKAN.

        Args:
            sql: Query SQL. Nota: resource IDs con guiones deben ir entre comillas
                 Ejemplo: SELECT * FROM "resource-id-with-dashes" WHERE campo = valor

        Returns:
            DataFrame con resultados
        """
        logger.info(f"Ejecutando SQL query...")

        try:
            response = self.session.get(
                f"{self.api_url}/datastore_search_sql",
                params={'sql': sql},
                timeout=self.timeout
            )
            response.raise_for_status()

            data = response.json()
            if data.get('success'):
                records = data.get('result', {}).get('records', [])
                if records:
                    df = pd.DataFrame(records)
                    logger.info(f"Query retornó {len(df)} registros")
                    return df
                else:
                    logger.info("Query retornó 0 registros")
                    return pd.DataFrame()

            return None
        except Exception as e:
            logger.error(f"Error en SQL query: {e}")
            return None

    def query_datastore_json(self, resource_id: str, filters: Dict = None,
                            limit: int = 100, offset: int = 0) -> Optional[pd.DataFrame]:
        """
        Búsqueda JSON en DataStore (sin SQL).

        Args:
            resource_id: ID del recurso
            filters: Diccionario de filtros {campo: valor}
            limit: Registros por página
            offset: Offset para paginación

        Returns:
            DataFrame con resultados
        """
        params = {
            'resource_id': resource_id,
            'limit': limit,
            'offset': offset
        }

        if filters:
            params['filters'] = json.dumps(filters)

        try:
            response = self.session.get(
                f"{self.api_url}/datastore_search",
                params=params,
                timeout=self.timeout
            )
            response.raise_for_status()

            data = response.json()
            if data.get('success'):
                records = data.get('result', {}).get('records', [])
                if records:
                    return pd.DataFrame(records)

            return pd.DataFrame()
        except Exception as e:
            logger.error(f"Error en búsqueda JSON: {e}")
            return None

    def download_dataset_csv(self, resource_url: str, output_file: str = None) -> Optional[pd.DataFrame]:
        """
        Descargar un recurso en formato CSV.

        Args:
            resource_url: URL de descarga del recurso
            output_file: Archivo de salida (opcional)

        Returns:
            DataFrame con los datos
        """
        logger.info(f"Descargando CSV desde {resource_url}...")

        try:
            response = self.session.get(resource_url, timeout=self.timeout, stream=True)
            response.raise_for_status()

            if output_file:
                with open(output_file, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                logger.info(f"Descargado a {output_file}")

            from io import StringIO
            df = pd.read_csv(StringIO(response.text))
            logger.info(f"CSV contiene {len(df)} registros")
            return df

        except Exception as e:
            logger.error(f"Error descargando CSV: {e}")
            return None


# ============================================================================
# EJEMPLO 3: Integración unificada + Deduplicación
# ============================================================================

class CatastroUnificado:
    """
    Combina datos de múltiples fuentes NO-SII con deduplicación y normalización.
    """

    def __init__(self):
        self.ide = IDEChileIntegration()
        self.dgc = DatosGobClIntegration()
        self.dataframe_unificado = None

    def obtener_predios_region(self, region: str, comuna: str = None) -> gpd.GeoDataFrame:
        """
        Obtener predios de una región combinando múltiples fuentes.

        Args:
            region: Nombre de la región
            comuna: Comuna opcional para filtrado adicional

        Returns:
            GeoDataFrame consolidado y deduplicado
        """
        logger.info(f"Obteniendo predios de {region} desde múltiples fuentes...")

        todos_predios = []

        # Fuente 1: IDE Chile
        logger.info("Fase 1: Descargando desde IDE Chile...")
        try:
            # Obtener bbox aproximado de la región
            bbox = self._get_region_bbox(region)
            if bbox:
                gdf_ide = self.ide.get_predios_bbox(*bbox)
                if gdf_ide is not None and not gdf_ide.empty:
                    gdf_ide['fuente'] = 'IDE-Chile'
                    todos_predios.append(gdf_ide)
                    logger.info(f"IDE Chile: {len(gdf_ide)} predios")
        except Exception as e:
            logger.warning(f"Error en IDE Chile: {e}")

        # Fuente 2: datos.gob.cl (si hay datos inmobiliarios disponibles)
        logger.info("Fase 2: Buscando en datos.gob.cl...")
        try:
            # Este ejemplo asumiría un dataset específico
            # En la práctica, buscar datasets de catastro en la organización IDE
            datasets = self.dgc.search_organization_datasets(
                'infraestructura-de-datos-geoespaciales-de-chile'
            )
            logger.info(f"Encontrados {len(datasets)} datasets en IDE organization")
            # Procesar datasets si contienen información catastral
        except Exception as e:
            logger.warning(f"Error en datos.gob.cl: {e}")

        # Consolidar
        if todos_predios:
            gdf_consolidado = pd.concat(todos_predios, ignore_index=True)
            logger.info(f"Total antes de deduplicación: {len(gdf_consolidado)}")

            # Deduplicar por ROL o coordenadas
            gdf_consolidado = self._deduplicar(gdf_consolidado)
            logger.info(f"Total después de deduplicación: {len(gdf_consolidado)}")

            # Filtrar por comuna si se especificó
            if comuna:
                gdf_consolidado = gdf_consolidado[
                    gdf_consolidado['COMUNA'].str.lower() == comuna.lower()
                ]
                logger.info(f"Predios en {comuna}: {len(gdf_consolidado)}")

            self.dataframe_unificado = gdf_consolidado
            return gdf_consolidado

        logger.warning("No se obtuvieron predios de ninguna fuente")
        return gpd.GeoDataFrame()

    def _deduplicar(self, gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        """
        Deduplicar predios por ROL y coordenadas con buffer.
        """
        if gdf.empty:
            return gdf

        # Deduplicar por ROL (columna principal)
        if 'ROL' in gdf.columns:
            gdf = gdf.drop_duplicates(subset=['ROL'], keep='first')

        # Deduplicar por proximidad espacial (buffer de 5m)
        if 'geometry' in gdf.columns:
            try:
                gdf = gdf[~gdf.geometry.is_empty]

                # Usar representante de cada cluster
                centers = gdf.geometry.centroid
                duplicados = centers.sindex.query_ball_point(
                    centers.values,
                    radius=0.0001  # ~10m en WGS84
                )

                keep_indices = []
                seen = set()

                for idx, cluster in enumerate(duplicados):
                    cluster_list = list(cluster)
                    cluster_sorted = sorted(cluster_list)

                    representative = cluster_sorted[0]
                    if representative not in seen:
                        keep_indices.append(representative)
                        for other_idx in cluster_sorted[1:]:
                            seen.add(other_idx)

                if keep_indices:
                    gdf = gdf.iloc[keep_indices].copy()

            except Exception as e:
                logger.warning(f"Error en deduplicación espacial: {e}")

        return gdf

    def _get_region_bbox(self, region: str) -> Optional[Tuple[float, float, float, float]]:
        """
        Obtener bounding box aproximado de una región.
        Estas son aproximaciones - en producción usar geometrías reales.
        """
        bboxes = {
            'Metropolitana': (-70.8, -33.6, -70.4, -33.2),
            'Valparaíso': (-71.8, -32.95, -71.4, -32.7),
            'Biobío': (-73.0, -37.5, -72.2, -36.8),
            'Los Ríos': (-73.2, -39.5, -72.4, -39.0),
            'Araucanía': (-72.8, -38.9, -71.8, -37.8),
        }
        return bboxes.get(region)

    def exportar_geojson(self, output_file: str) -> None:
        """Exportar dataframe unificado como GeoJSON"""
        if self.dataframe_unificado is None or self.dataframe_unificado.empty:
            logger.error("No hay datos para exportar")
            return

        self.dataframe_unificado.to_file(output_file, driver='GeoJSON')
        logger.info(f"Exportado a {output_file}")

    def exportar_csv(self, output_file: str) -> None:
        """Exportar como CSV (sin geometría)"""
        if self.dataframe_unificado is None or self.dataframe_unificado.empty:
            logger.error("No hay datos para exportar")
            return

        df = self.dataframe_unificado.copy()
        # Quitar columna geometría para CSV
        if 'geometry' in df.columns:
            df = df.drop(columns=['geometry'])

        df.to_csv(output_file, index=False)
        logger.info(f"Exportado a {output_file}")


# ============================================================================
# MAIN - Ejemplos de uso
# ============================================================================

if __name__ == "__main__":
    print("=" * 70)
    print("Ejemplos de integración con fuentes NO-SII de Chile")
    print("=" * 70)

    # Ejemplo 1: IDE Chile
    print("\n[EJEMPLO 1] Descargando predios desde IDE Chile...")
    print("-" * 70)
    try:
        ide = IDEChileIntegration()

        # Listar capas disponibles
        capas = ide.list_available_layers()
        print(f"Capas disponibles en IDE Chile ({len(capas)} total):")
        for capa in capas[:5]:
            print(f"  - {capa['name']}: {capa['title']}")

        # Obtener predios en área de prueba
        print("\nObteniendo predios en bbox [-70.6, -33.45, -70.55, -70.40]...")
        gdf = ide.get_predios_bbox(-70.6, -33.45, -70.55, -33.40, limit=100)

        if gdf is not None and not gdf.empty:
            print(f"✓ Obtenidos {len(gdf)} predios")
            print("\nPrimeros 3 registros:")
            cols_display = ['ROL', 'DESTINO', 'SUPERFICIE', 'COMUNA']
            cols_exist = [c for c in cols_display if c in gdf.columns]
            print(gdf[cols_exist].head(3).to_string())
        else:
            print("✗ No se obtuvieron predios (puede ser por bbox vacío)")

    except Exception as e:
        print(f"✗ Error: {e}")

    # Ejemplo 2: datos.gob.cl
    print("\n" + "=" * 70)
    print("[EJEMPLO 2] Explorando datasets en datos.gob.cl...")
    print("-" * 70)
    try:
        dgc = DatosGobClIntegration()

        # Listar datasets de IDE
        datasets = dgc.search_organization_datasets(
            'infraestructura-de-datos-geoespaciales-de-chile'
        )

        print(f"Datasets en IDE Chile organization ({len(datasets)} total):")
        for ds in datasets[:5]:
            print(f"  - {ds['name']}: {ds.get('title', 'Sin título')}")
            print(f"    Recursos: {len(ds.get('resources', []))}")

    except Exception as e:
        print(f"✗ Error: {e}")

    # Ejemplo 3: Integración unificada
    print("\n" + "=" * 70)
    print("[EJEMPLO 3] Integración unificada de múltiples fuentes...")
    print("-" * 70)
    try:
        catastro = CatastroUnificado()

        print("Descargando predios de Metropolitana...")
        gdf_unificado = catastro.obtener_predios_region('Metropolitana', 'Santiago')

        if not gdf_unificado.empty:
            print(f"✓ Total de predios consolidados: {len(gdf_unificado)}")

            if 'fuente' in gdf_unificado.columns:
                print("\nDistribución por fuente:")
                print(gdf_unificado['fuente'].value_counts())

            # Exportar
            print("\nExportando resultados...")
            catastro.exportar_geojson('/tmp/predios_consolidados.geojson')
            catastro.exportar_csv('/tmp/predios_consolidados.csv')

    except Exception as e:
        print(f"✗ Error: {e}")

    print("\n" + "=" * 70)
    print("Ejemplos completados")
    print("=" * 70)
