#!/usr/bin/env node
/**
 * smartproxy-bypass-production.mjs
 * 
 * Scraper de Portal Inmobiliario con estrategia Smartproxy multi-intento
 * DISEÑADO PARA EJECUTAR EN VPS CON IP RESIDENCIAL
 * 
 * Uso:
 *   # Con SOCKS5 configurado
 *   SMARTPROXY_SOCKS5_HOST=gate.smartproxy.com \
 *   SMARTPROXY_SOCKS5_PORT=1080 \
 *   SMARTPROXY_SOCKS5_USER=spxxxx_countryxx \
 *   SMARTPROXY_SOCKS5_PASS=password \
 *   node smartproxy-bypass-production.mjs
 * 
 *   # Con API key de Smartproxy (Intento 2)
 *   SMARTPROXY_API_KEY=9cf8f476185ea51d90a811dfedf19974 \
 *   node smartproxy-bypass-production.mjs
 * 
 *   # Mode test/mock (local testing)
 *   MOCK_MODE=1 node smartproxy-bypass-production.mjs
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

// ════════════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════════════

const TARGET_URL = 'https://www.portalinmobiliario.com/arriendo/casa/propiedades-usadas/lo-curro-vitacura-santiago-metropolitana';
const SMARTPROXY_API = 'https://www.smartproxy.org/web_v1/ip/get-ip-v3';
const SMARTPROXY_API_KEY = process.env.SMARTPROXY_API_KEY || '9cf8f476185ea51d90a811dfedf19974';
const MOCK_MODE = process.env.MOCK_MODE === '1';

// Configuración de reintentos
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ════════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════════════════════════════════════════

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(level, msg) {
  const now = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = {
    'info': '✓',
    'warn': '⚠',
    'error': '✗',
    'debug': '→'
  }[level] || '•';
  console.log(`[${now}] ${prefix} ${msg}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// INTENTO 1: SOCKS5 + curl
// ════════════════════════════════════════════════════════════════════════════════

async function attemptSocks5() {
  log('info', 'INTENTO 1: SOCKS5 + curl');
  
  const { SMARTPROXY_SOCKS5_HOST, SMARTPROXY_SOCKS5_PORT, 
          SMARTPROXY_SOCKS5_USER, SMARTPROXY_SOCKS5_PASS } = process.env;
  
  if (!SMARTPROXY_SOCKS5_HOST) {
    log('warn', 'SOCKS5 no configurado (SMARTPROXY_SOCKS5_HOST vacío)');
    return null;
  }

  const port = SMARTPROXY_SOCKS5_PORT || 1080;
  const proxyUrl = SMARTPROXY_SOCKS5_USER 
    ? `socks5://${SMARTPROXY_SOCKS5_USER}:${SMARTPROXY_SOCKS5_PASS}@${SMARTPROXY_SOCKS5_HOST}:${port}`
    : `socks5://${SMARTPROXY_SOCKS5_HOST}:${port}`;
  
  log('debug', `Proxy: socks5://*:*@${SMARTPROXY_SOCKS5_HOST}:${port}`);
  
  try {
    const args = [
      '-sS', '--compressed', '-m', '30',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      '-x', proxyUrl,
      '-w', '\n__HTTP_STATUS__:%{http_code}',
      TARGET_URL
    ];

    const { stdout } = await execFileAsync('curl', args, {
      timeout: 35000,
      maxBuffer: 64 * 1024 * 1024
    });

    const m = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/);
    const status = m ? Number(m[1]) : 0;
    const html = m ? stdout.slice(0, m.index) : stdout;

    if (status !== 200) {
      log('warn', `HTTP ${status}`);
      return null;
    }

    if (!html || html.length < 5000) {
      log('warn', `HTML muy corto (${html.length} bytes)`);
      return null;
    }

    log('info', `SOCKS5 exitoso: ${html.length} bytes`);
    return html;

  } catch (err) {
    log('warn', `SOCKS5 error: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// INTENTO 2: API Smartproxy para obtener IPs dinámicas + fetch
// ════════════════════════════════════════════════════════════════════════════════

async function getSmartproxyIPs(count = 3) {
  return new Promise((resolve) => {
    const url = new URL(SMARTPROXY_API);
    url.searchParams.append('app_key', SMARTPROXY_API_KEY);
    url.searchParams.append('pt', '9'); // 9 = residential
    url.searchParams.append('num', count.toString());
    url.searchParams.append('cc', 'CL'); // Chile
    url.searchParams.append('life', '30');
    url.searchParams.append('format', 'json');
    url.searchParams.append('protocol', '1');
    
    log('debug', `Obteniendo ${count} IPs del API de Smartproxy...`);
    
    https.get(url.toString(), (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ips && Array.isArray(json.ips)) {
            log('debug', `API devolvió ${json.ips.length} IPs`);
            resolve(json.ips);
          } else {
            log('warn', 'API response inesperada');
            resolve([]);
          }
        } catch (e) {
          log('warn', `JSON parse error: ${e.message}`);
          resolve([]);
        }
      });
    }).on('error', (err) => {
      log('warn', `API fetch error: ${err.message}`);
      resolve([]);
    });
  });
}

async function fetchViaProxy(proxyServer) {
  return new Promise((resolve) => {
    log('debug', `Intentando fetch vía ${proxyServer}...`);
    
    const [host, port] = proxyServer.split(':');
    const urlObj = new URL(TARGET_URL);
    
    const proxyReq = http.request({
      hostname: host,
      port: Number(port),
      path: TARGET_URL,
      method: 'GET',
      timeout: 30000,
      headers: {
        'Host': urlObj.hostname,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
        'Connection': 'keep-alive',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200 && data.length > 5000) {
          log('debug', `✓ HTTP 200, ${data.length} bytes`);
          resolve(data);
        } else {
          log('warn', `HTTP ${res.statusCode}, ${data.length} bytes`);
          resolve(null);
        }
      });
    });
    
    proxyReq.on('timeout', () => {
      log('warn', 'Timeout');
      proxyReq.destroy();
      resolve(null);
    });
    
    proxyReq.on('error', (err) => {
      log('warn', `Error: ${err.message}`);
      resolve(null);
    });
    
    proxyReq.end();
  });
}

async function attemptSmartproxyAPI() {
  log('info', 'INTENTO 2: API Smartproxy + fetch');
  
  try {
    const ips = await getSmartproxyIPs(3);
    if (ips.length === 0) {
      log('warn', 'No se obtuvieron IPs');
      return null;
    }

    for (const ipObj of ips) {
      const proxyServer = `${ipObj.ip}:${ipObj.port}`;
      log('debug', `Probando IP: ${proxyServer}`);
      
      const html = await fetchViaProxy(proxyServer);
      if (html) {
        log('info', `API + fetch exitoso: ${html.length} bytes`);
        return html;
      }
      
      await sleep(500);
    }

    log('warn', 'Ninguna IP funcionó');
    return null;

  } catch (err) {
    log('warn', `Error: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// INTENTO 3: curl directo con headers realistas (fallback)
// ════════════════════════════════════════════════════════════════════════════════

async function attemptCurlHeaders() {
  log('info', 'INTENTO 3: curl con headers realistas');
  
  try {
    const args = [
      '-sS', '--compressed', '-m', '30',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: es-CL,es;q=0.9',
      '-H', 'Accept-Encoding: gzip, deflate, br',
      '-H', 'Sec-Fetch-Dest: document',
      '-H', 'Sec-Fetch-Mode: navigate',
      '-H', 'Sec-Fetch-Site: none',
      '-H', 'Cache-Control: max-age=0',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      '-w', '\n__HTTP_STATUS__:%{http_code}',
      TARGET_URL
    ];

    const { stdout } = await execFileAsync('curl', args, {
      timeout: 35000,
      maxBuffer: 64 * 1024 * 1024
    });

    const m = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/);
    const status = m ? Number(m[1]) : 0;
    const html = m ? stdout.slice(0, m.index) : stdout;

    if (status !== 200 || !html || html.length < 5000) {
      log('warn', `HTTP ${status}, ${html?.length || 0} bytes`);
      return null;
    }

    log('info', `curl exitoso: ${html.length} bytes`);
    return html;

  } catch (err) {
    log('warn', `Error: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// MOCK DATA (para testing local)
// ════════════════════════════════════════════════════════════════════════════════

function generateMockHTML() {
  log('info', 'MODO MOCK: Generando HTML realista de Lo Curro');
  
  const properties = [
    { mlc: 'MLC-1847000001', price: '3200000', beds: 3, baths: 2, m2: 145 },
    { mlc: 'MLC-1847000002', price: '3850000', beds: 4, baths: 2.5, m2: 160 },
    { mlc: 'MLC-1847000003', price: '4500000', beds: 4, baths: 3, m2: 180 },
    { mlc: 'MLC-1847000004', price: '2950000', beds: 3, baths: 2, m2: 135 },
    { mlc: 'MLC-1847000005', price: '5200000', beds: 5, baths: 3.5, m2: 220 },
  ];

  let html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Lo Curro - Portal Inmobiliario</title></head>
<body><div class="propiedades-container">`;

  for (const p of properties) {
    html += `
    <div class="property-card" data-mlc="${p.mlc}">
      <div class="price">${p.price} CLP</div>
      <div class="beds">${p.beds} dormitorios</div>
      <div class="baths">${p.baths} baños</div>
      <div class="area">${p.m2} m²</div>
      <a href="/${p.mlc}">Ver detalle</a>
    </div>`;
  }

  html += `</div></body></html>`;
  return html;
}

// ════════════════════════════════════════════════════════════════════════════════
// PARSEO Y EXTRACCIÓN
// ════════════════════════════════════════════════════════════════════════════════

function parseProperties(html) {
  log('info', 'Parseando propiedades del HTML...');
  
  // Expresión regular simple para encontrar propiedades
  // En producción, usar cheerio o similar para parseo robusto
  const mlcPattern = /MLC-\d+/g;
  const pricePattern = /\$?\s*([\d,]+(?:\.\d{2})?)\s*(M\s*CLP|clp|pesos)?/gi;
  
  const mlcIds = html.match(mlcPattern) || [];
  log('debug', `Encontrados ${mlcIds.length} MLC-IDs`);
  
  return {
    mlc_ids: [...new Set(mlcIds)],
    estimated_count: mlcIds.length,
    parsed_at: new Date().toISOString()
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// EJECUTOR PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Portal Inmobiliario Scraper - Smartproxy Strategy v1.0               ║');
  console.log('║  Estrategia: SOCKS5 → API → Headers (para ejecución en VPS)           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');
  
  if (MOCK_MODE) {
    log('warn', 'MODO MOCK ACTIVADO (para testing local)');
  }
  
  log('info', `Target: ${TARGET_URL}`);

  let html = null;
  let strategy = null;
  let attempts = 0;

  // Intento 1: SOCKS5
  if (!MOCK_MODE) {
    attempts++;
    html = await attemptSocks5();
    if (html) {
      strategy = 'SOCKS5 + curl';
    } else {
      await sleep(RETRY_DELAY_MS);
    }
  }

  // Intento 2: API Smartproxy
  if (!html && !MOCK_MODE) {
    attempts++;
    html = await attemptSmartproxyAPI();
    if (html) {
      strategy = 'Smartproxy API + fetch';
    } else {
      await sleep(RETRY_DELAY_MS);
    }
  }

  // Intento 3: curl directo (fallback)
  if (!html && !MOCK_MODE) {
    attempts++;
    html = await attemptCurlHeaders();
    if (html) {
      strategy = 'curl + headers realistas';
    }
  }

  // Mock mode
  if (MOCK_MODE && !html) {
    html = generateMockHTML();
    strategy = 'MOCK DATA (testing)';
  }

  // ──────────────────────────────────────────────────────────────────────────

  if (html) {
    log('info', `Éxito con: ${strategy}`);
    log('info', `HTML: ${html.length} bytes`);

    // Parseo
    const parsed = parseProperties(html);
    log('info', `Propiedades encontradas: ${parsed.estimated_count}`);

    // Guardar resultado
    const htmlPath = path.join(__dirname, 'lo-curro-REAL.html');
    const jsonPath = path.join(__dirname, 'lo-curro-REAL.json');

    fs.writeFileSync(htmlPath, html);
    fs.writeFileSync(jsonPath, JSON.stringify({
      url: TARGET_URL,
      strategy,
      timestamp: new Date().toISOString(),
      scrape_result: parsed,
      html_size_bytes: html.length
    }, null, 2));

    log('info', `Archivos guardados:`);
    console.log(`  • HTML: ${htmlPath}`);
    console.log(`  • JSON: ${jsonPath}`);
    console.log(`\n✅ Scraping completado exitosamente\n`);

  } else {
    log('error', `Todos los ${attempts} intentos fallaron`);
    console.log('\n⚠️  Diagnóstico:');
    console.log('   1. ¿SMARTPROXY_SOCKS5_HOST está configurado?');
    console.log('   2. ¿Portal Inmobiliario está online?');
    console.log('   3. ¿Las credenciales SOCKS5 son válidas?');
    console.log('   4. ¿Hay conectividad de red en el servidor?\n');
    process.exit(1);
  }
}

main().catch(err => {
  log('error', `Error fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
