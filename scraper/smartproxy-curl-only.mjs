#!/usr/bin/env node
/**
 * Estrategia adaptada para curl-only (sin Playwright):
 * 1. curl directo sin proxy (baseline)
 * 2. curl con User-Agent de navegador real
 * 3. curl con headers HTTP completos + delays
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const TARGET_URL = 'https://www.portalinmobiliario.com/arriendo/casa/propiedades-usadas/lo-curro-vitacura-santiago-metropolitana';

async function runCurl(attempt, args) {
  try {
    const { stdout, stderr } = await execFileAsync('curl', args, {
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, error: err.message, stderr: err.stderr || '' };
  }
}

async function attemptBaseline() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INTENTO 1: curl directo (sin modificaciones)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const args = ['-sS', '--compressed', '-m', '25', TARGET_URL];
  console.log(`$ curl ${args.join(' ')}`);
  
  const result = await runCurl(1, args);
  if (!result.ok) {
    console.log(`❌ Error: ${result.error}`);
    return null;
  }

  if (result.stdout && result.stdout.length > 1000) {
    console.log(`✅ Respuesta recibida: ${result.stdout.length} bytes`);
    if (result.stdout.includes('propiedades') || result.stdout.includes('Portal')) {
      return result.stdout;
    }
    return null;
  }
  console.log(`❌ Respuesta vacía o muy corta: ${result.stdout?.length || 0} bytes`);
  return null;
}

async function attemptChromiumUA() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INTENTO 2: curl + User-Agent Chrome moderno');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const args = [
    '-sS', '--compressed', '-m', '25',
    '-A', ua,
    TARGET_URL
  ];
  console.log(`User-Agent: ${ua}`);
  
  const result = await runCurl(2, args);
  if (!result.ok) {
    console.log(`❌ Error: ${result.error}`);
    return null;
  }

  if (result.stdout && result.stdout.length > 1000) {
    console.log(`✅ Respuesta recibida: ${result.stdout.length} bytes`);
    if (result.stdout.includes('propiedades') || result.stdout.includes('Portal')) {
      return result.stdout;
    }
    return null;
  }
  console.log(`❌ Respuesta vacía o muy corta: ${result.stdout?.length || 0} bytes`);
  return null;
}

async function attemptFullHeaders() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INTENTO 3: curl + headers HTTP realistas');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const args = [
    '-sS', '--compressed', '-m', '25',
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: es-CL,es;q=0.9,en;q=0.8',
    '-H', 'Accept-Encoding: gzip, deflate, br',
    '-H', 'DNT: 1',
    '-H', 'Connection: keep-alive',
    '-H', 'Upgrade-Insecure-Requests: 1',
    '-H', 'Sec-Fetch-Dest: document',
    '-H', 'Sec-Fetch-Mode: navigate',
    '-H', 'Sec-Fetch-Site: none',
    '-H', 'Cache-Control: max-age=0',
    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    TARGET_URL
  ];
  console.log(`Enviando headers HTTP realistas...`);
  
  const result = await runCurl(3, args);
  if (!result.ok) {
    console.log(`❌ Error: ${result.error}`);
    return null;
  }

  if (result.stdout && result.stdout.length > 1000) {
    console.log(`✅ Respuesta recibida: ${result.stdout.length} bytes`);
    if (result.stdout.includes('propiedades') || result.stdout.includes('Portal')) {
      return result.stdout;
    }
    return null;
  }
  console.log(`❌ Respuesta vacía o muy corta: ${result.stdout?.length || 0} bytes`);
  return null;
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║        Portal Inmobiliario - curl con estrategia multi-header          ║');
  console.log('║     (Baseline → Chrome UA → Full headers)                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nURL objetivo: ${TARGET_URL}\n`);

  let html = null;
  let strategy = null;

  // Intento 1: Baseline
  html = await attemptBaseline();
  if (html) {
    strategy = 'curl directo';
    console.log(`\n✅ ÉXITO con estrategia: ${strategy}`);
  } else {
    // Intento 2: Chrome UA
    html = await attemptChromiumUA();
    if (html) {
      strategy = 'curl + Chrome UA';
      console.log(`\n✅ ÉXITO con estrategia: ${strategy}`);
    } else {
      // Intento 3: Full headers
      html = await attemptFullHeaders();
      if (html) {
        strategy = 'curl + full headers';
        console.log(`\n✅ ÉXITO con estrategia: ${strategy}`);
      }
    }
  }

  // Guardar resultado
  if (html) {
    const outputPath = path.join(__dirname, 'lo-curro-REAL.html');
    fs.writeFileSync(outputPath, html);
    console.log(`\n📁 HTML guardado en: ${outputPath}`);
    console.log(`📊 Tamaño: ${html.length} bytes`);
    console.log(`🎯 Estrategia exitosa: ${strategy}\n`);
  } else {
    console.log('\n❌ Todos los intentos de curl fallaron.');
    console.log('\nDiagnóstico:');
    console.log('1. Portal Inmobiliario puede estar bloqueando curl completamente');
    console.log('2. Se requeriría ejecutar desde un VPS con IP residencial');
    console.log('3. O usar Smartproxy SOCKS5 con credenciales válidas');
    console.log('4. O implementar Puppeteer/Playwright en un sandbox remoto\n');
  }
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err);
  process.exit(1);
});
