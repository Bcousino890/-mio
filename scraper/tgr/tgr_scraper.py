#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🚀 SCRAPER TGR — Certificado de Deuda de Contribuciones
Solo TGR por ahora (SII se integra en una fase posterior).

Esquema de salida calibrado contra el PDF real de ejemplo
(ROL 332-03621-131, Lo Barnechea — ver --test-fixture).

Uso:
    python3 tgr_scraper.py --test-fixture
    python3 tgr_scraper.py --input roles_input.csv --workers 4
    python3 tgr_scraper.py --retry-failed
    python3 tgr_scraper.py --reparse
"""

import argparse
import base64
import contextlib
import csv
import io
import logging
import os
import queue
import random
import re
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pdfplumber
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException,
    NoSuchElementException,
    StaleElementReferenceException,
    WebDriverException,
)

from comunas_config import COMUNAS_METROPOLITANA_ORDEN, orden_comuna

# ═════════════════════════════════════════════════════════════════════
# CONFIGURACIÓN — calibrado contra inspeccion/iframe_formulario.html
# y inspeccion/pagina_resultado_real.html (inspect_form.py)
# ═════════════════════════════════════════════════════════════════════

# La página pública (tgr.gob.cl) solo contiene un iframe; el formulario real
# vive en este dominio (www.tesoreria.cl), así que el scraper navega
# directamente ahí en vez de pasar por tgr.gob.cl + switch_to.frame.
URL_TRAMITE = "https://www.tesoreria.cl/CertDeudasRolCutAixWeb/Controller.jpf?RUT=0&DV=0&EMAIL="

REGION_METROPOLITANA_VALUE = "13"  # value del <option> "XIII [REGION METROPOLITANA DE SANTIAGO]"

SELECTORS = {
    "select_region": (By.ID, "region"),
    "select_comuna": (By.ID, "comuna"),
    "input_rol": (By.ID, "rol"),
    "input_subrol": (By.ID, "subRol"),
    "boton_buscar": (By.ID, "buscar"),
    # La página de resultado (con o sin deuda) siempre reemplaza el formulario
    # por un campo de e-mail para reenviar el certificado.
    "resultado_marcador": (By.ID, "mail"),
}

CHROME_BINARY = os.environ.get("CHROME_BINARY", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
CHROMEDRIVER_PATH = os.environ.get(
    "CHROMEDRIVER_PATH",
    "/root/.wdm/drivers/chromedriver/linux64/141.0.7390.37/chromedriver-linux64/chromedriver",
)

DB_PATH = Path("data/tgr_metropolitana.db")
EXPORT_DIR = Path("exports")
LOG_PATH = Path("scraper_tgr.log")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

# ═════════════════════════════════════════════════════════════════════
# LOGGING
# ═════════════════════════════════════════════════════════════════════

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(threadName)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler()],
)
logger = logging.getLogger("tgr_scraper")

# ═════════════════════════════════════════════════════════════════════
# MODELOS
# ═════════════════════════════════════════════════════════════════════

@dataclass
class DetalleCuota:
    tipo_deuda: str            # "No Vencida" | "Morosa" | "Acogidos Art 196-197"
    formulario: str = ""
    tipo: str = ""
    folio: str = ""
    fecha_vcto: str = ""
    deuda_neta: Optional[float] = None
    reajuste: Optional[float] = None
    interes: Optional[float] = None
    multa: Optional[float] = None
    total: Optional[float] = None


@dataclass
class Certificado:
    rol: str
    comuna: str
    nombre: str = ""
    direccion: str = ""
    total_deuda_no_vencida: Optional[float] = None
    total_deuda_morosa: Optional[float] = None
    total_acogido_art_196_197: Optional[float] = None
    tiene_deuda: Optional[bool] = None
    fecha_emision_certificado: str = ""
    liquidada_al: str = ""
    emitido_a_las: str = ""
    codigo_verificacion: str = ""
    detalle: List[DetalleCuota] = field(default_factory=list)
    raw_html: str = ""
    estado: str = "pendiente"        # pendiente|exitosa|sin_deuda|error|bloqueado
    intentos: int = 0
    error: str = ""
    fecha_consulta: str = field(default_factory=lambda: datetime.now().isoformat())


# ═════════════════════════════════════════════════════════════════════
# UTILIDADES DE PARSING
# ═════════════════════════════════════════════════════════════════════

def parse_clp(texto: str) -> Optional[float]:
    """Convierte '2,033,872' o '2.033.872' -> 2033872.0"""
    if texto is None:
        return None
    limpio = re.sub(r"[.,]", "", texto.strip())
    if not limpio.isdigit():
        return None
    return float(limpio)


def buscar_monto_tras_label(texto: str, label_regex: str) -> Optional[float]:
    """Busca 'CLP <monto>' apareciendo razonablemente cerca después de un label.
    Si el label existe pero no hay CLP cerca, se asume que el campo viene vacío
    (caso típico: caja sin deuda no imprime monto)."""
    m = re.search(label_regex + r"[\s\S]{0,60}?CLP\s*([\d.,]+)", texto, re.IGNORECASE)
    if m:
        return parse_clp(m.group(1))
    return None


def parsear_detalle_seccion(texto: str, tipo_deuda: str) -> List[DetalleCuota]:
    """
    Extrae filas de la tabla de detalle. Formato esperado por fila:
    FORMULARIO TIPO FOLIO FECHA_VCTO DEUDA_NETA REAJUSTE INTERES MULTA TOTAL
    Ejemplo real: 30 30 3323621226 30-Jun-2026 2,033,872 0 0 0 2,033,872
    """
    filas = []
    patron = re.compile(
        r"(?P<formulario>\d{1,3})\s+"
        r"(?P<tipo>\d{1,3})\s+"
        r"(?P<folio>\d{5,})\s+"
        r"(?P<fecha_vcto>\d{2}-[A-Za-z]{3}-\d{4}|00-00-0000)\s+"
        r"(?P<deuda_neta>[\d.,]+)\s+"
        r"(?P<reajuste>[\d.,]+)\s+"
        r"(?P<interes>[\d.,]+)\s+"
        r"(?P<multa>[\d.,]+)\s+"
        r"(?P<total>[\d.,]+)"
    )
    for m in patron.finditer(texto):
        filas.append(
            DetalleCuota(
                tipo_deuda=tipo_deuda,
                formulario=m.group("formulario"),
                tipo=m.group("tipo"),
                folio=m.group("folio"),
                fecha_vcto=m.group("fecha_vcto"),
                deuda_neta=parse_clp(m.group("deuda_neta")),
                reajuste=parse_clp(m.group("reajuste")),
                interes=parse_clp(m.group("interes")),
                multa=parse_clp(m.group("multa")),
                total=parse_clp(m.group("total")),
            )
        )
    return filas


def extraer_texto_pdf_de_html(html: str) -> Optional[str]:
    """El resultado de TGR embebe el certificado como un PDF generado por
    JasperReports, codificado en base64 dentro de una data: URI. Lo extraemos,
    decodificamos y pasamos por pdfplumber para obtener texto limpio."""
    m = re.search(r"data:application/pdf;base64,([A-Za-z0-9+/=]+)", html)
    if not m:
        return None
    try:
        pdf_bytes = base64.b64decode(m.group(1))
    except Exception:
        return None

    partes = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            partes.append(page.extract_text() or "")
    return "\n".join(partes)


def parsear_resultado(html: str, rol: str, comuna: str) -> Certificado:
    """
    Parser principal. El resultado de TGR es un PDF embebido (JasperReports);
    se extrae el texto del PDF y se regexea ESE texto (ver
    extraer_texto_pdf_de_html). Calibrado contra el ROL 332-03621-131
    (Lo Barnechea) — ver inspeccion/pagina_resultado_real.html.
    """
    cert = Certificado(rol=rol, comuna=comuna, raw_html=html)

    texto_pdf = extraer_texto_pdf_de_html(html)

    if texto_pdf is None:
        # Sin PDF embebido -> probablemente "sin deuda" o error de formulario
        texto_plano = re.sub(r"<[^>]+>", " ", html)
        texto_plano = re.sub(r"\s+", " ", texto_plano)
        if re.search(r"no\s+(registra|presenta)\s+deuda", texto_plano, re.IGNORECASE) or \
           re.search(r"no\s+se\s+encontr", texto_plano, re.IGNORECASE):
            cert.tiene_deuda = False
            cert.estado = "sin_deuda"
        else:
            cert.estado = "error"
            cert.error = "No se encontró PDF embebido en el resultado (revisar selectores/flujo)"
        return cert

    texto = re.sub(r"[ \t]+", " ", texto_pdf)
    texto_una_linea = re.sub(r"\s+", " ", texto_pdf)

    # NOMBRE — línea "NOMBRE <valor>" hasta el inicio de la línea DIRECCION
    m_nombre = re.search(r"NOMBRE\s+(.+?)\s*\n", texto)
    if m_nombre:
        cert.nombre = m_nombre.group(1).strip()

    # DIRECCION — "DIRECCION <valor> COMUNA <comuna>"
    m_direccion = re.search(r"DIRECCION\s+(.+?)\s+COMUNA\b", texto_una_linea, re.IGNORECASE)
    if m_direccion:
        cert.direccion = m_direccion.group(1).strip()

    # Totales de cabecera: se derivan de la línea de total de cada sección de
    # detalle (última columna = TOTAL), porque la caja superior del PDF junta
    # las 3 cifras en una sola línea ambigua "CLP <monto>".
    m_no_vencida = re.search(r"Total\s+Deuda\s+No\s+Vencida\s*\(CLP\)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)", texto_una_linea, re.IGNORECASE)
    if m_no_vencida:
        cert.total_deuda_no_vencida = parse_clp(m_no_vencida.group(5))

    m_morosa = re.search(r"Total\s+Deuda\s+Morosa\s*\(CLP\)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)", texto_una_linea, re.IGNORECASE)
    if m_morosa:
        cert.total_deuda_morosa = parse_clp(m_morosa.group(5))

    m_acogido = re.search(r"Total\s+Acogid[oa]s?\s+ART\s+196\s+y\s+197\s*\(CLP\)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)", texto_una_linea, re.IGNORECASE)
    if m_acogido:
        cert.total_acogido_art_196_197 = parse_clp(m_acogido.group(5))

    # Sin deuda explícito en el PDF (certificados "sin deuda" suelen indicarlo)
    if cert.total_deuda_no_vencida is None and cert.total_deuda_morosa is None \
            and cert.total_acogido_art_196_197 is None \
            and re.search(r"no\s+(registra|presenta)\s+deuda", texto_una_linea, re.IGNORECASE):
        cert.tiene_deuda = False
        cert.estado = "sin_deuda"
        return cert

    # Detalle por sección
    detalle = []
    secciones = re.split(r"(?=Deuda\s*:?\s*(?:No\s+Vencida|Morosa)\s*\(CLP\))", texto, flags=re.IGNORECASE)
    for seccion in secciones:
        if re.search(r"No\s+Vencida\s*\(CLP\)", seccion, re.IGNORECASE):
            detalle += parsear_detalle_seccion(seccion, "No Vencida")
        elif re.search(r"Morosa\s*\(CLP\)", seccion, re.IGNORECASE):
            detalle += parsear_detalle_seccion(seccion, "Morosa")
    cert.detalle = detalle

    # Metadatos / pie de certificado
    m_fecha_emision = re.search(r"Fecha\s+de\s+Emisi[oó]n\s+del\s+Certificado:\s*([\d\-A-Za-z]+)", texto, re.IGNORECASE)
    if m_fecha_emision:
        cert.fecha_emision_certificado = m_fecha_emision.group(1).strip()

    m_liquidada = re.search(r"Liquidada\s+al:\s*([\d\-]+)", texto, re.IGNORECASE)
    if m_liquidada:
        cert.liquidada_al = m_liquidada.group(1).strip()

    m_emitido = re.search(r"Emitido\s+a\s+las:?\s*(\d{1,2}:\d{2})", texto, re.IGNORECASE)
    if m_emitido:
        cert.emitido_a_las = m_emitido.group(1).strip()

    m_codigo = re.search(r"\b(\d{3}[A-Z]{2}\d{10,})\b", texto)
    if m_codigo:
        cert.codigo_verificacion = m_codigo.group(1)

    # Determinar tiene_deuda
    totales = [cert.total_deuda_no_vencida, cert.total_deuda_morosa, cert.total_acogido_art_196_197]
    cert.tiene_deuda = any(t for t in totales if t and t > 0) or len(cert.detalle) > 0

    if not cert.nombre:
        # No se pudo extraer nada útil -> tratar como fallo de parsing, no como "sin deuda"
        cert.estado = "error"
        cert.error = "No se pudo extraer NOMBRE del resultado (revisar parser/selectores)"
    else:
        cert.estado = "exitosa" if cert.tiene_deuda else "sin_deuda"

    return cert


# ═════════════════════════════════════════════════════════════════════
# FIXTURE DE PRUEBA — caso real del PDF (Lo Barnechea)
# ═════════════════════════════════════════════════════════════════════

# Texto real extraído con pdfplumber del PDF embebido en el resultado de TGR
# (ROL 332-03621-131, Lo Barnechea) — ver inspeccion/pagina_resultado_real.html.
FIXTURE_TEXTO_PDF_REAL = """Certificado de Deuda
NOMBRE ROSSI UNDURRAGA MARUZELLA DI FAT
DIRECCION CERRO EL ALTAR 11491 ST 8 - 9 C COMUNA LO BARNECHEA
ROL 332-03621-131
Total Deuda Liquidada Morosa Total Deuda No Vencida Liquidada Acogidos ART 196 y 197 DEL C.T.
CLP 2,033,872
Deuda :No Vencida (CLP)
FORMULARIO TIPO FOLIO FECHA VCTO. DEUDA NETA REAJUSTE INTERES MULTA TOTAL
30 30 3323621226 30-Jun-2026 2,033,872 0 0 0 2,033,872
Total Deuda No Vencida (CLP) 2,033,872 0 0 0 2,033,872
(Liquidada al: 26-06-2026)
Fecha de Emisión del Certificado: 26-06-2026
Emitido a las: 23:12
El Servicio de Tesorería certifica que de acuerdo al estado de la Cuenta Única Tributaria del ROL LO BARNECHEA 332-03621-131, éste registra
deuda por el(los) formulario(s) detallado(s) precedentemente.
La Institución o persona ante quien se presenta este certificado, podrá verificar su autenticidad en www.tgr.cl, ingresando el número del código de barra
que se indica en certificado.
*Nota: Si la fecha de vcto. de la deuda es 00-00-0000 es una multa y no se aplicarán reajustes, intereses ni multas.
IMPORTANTE
DOCUMENTO NO VALIDO PARA PAGAR EN INSTITUCIONES RECAUDADORAS
001SD202617745453276
Página 1 de 1"""

def correr_test_fixture() -> bool:
    """Valida el parser contra el texto real extraído del PDF de ejemplo.
    No usa la red ni regenera el PDF: alimenta parsear_resultado() con el
    texto ya conocido, monkeypatcheando extraer_texto_pdf_de_html."""
    print("\n🧪 Corriendo test contra fixture conocido (Lo Barnechea)...\n")

    global extraer_texto_pdf_de_html
    original = extraer_texto_pdf_de_html
    extraer_texto_pdf_de_html = lambda html: FIXTURE_TEXTO_PDF_REAL  # noqa: E731

    try:
        cert = parsear_resultado("<html></html>", "332-03621-131", "Lo Barnechea")
    finally:
        extraer_texto_pdf_de_html = original

    checks = [
        ("nombre", cert.nombre, "ROSSI UNDURRAGA MARUZELLA DI FAT"),
        ("direccion", cert.direccion, "CERRO EL ALTAR 11491 ST 8 - 9 C"),
        ("tiene_deuda", cert.tiene_deuda, True),
        ("total_deuda_no_vencida", cert.total_deuda_no_vencida, 2033872.0),
        ("codigo_verificacion", cert.codigo_verificacion, "001SD202617745453276"),
        ("emitido_a_las", cert.emitido_a_las, "23:12"),
        ("fecha_emision_certificado", cert.fecha_emision_certificado, "26-06-2026"),
    ]

    ok_total = True
    for nombre_campo, obtenido, esperado in checks:
        ok = obtenido == esperado
        ok_total &= ok
        icono = "✅" if ok else "❌"
        print(f"{icono} {nombre_campo}: obtenido={obtenido!r}  esperado={esperado!r}")

    if cert.detalle:
        d = cert.detalle[0]
        check_detalle = (d.folio == "3323621226" and d.fecha_vcto == "30-Jun-2026" and d.total == 2033872.0)
        ok_total &= check_detalle
        icono = "✅" if check_detalle else "❌"
        print(f"{icono} detalle[0]: folio={d.folio} fecha_vcto={d.fecha_vcto} total={d.total}")
    else:
        ok_total = False
        print("❌ No se extrajo ninguna fila de detalle")

    print()
    if ok_total:
        print("✅✅✅ TEST PASADO — el parser reproduce el PDF de ejemplo correctamente.")
        print("    NOTA: esto valida la LÓGICA del parser contra un texto aproximado.")
        print("    Falta validar contra el HTML REAL del sitio (correr con --input")
        print("    sobre el mismo ROL 332-03621-131 / Lo Barnechea una vez calibrados")
        print("    los SELECTORS, y comparar el resultado con este mismo PDF).")
    else:
        print("❌ TEST FALLIDO — revisar los regex en parsear_resultado().")

    return ok_total


# ═════════════════════════════════════════════════════════════════════
# BASE DE DATOS
# ═════════════════════════════════════════════════════════════════════

class BaseDatos:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()
        self._pg_dsn = os.environ.get("DATABASE_URL")
        if self._pg_dsn:
            logger.info("DATABASE_URL detectado: los certificados también se guardarán en Postgres de producción")

    @contextlib.contextmanager
    def _conn(self):
        # sqlite3.Connection usado como "with conn:" solo gestiona la
        # transacción (commit/rollback), NO cierra el archivo. Como cada
        # llamada abre una conexión nueva y hay miles de llamadas desde
        # varios hilos worker, sin cerrar explícitamente se agotan los file
        # descriptors del proceso y sqlite3 falla con "unable to open
        # database file" (es el mensaje genérico de sqlite3 para errores de
        # open() del sistema, incluido EMFILE). Por eso aquí cerramos
        # siempre la conexión real al salir, conservando para quien llama
        # la misma sintaxis "with self._conn() as conn: ...".
        conn = sqlite3.connect(self.db_path, timeout=30)
        try:
            conn.execute("PRAGMA journal_mode=WAL;")  # permite lecturas concurrentes (dashboard)
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_schema(self):
        with self._lock, self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS certificados (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    rol TEXT UNIQUE,
                    comuna TEXT,
                    nombre TEXT,
                    direccion TEXT,
                    total_deuda_no_vencida REAL,
                    total_deuda_morosa REAL,
                    total_acogido_art_196_197 REAL,
                    tiene_deuda INTEGER,
                    fecha_emision_certificado TEXT,
                    liquidada_al TEXT,
                    emitido_a_las TEXT,
                    codigo_verificacion TEXT,
                    raw_html TEXT,
                    estado TEXT,
                    intentos INTEGER DEFAULT 0,
                    error TEXT,
                    fecha_consulta TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS certificado_detalle (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    certificado_id INTEGER,
                    tipo_deuda TEXT,
                    formulario TEXT,
                    tipo TEXT,
                    folio TEXT,
                    fecha_vcto TEXT,
                    deuda_neta REAL,
                    reajuste REAL,
                    interes REAL,
                    multa REAL,
                    total REAL,
                    FOREIGN KEY (certificado_id) REFERENCES certificados(id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_comuna ON certificados(comuna)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_estado ON certificados(estado)")
            conn.commit()

    def guardar(self, cert: Certificado):
        with self._lock, self._conn() as conn:
            cur = conn.execute("""
                INSERT INTO certificados (
                    rol, comuna, nombre, direccion, total_deuda_no_vencida,
                    total_deuda_morosa, total_acogido_art_196_197, tiene_deuda,
                    fecha_emision_certificado, liquidada_al, emitido_a_las,
                    codigo_verificacion, raw_html, estado, intentos, error, fecha_consulta
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(rol) DO UPDATE SET
                    nombre=excluded.nombre, direccion=excluded.direccion,
                    total_deuda_no_vencida=excluded.total_deuda_no_vencida,
                    total_deuda_morosa=excluded.total_deuda_morosa,
                    total_acogido_art_196_197=excluded.total_acogido_art_196_197,
                    tiene_deuda=excluded.tiene_deuda,
                    fecha_emision_certificado=excluded.fecha_emision_certificado,
                    liquidada_al=excluded.liquidada_al, emitido_a_las=excluded.emitido_a_las,
                    codigo_verificacion=excluded.codigo_verificacion, raw_html=excluded.raw_html,
                    estado=excluded.estado, intentos=excluded.intentos, error=excluded.error,
                    fecha_consulta=excluded.fecha_consulta
            """, (
                cert.rol, cert.comuna, cert.nombre, cert.direccion,
                cert.total_deuda_no_vencida, cert.total_deuda_morosa,
                cert.total_acogido_art_196_197, int(bool(cert.tiene_deuda)),
                cert.fecha_emision_certificado, cert.liquidada_al, cert.emitido_a_las,
                cert.codigo_verificacion, cert.raw_html, cert.estado, cert.intentos,
                cert.error, cert.fecha_consulta,
            ))

            cert_id = cur.lastrowid
            if cert_id is None:
                row = conn.execute("SELECT id FROM certificados WHERE rol = ?", (cert.rol,)).fetchone()
                cert_id = row[0]

            conn.execute("DELETE FROM certificado_detalle WHERE certificado_id = ?", (cert_id,))
            for d in cert.detalle:
                conn.execute("""
                    INSERT INTO certificado_detalle (
                        certificado_id, tipo_deuda, formulario, tipo, folio,
                        fecha_vcto, deuda_neta, reajuste, interes, multa, total
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    cert_id, d.tipo_deuda, d.formulario, d.tipo, d.folio,
                    d.fecha_vcto, d.deuda_neta, d.reajuste, d.interes, d.multa, d.total,
                ))
            conn.commit()

        if self._pg_dsn:
            self._guardar_postgres(cert)

    def _guardar_postgres(self, cert: Certificado):
        """Espejo en Postgres de producción (tablas 0045_tgr_certificados.sql).
        Solo corre si DATABASE_URL está seteado (en el VPS); nunca bloquea el
        guardado local en SQLite si falla."""
        try:
            import psycopg2
            with psycopg2.connect(self._pg_dsn) as pg, pg.cursor() as cur:
                cur.execute("""
                    INSERT INTO tgr_certificados (
                        rol, comuna, nombre, direccion, total_deuda_no_vencida,
                        total_deuda_morosa, total_acogido_art_196_197, tiene_deuda,
                        fecha_emision_certificado, liquidada_al, emitido_a_las,
                        codigo_verificacion, estado, intentos, error, fecha_consulta, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                    ON CONFLICT (rol) DO UPDATE SET
                        comuna=excluded.comuna, nombre=excluded.nombre, direccion=excluded.direccion,
                        total_deuda_no_vencida=excluded.total_deuda_no_vencida,
                        total_deuda_morosa=excluded.total_deuda_morosa,
                        total_acogido_art_196_197=excluded.total_acogido_art_196_197,
                        tiene_deuda=excluded.tiene_deuda,
                        fecha_emision_certificado=excluded.fecha_emision_certificado,
                        liquidada_al=excluded.liquidada_al, emitido_a_las=excluded.emitido_a_las,
                        codigo_verificacion=excluded.codigo_verificacion,
                        estado=excluded.estado, intentos=excluded.intentos, error=excluded.error,
                        fecha_consulta=excluded.fecha_consulta, updated_at=now()
                    RETURNING id
                """, (
                    cert.rol, cert.comuna, cert.nombre, cert.direccion,
                    cert.total_deuda_no_vencida, cert.total_deuda_morosa,
                    cert.total_acogido_art_196_197, bool(cert.tiene_deuda),
                    cert.fecha_emision_certificado, cert.liquidada_al, cert.emitido_a_las,
                    cert.codigo_verificacion, cert.estado, cert.intentos,
                    cert.error, cert.fecha_consulta,
                ))
                cert_id = cur.fetchone()[0]
                cur.execute("DELETE FROM tgr_certificado_detalle WHERE certificado_id = %s", (cert_id,))
                for d in cert.detalle:
                    cur.execute("""
                        INSERT INTO tgr_certificado_detalle (
                            certificado_id, tipo_deuda, formulario, tipo, folio,
                            fecha_vcto, deuda_neta, reajuste, interes, multa, total
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        cert_id, d.tipo_deuda, d.formulario, d.tipo, d.folio,
                        d.fecha_vcto, d.deuda_neta, d.reajuste, d.interes, d.multa, d.total,
                    ))
                pg.commit()
        except Exception as e:
            logger.warning(f"No se pudo guardar en Postgres de producción (rol {cert.rol}): {e}")

    def ya_procesado(self, rol: str) -> Optional[str]:
        """Devuelve el estado actual si el ROL ya está en la BD, o None."""
        with self._conn() as conn:
            row = conn.execute("SELECT estado FROM certificados WHERE rol = ?", (rol,)).fetchone()
            return row[0] if row else None

    def roles_con_error(self) -> List[Tuple[str, str]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT rol, comuna FROM certificados WHERE estado = 'error'").fetchall()
            return [(r[0], r[1]) for r in rows]

    def estadisticas_globales(self) -> Dict:
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) FROM certificados").fetchone()[0]
            con_deuda = conn.execute("SELECT COUNT(*) FROM certificados WHERE tiene_deuda = 1").fetchone()[0]
            sin_deuda = conn.execute("SELECT COUNT(*) FROM certificados WHERE estado = 'sin_deuda'").fetchone()[0]
            errores = conn.execute("SELECT COUNT(*) FROM certificados WHERE estado = 'error'").fetchone()[0]
            monto_total = conn.execute(
                "SELECT COALESCE(SUM(total_deuda_no_vencida),0) + COALESCE(SUM(total_deuda_morosa),0) FROM certificados"
            ).fetchone()[0]
            return {
                "total": total, "con_deuda": con_deuda, "sin_deuda": sin_deuda,
                "errores": errores, "monto_total_deuda": monto_total,
            }

    def estadisticas_por_comuna(self) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT comuna,
                       COUNT(*) as total,
                       SUM(CASE WHEN tiene_deuda=1 THEN 1 ELSE 0 END) as con_deuda,
                       SUM(CASE WHEN estado='error' THEN 1 ELSE 0 END) as errores
                FROM certificados GROUP BY comuna
            """).fetchall()
            return [
                {"comuna": r[0], "total": r[1], "con_deuda": r[2], "errores": r[3]}
                for r in rows
            ]

    def reparsear_todos(self):
        """Re-extrae los campos desde raw_html ya guardado, sin red."""
        with self._conn() as conn:
            rows = conn.execute("SELECT id, rol, comuna, raw_html FROM certificados WHERE raw_html IS NOT NULL").fetchall()

        print(f"🔄 Reparseando {len(rows)} certificados desde HTML guardado...")
        for cert_id, rol, comuna, raw_html in rows:
            cert = parsear_resultado(raw_html, rol, comuna)
            self.guardar(cert)
        print("✅ Reparse completo.")


# ═════════════════════════════════════════════════════════════════════
# SCRAPER (workers paralelos con Selenium)
# ═════════════════════════════════════════════════════════════════════

class WorkerTGR:
    def __init__(self, worker_id: int, db: BaseDatos, config: "ConfigScraper"):
        self.worker_id = worker_id
        self.db = db
        self.config = config
        self.driver = None
        self.wait = None

    def iniciar(self):
        options = Options()
        if self.config.headless:
            options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1920,1080")
        options.add_argument(f"user-agent={random.choice(USER_AGENTS)}")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        # La página de resultado es una tabla de texto; imágenes/CSS/fuentes no
        # aportan datos y multiplican por 10-15x el tráfico (relevante para
        # proxies pagados por GB y para velocidad de carga).
        options.add_argument("--blink-settings=imagesEnabled=false")
        options.add_experimental_option("prefs", {
            "profile.managed_default_content_settings.images": 2,
            "profile.managed_default_content_settings.stylesheets": 2,
            "profile.managed_default_content_settings.fonts": 2,
        })
        # Perfil único por worker: con varios workers lanzando chromium en paralelo,
        # compartir el user-data-dir por defecto (confinado por snap) provoca un
        # conflicto de lock que termina el proceso con "Chrome instance exited".
        profile_dir = tempfile.mkdtemp(prefix=f"tgr-chrome-{self.worker_id}-")
        options.add_argument(f"--user-data-dir={profile_dir}")
        options.add_argument(f"--remote-debugging-port=0")
        self._profile_dir = profile_dir
        if os.path.exists(CHROME_BINARY):
            options.binary_location = CHROME_BINARY
        # PROXY DESACTIVADO (DIAGNÓSTICO): Scraper crasheó con proxy activado.
        # Verificando: ¿son las credenciales del proxy o hay otro problema?
        # Si funciona sin proxy = problema de sincronización de credenciales SMARTPROXY_CL_*
        # Si sigue crasheando = problema más profundo (Selenium/Chrome/Postgres)
        # https_proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        # if not https_proxy:
        #     sp_host = os.environ.get("SMARTPROXY_CL_HOST")
        #     sp_user = os.environ.get("SMARTPROXY_CL_USER")
        #     if sp_host and sp_user:
        #         sp_port = os.environ.get("SMARTPROXY_CL_PORT")
        #         sp_pass = os.environ.get("SMARTPROXY_CL_PASS")
        #         https_proxy = f"http://{sp_user}:{sp_pass}@{sp_host}:{sp_port}"
        # if https_proxy:
        #     options.add_argument(f"--proxy-server={https_proxy}")
        #     options.add_argument("--ignore-certificate-errors")
        #     options.add_argument("--ssl-version-max=tls1.2")
        #     options.add_argument("--disable-quic")
        service = Service(executable_path=CHROMEDRIVER_PATH) if os.path.exists(CHROMEDRIVER_PATH) else Service()
        self.driver = webdriver.Chrome(service=service, options=options)
        self.wait = WebDriverWait(self.driver, self.config.timeout)
        logger.info(f"Worker {self.worker_id}: driver iniciado")

    def detener(self):
        if self.driver:
            self.driver.quit()
        if getattr(self, "_profile_dir", None):
            shutil.rmtree(self._profile_dir, ignore_errors=True)

    def consultar_una_vez(self, rol: str, comuna: str) -> Certificado:
        rol_parts = rol.split("-")
        if len(rol_parts) != 3:
            cert = Certificado(rol=rol, comuna=comuna)
            cert.estado = "error"
            cert.error = f"Formato de ROL inválido: {rol}"
            return cert

        _, numero_rol, subrol = rol_parts

        self.driver.get(URL_TRAMITE)

        select_region_loc = SELECTORS["select_region"]
        select_comuna_loc = SELECTORS["select_comuna"]
        input_rol_loc = SELECTORS["input_rol"]
        input_subrol_loc = SELECTORS["input_subrol"]
        boton_loc = SELECTORS["boton_buscar"]

        self.wait.until(EC.presence_of_element_located(select_region_loc))
        time.sleep(0.5)

        select_region = Select(self.driver.find_element(*select_region_loc))
        select_region.select_by_value(REGION_METROPOLITANA_VALUE)

        # El onchange="recargar()" del select de región dispara una recarga
        # completa de la página (no AJAX puro), que repuebla el <select> de
        # comuna. Esperamos a que aparezca con más de la opción placeholder.
        self.wait.until(
            lambda d: len(Select(d.find_element(*select_comuna_loc)).options) > 1
        )

        select_comuna = Select(self.driver.find_element(*select_comuna_loc))
        comuna_upper = comuna.strip().upper()
        opcion_encontrada = None
        for opcion in select_comuna.options:
            if opcion.text.strip().upper().startswith(comuna_upper):
                opcion_encontrada = opcion
                break
        if opcion_encontrada is None:
            cert = Certificado(rol=rol, comuna=comuna)
            cert.estado = "error"
            cert.error = f"No se encontró la comuna {comuna!r} en el <select> de comuna"
            return cert
        select_comuna.select_by_visible_text(opcion_encontrada.text)
        time.sleep(0.3)

        campo_rol = self.driver.find_element(*input_rol_loc)
        campo_rol.clear()
        campo_rol.send_keys(numero_rol)

        campo_subrol = self.driver.find_element(*input_subrol_loc)
        campo_subrol.clear()
        campo_subrol.send_keys(subrol)

        time.sleep(0.3)
        self.driver.find_element(*boton_loc).click()

        self.wait.until(EC.presence_of_element_located(SELECTORS["resultado_marcador"]))
        time.sleep(1)

        html = self.driver.page_source
        return parsear_resultado(html, rol, comuna)

    def procesar(self, rol: str, comuna: str) -> Certificado:
        ultimo_error = ""
        for intento in range(1, self.config.max_reintentos + 1):
            try:
                delay = random.uniform(self.config.delay_min, self.config.delay_max)
                time.sleep(delay)

                cert = self.consultar_una_vez(rol, comuna)
                cert.intentos = intento

                if cert.estado in ("exitosa", "sin_deuda"):
                    return cert

                ultimo_error = cert.error or "resultado vacío/no reconocido"

            except TimeoutException:
                ultimo_error = "timeout esperando resultado"
                waf_bloqueado = False
                try:
                    url_actual = self.driver.current_url
                    snippet = re.sub(r"\s+", " ", self.driver.page_source)[:300]
                    logger.warning(f"Worker {self.worker_id}: timeout en {url_actual} — snippet página: {snippet!r}")
                    if "Request Rejected" in snippet or "support ID is" in snippet:
                        waf_bloqueado = True
                except Exception:
                    pass

                if waf_bloqueado:
                    # WAF (F5 BIG-IP ASM) está rechazando la IP, no es timeout de red.
                    # Reintentar rápido solo extiende el bloqueo: cooldown largo.
                    ultimo_error = "bloqueado por WAF del sitio (Request Rejected)"
                    cooldown = 300 + random.uniform(0, 60)
                    logger.warning(
                        f"Worker {self.worker_id}: ROL {rol} bloqueado por WAF. "
                        f"Cooldown de {cooldown:.0f}s antes de reintentar..."
                    )
                    time.sleep(cooldown)
                    continue
            except (NoSuchElementException, StaleElementReferenceException) as e:
                ultimo_error = f"elemento no encontrado: {e}"
            except WebDriverException as e:
                ultimo_error = f"error de webdriver: {e}"
                # driver puede haber quedado en mal estado, reiniciar
                try:
                    self.detener()
                except Exception:
                    pass
                self.iniciar()

            backoff = (2 ** intento) + random.uniform(0, 1)
            logger.warning(
                f"Worker {self.worker_id}: ROL {rol} falló intento {intento}/{self.config.max_reintentos} "
                f"({ultimo_error}). Reintentando en {backoff:.1f}s..."
            )
            time.sleep(backoff)

        cert = Certificado(rol=rol, comuna=comuna)
        cert.estado = "error"
        cert.intentos = self.config.max_reintentos
        cert.error = ultimo_error
        return cert


@dataclass
class ConfigScraper:
    # CONFIRMADO: 1 worker SIN proxy funciona (3 reg/min, estable por 4+ min).
    # Escalando a 2 workers (sin proxy). Sin proxy = evitamos problema de sincronización de credenciales.
    # Throughput esperado: ~6 reg/min.
    workers: int = 2
    max_reintentos: int = 4
    rondas_retry_fallidos: int = 2
    delay_min: float = 8.0
    delay_max: float = 15.0
    timeout: int = 25
    headless: bool = True
    export_cada_n: int = 200


class Orquestador:
    def __init__(self, config: ConfigScraper):
        self.config = config
        self.db = BaseDatos()
        self.cola: "queue.Queue[Tuple[str, str]]" = queue.Queue()
        self.lock_stats = threading.Lock()
        self.procesados = 0
        self.inicio = datetime.now()
        self._detener = threading.Event()

    def cargar_roles(self, csv_path: Path):
        filas = []
        with open(csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rol = row["rol"].strip()
                comuna = row["comuna"].strip()
                if self.db.ya_procesado(rol) in ("exitosa", "sin_deuda"):
                    continue  # ya lo tenemos, no reconsultar
                filas.append((rol, comuna))

        filas.sort(key=lambda x: orden_comuna(x[1]))

        for rol, comuna in filas:
            self.cola.put((rol, comuna))

        logger.info(f"Cargados {len(filas)} ROLs pendientes (orden: {COMUNAS_METROPOLITANA_ORDEN[:3]}...)")

    def cargar_fallidos(self):
        fallidos = self.db.roles_con_error()
        fallidos.sort(key=lambda x: orden_comuna(x[1]))
        for rol, comuna in fallidos:
            self.cola.put((rol, comuna))
        logger.info(f"Cargados {len(fallidos)} ROLs previamente fallidos para reintentar")

    def _loop_worker(self, worker_id: int):
        worker = WorkerTGR(worker_id, self.db, self.config)
        worker.iniciar()
        try:
            while not self._detener.is_set():
                try:
                    rol, comuna = self.cola.get(timeout=3)
                except queue.Empty:
                    break

                cert = worker.procesar(rol, comuna)
                self.db.guardar(cert)

                with self.lock_stats:
                    self.procesados += 1
                    n = self.procesados

                icono = "✅" if cert.estado == "exitosa" else ("⚪" if cert.estado == "sin_deuda" else "❌")
                monto = f" | CLP {cert.total_deuda_no_vencida:,.0f}" if cert.total_deuda_no_vencida else ""
                logger.info(f"{icono} [{comuna}] {rol} | {cert.nombre[:35]:35}{monto}")

                if n % 25 == 0:
                    self._reporte_progreso()

                self.cola.task_done()
        finally:
            worker.detener()

    def _reporte_progreso(self):
        transcurrido = (datetime.now() - self.inicio).total_seconds()
        velocidad = self.procesados / (transcurrido + 0.1)
        stats = self.db.estadisticas_globales()
        logger.info(
            f"⚡ Progreso: {self.procesados} procesados esta sesión | "
            f"{velocidad*60:.1f} props/min | Total en BD: {stats['total']} | "
            f"Con deuda: {stats['con_deuda']} | Errores: {stats['errores']}"
        )

    def ejecutar(self):
        hilos = [
            threading.Thread(target=self._loop_worker, args=(i,), name=f"W{i}", daemon=True)
            for i in range(self.config.workers)
        ]
        for h in hilos:
            h.start()

        try:
            for h in hilos:
                h.join()
        except KeyboardInterrupt:
            logger.info("⏹️ Interrupción detectada, deteniendo workers...")
            self._detener.set()
            for h in hilos:
                h.join(timeout=10)

        # rondas extra de retry sobre lo que quedó en error
        for ronda in range(1, self.config.rondas_retry_fallidos + 1):
            fallidos = self.db.roles_con_error()
            if not fallidos:
                break
            logger.info(f"🔁 Ronda extra de reintentos {ronda}: {len(fallidos)} ROLs en error")
            self.cargar_fallidos()
            self.ejecutar_simple()

        self.exportar_csv()
        self._reporte_final()

    def ejecutar_simple(self):
        """Ejecuta una pasada de la cola actual sin las rondas extra (usado internamente)."""
        hilos = [
            threading.Thread(target=self._loop_worker, args=(i,), name=f"W{i}", daemon=True)
            for i in range(self.config.workers)
        ]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join()

    def exportar_csv(self):
        EXPORT_DIR.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        with self.db._conn() as conn:
            certs = conn.execute("""
                SELECT rol, comuna, nombre, direccion, tiene_deuda,
                       total_deuda_no_vencida, total_deuda_morosa,
                       total_acogido_art_196_197, fecha_emision_certificado,
                       liquidada_al, emitido_a_las, codigo_verificacion, estado
                FROM certificados
            """).fetchall()

            detalles = conn.execute("""
                SELECT c.rol, d.tipo_deuda, d.formulario, d.tipo, d.folio,
                       d.fecha_vcto, d.deuda_neta, d.reajuste, d.interes, d.multa, d.total
                FROM certificado_detalle d
                JOIN certificados c ON c.id = d.certificado_id
            """).fetchall()

        resumen_path = EXPORT_DIR / f"certificados_resumen_{timestamp}.csv"
        with open(resumen_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["ROL", "COMUNA", "NOMBRE", "DIRECCION", "TIENE_DEUDA",
                        "TOTAL_DEUDA_NO_VENCIDA", "TOTAL_DEUDA_MOROSA",
                        "TOTAL_ACOGIDO_ART_196_197", "FECHA_EMISION_CERTIFICADO",
                        "LIQUIDADA_AL", "EMITIDO_A_LAS", "CODIGO_VERIFICACION", "ESTADO"])
            for row in certs:
                w.writerow(row)

        detalle_path = EXPORT_DIR / f"certificados_detalle_{timestamp}.csv"
        with open(detalle_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["ROL", "TIPO_DEUDA", "FORMULARIO", "TIPO", "FOLIO", "FECHA_VCTO",
                        "DEUDA_NETA", "REAJUSTE", "INTERES", "MULTA", "TOTAL"])
            for row in detalles:
                w.writerow(row)

        logger.info(f"✅ Exportado: {resumen_path}")
        logger.info(f"✅ Exportado: {detalle_path}")

    def _reporte_final(self):
        stats = self.db.estadisticas_globales()
        transcurrido = (datetime.now() - self.inicio).total_seconds()
        logger.info(f"""
        ╔══════════════════════════════════════════════════════╗
        ║              📊 RESUMEN FINAL DE SESIÓN               ║
        ╠══════════════════════════════════════════════════════╣
        ║ Procesados esta sesión:  {self.procesados:>10}              ║
        ║ Total en BD:             {stats['total']:>10}              ║
        ║ Con deuda:               {stats['con_deuda']:>10}              ║
        ║ Sin deuda:               {stats['sin_deuda']:>10}              ║
        ║ Errores pendientes:      {stats['errores']:>10}              ║
        ║ Monto total detectado:   CLP {stats['monto_total_deuda']:>15,.0f} ║
        ║ Tiempo sesión:           {transcurrido/60:>10.1f} min          ║
        ╚══════════════════════════════════════════════════════╝
        """)


# ═════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Scraper TGR - Certificado de Deuda de Contribuciones")
    parser.add_argument("--input", type=str, help="CSV de entrada con columnas rol,comuna")
    # default=1: el WAF de tesoreria.cl bloquea por IP, no por tasa — varios
    # workers en paralelo solo aceleran el bloqueo, no el throughput real.
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--max-reintentos", type=int, default=4)
    parser.add_argument("--test-fixture", action="store_true", help="Corre el test contra el caso conocido (Lo Barnechea)")
    parser.add_argument("--retry-failed", action="store_true", help="Reintenta todos los ROLs marcados como error")
    parser.add_argument("--reparse", action="store_true", help="Re-extrae datos desde raw_html guardado, sin red")
    parser.add_argument("--no-headless", action="store_true")
    args = parser.parse_args()

    if args.test_fixture:
        ok = correr_test_fixture()
        sys.exit(0 if ok else 1)

    config = ConfigScraper(
        workers=args.workers,
        max_reintentos=args.max_reintentos,
        headless=not args.no_headless,
    )

    orquestador = Orquestador(config)

    if args.reparse:
        orquestador.db.reparsear_todos()
        return

    if args.retry_failed:
        orquestador.cargar_fallidos()
        orquestador.ejecutar()
        return

    if not args.input:
        print("❌ Falta --input roles.csv (o usa --test-fixture / --retry-failed / --reparse)")
        sys.exit(1)

    orquestador.cargar_roles(Path(args.input))
    orquestador.ejecutar()


if __name__ == "__main__":
    main()
