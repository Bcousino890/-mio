#!/usr/bin/env node
/**
 * Estrategia de 3 intentos para bypasear el bloqueo de Portal Inmobiliario
 * usando Smartproxy
 * 
 * Intento 1: SOCKS5 directo (si disponemos de credenciales)
 * Intento 2: API Smartproxy + Playwright con IP extraída
 * Intento 3: Playwright + headers anti-bot
 */

import { chromium } from 'playwright';
import https from 'https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const TARGET_URL = 'https://www.portalinmobiliario.com/arriendo/casa/propiedades-usadas/lo-curro-vitacura-santiago-metropolitana';
const SMARTPROXY_API = 'https://www.smartproxy.org/web_v1/ip/get-ip-v3';
const SMARTPROXY_API_KEY = process.env.SMARTPROXY_API_KEY || '9cf8f476185ea51d90a811dfedf19974';

const TIMEOUT_MS = 30000;

// ════════════════════════════════════════════════════════════════════════════════
// INTENTO 1: SOCKS5 + curl
// ════════════════════════════════════════════════════════════════════════════════
async function attemptSocks5() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INTENTO 1: SOCKS5 directo + curl');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    // Variables de entorno para credenciales SOCKS5
    const { SMARTPROXY_SOCKS5_HOST, SMARTPROXY_SOCKS5_PORT, 
            SMARTPROXY_SOCKS5_USER, SMARTPROXY_SOCKS5_PASS } = process.env;
    
    if (!SMARTPROXY_SOCKS5_HOST) {
      console.log('❌ No hay credenciales SOCKS5 configuradas (SMARTPROXY_SOCKS5_HOST no definido)');
      console.log('   Formatos esperados:');
      console.log('   - SMARTPROXY_SOCKS5_HOST: host del proxy');
      console.log('   - SMARTPROXY_SOCKS5_PORT: puerto (default 1080)');
      console.log('   - SMARTPROXY_SOCKS5_USER: usuario');
      console.log('   - SMARTPROXY_SOCKS5_PASS: contraseña');
      return null;
    }

    const proxyUrl = SMARTPROXY_SOCKS5_USER 
      ? `socks5://${SMARTPROXY_SOCKS5_USER}:${SMARTPROXY_SOCKS5_PASS}@${SMARTPROXY_SOCKS5_HOST}:${SMARTPROXY_SOCKS5_PORT || 1080}`
      : `socks5://${SMARTPROXY_SOCKS5_HOST}:${SMARTPROXY_SOCKS5_PORT || 1080}`;
    
    console.log(`Usando proxy SOCKS5: ${proxyUrl.replace(/:[^@]*@/, ':***@')}`);
    
    // Intentar con curl
    const args = [
      '-sS',
      '--compressed',
      '-m', '25',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      '-x', proxyUrl,
      TARGET_URL
    ];

    const { stdout, stderr } = await execFileAsync('curl', args, { 
      timeout: TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024 
    });

    if (!stdout || stdout.length < 1000) {
      console.log('❌ Respuesta vacía o muy corta');
      return null;
    }

    if (stdout.includes('Portal Inmobiliario') || stdout.includes('propiedades')) {
      console.log('✅ SOCKS5 funcionó! HTML recibido:', stdout.length, 'bytes');
      return stdout;
    }

    return null;

  } catch (err) {
    console.log(`❌ Error en SOCKS5: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// INTENTO 2: API Smartproxy para obtener IPs + Playwright
// ════════════════════════════════════════════════════════════════════════════════
async function getSmartproxyIPs(count = 5) {
  console.log(`Obteniendo ${count} IPs de Smartproxy...`);
  
  return new Promise((resolve) => {
    const url = new URL(SMARTPROXY_API);
    url.searchParams.append('app_key', SMARTPROXY_API_KEY);
    url.searchParams.append('pt', '9'); // 9 = residential
    url.searchParams.append('num', count.toString());
    url.searchParams.append('cc', 'CL'); // Chile
    url.searchParams.append('life', '30'); // 30 minutos
    url.searchParams.append('format', 'json');
    url.searchParams.append('protocol', '1'); // HTTP
    
    https.get(url.toString(), (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ips && Array.isArray(json.ips)) {
            console.log(`  ✓ Obtenidas ${json.ips.length} IPs`);
            resolve(json.ips);
          } else {
            console.log(`  ❌ Respuesta inesperada:`, json);
            resolve([]);
          }
        } catch (e) {
          console.log(`  ❌ Error parseando JSON:`, e.message);
          resolve([]);
        }
      });
    }).on('error', (err) => {
      console.log(`  ❌ Error fetcheando IPs:`, err.message);
      resolve([]);
    });
  });
}

async function attemptPlaywrightWithProxy() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INTENTO 2: API Smartproxy + Playwright con IP proxy');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const ips = await getSmartproxyIPs(3);
    if (ips.length === 0) {
      console.log('❌ No se pudieron obtener IPs de Smartproxy');
      return null;
    }

    // Intenta con cada IP
    for (const ip of ips) {
      console.log(`\nIntentando con IP: ${ip.ip}:${ip.port}`);
      
      let browser;
      try {
        browser = await chromium.launch({
          proxy: {
            server: `http://${ip.ip}:${ip.port}`
          }
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        
        console.log(`  Navegando a ${TARGET_URL}...`);
        const response = await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
        
        if (!response.ok()) {
          console.log(`  ❌ HTTP ${response.status()}`);
          await browser.close();
          continue;
        }

        const html = await page.content();
        
        if (html && html.length > 5000 && html.includes('propiedades')) {
          console.log(`  ✅ Éxito! HTML: ${html.length} bytes`);
          await browser.close();
          return html;
        }

        console.log(`  ⚠️  HTML recibido pero parece incompleto (${html.length} bytes)`);
        await browser.close();

      } catch (err) {
        if (browser) await browser.close().catch(() => {});
        console.log(`  ❌ Error: ${err.message}`);
      }
    }

    return null;

  } catch (err) {
    console.log(`❌ Error en intento 2: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// INTENTO 3: Playwright con headers anti-bot y delays
// ════════════════════════════════════════════════════════════════════════════════
async function attemptPlaywrightHeaders() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INTENTO 3: Playwright con headers anti-bot');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();

    // Headers realistas
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-CL,es;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
    });

    console.log(`Navegando a ${TARGET_URL}...`);
    
    // Emular comportamiento humano
    const response = await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    
    if (!response.ok()) {
      console.log(`❌ HTTP ${response.status()}`);
      await browser.close();
      return null;
    }

    // Scroll lento para simular lectura
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await new Promise(r => setTimeout(r, 1000));

    const html = await page.content();
    
    if (html && html.length > 5000 && html.includes('propiedades')) {
      console.log(`✅ Éxito! HTML: ${html.length} bytes`);
      await browser.close();
      return html;
    }

    console.log(`⚠️  HTML recibido pero parece incompleto (${html.length} bytes)`);
    await browser.close();
    return null;

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.log(`❌ Error en intento 3: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// EJECUTOR PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║        PORTAL INMOBILIARIO BYPASS - Estrategia 3 intentos             ║');
  console.log('║           (SOCKS5 → IP-extracción → Headers anti-bot)                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nURL objetivo: ${TARGET_URL}\n`);

  let html = null;
  let strategy = null;

  // Intento 1
  html = await attemptSocks5();
  if (html) {
    strategy = 'SOCKS5 + curl';
    console.log(`\n✅ ÉXITO con estrategia: ${strategy}`);
  } else {
    // Intento 2
    html = await attemptPlaywrightWithProxy();
    if (html) {
      strategy = 'Smartproxy API + Playwright';
      console.log(`\n✅ ÉXITO con estrategia: ${strategy}`);
    } else {
      // Intento 3
      html = await attemptPlaywrightHeaders();
      if (html) {
        strategy = 'Playwright + headers anti-bot';
        console.log(`\n✅ ÉXITO con estrategia: ${strategy}`);
      }
    }
  }

  // Guardar resultado
  if (html) {
    const outputPath = path.join(__dirname, '../../scraper/lo-curro-REAL.html');
    fs.writeFileSync(outputPath, html);
    console.log(`\n📁 HTML guardado en: ${outputPath}`);
    console.log(`📊 Tamaño: ${html.length} bytes`);
    console.log(`🎯 Estrategia exitosa: ${strategy}\n`);
  } else {
    console.log('\n❌ Todos los intentos fallaron.');
    console.log('   Próximos pasos:');
    console.log('   1. Verificar conectividad general (ping google.com)');
    console.log('   2. Revisar si Portal Inmobiliario está online');
    console.log('   3. Considerar usar un VPS con IP residencial dedicada');
    console.log('   4. Contactar con Smartproxy para validar credenciales\n');
  }
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err);
  process.exit(1);
});
