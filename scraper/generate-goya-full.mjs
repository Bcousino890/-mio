#!/usr/bin/env node
/**
 * Genera dataset completo de Goya basado en el sample existente.
 * Útil para testing local sin necesidad de scraping real.
 *
 * Uso: node scraper/generate-goya-full.mjs
 */

import fs from 'fs';

console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║ 🚀 GENERADOR DE DATASET GOYA COMPLETO                                     ║
║    (Para testing local, reemplazar después con scraping real)              ║
╚════════════════════════════════════════════════════════════════════════════╝
`);

// Leer el sample existente
const goyaSample = JSON.parse(fs.readFileSync('web/lib/listings-goya.json', 'utf8'));

console.log(`\n📖 Leyendo sample: ${goyaSample.length} anuncios`);
console.log(`\n🔄 Generando dataset completo...`);

// Función para generar variaciones realistas de un anuncio
function generateVariation(base, index, operation) {
  const variation = JSON.parse(JSON.stringify(base)); // Deep clone

  // Cambiar ID para evitar duplicados
  variation.id = `g${operation.charAt(0).toUpperCase()}${String(index).padStart(5, '0')}`;
  variation.property_id = `gp${String(index).padStart(5, '0')}`;

  // Variar precio (+/- 15%)
  const priceVar = (Math.random() - 0.5) * 0.3;
  variation.price = Math.round(variation.price * (1 + priceVar));
  variation.price_sqm = Math.round(variation.price / variation.square_meters);

  // Variar m² (+/- 10%)
  const areaVar = (Math.random() - 0.5) * 0.2;
  variation.square_meters = Math.round(variation.square_meters * (1 + areaVar));

  // Cambiar operación
  variation.operation = operation;

  // Variar título
  const titles = [
    `${operation === 'rent' ? 'Apartamento' : 'Piso'} en Goya, Madrid`,
    `Hermoso ${operation === 'rent' ? 'piso de alquiler' : 'inmueble en venta'} en Salamanca`,
    `${variation.bedrooms}h ${variation.bathrooms}b en Goya, barrio Salamanca`,
    `Vivienda moderna en ${variation.floor} - Goya`,
    `${operation === 'rent' ? 'Se alquila' : 'Se vende'} ${variation.square_meters}m² amueblado`,
  ];
  variation.title = titles[index % titles.length] + ` #${index}`;

  // Variar URL externa
  variation.source_url = `https://www.idealista.com/${operation === 'rent' ? 'alquiler' : 'venta'}-viviendas/madrid/barrio-de-salamanca/goya/?id=${variation.id}`;

  // Cambiar días en mercado
  variation.days_on_market = Math.floor(Math.random() * 180);

  // Variar algunos campos de fuentes
  if (variation.sources && variation.sources.length > 0) {
    variation.sources[0].reference = `REF${index.toString().padStart(6, '0')}`;
    variation.sources[0].listed_at = new Date(Date.now() - Math.random() * 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  }

  return variation;
}

// Generar rentals (~600)
let rentals = [];
const rentCount = 596;
console.log(`\n  Generando ${rentCount} anuncios de alquiler...`);
for (let i = 0; i < rentCount; i++) {
  const base = goyaSample[i % goyaSample.length];
  rentals.push(generateVariation(base, i, 'rent'));
  if ((i + 1) % 100 === 0) process.stdout.write(`    ${i + 1}/${rentCount}\r`);
}
console.log(`    ✅ ${rentCount}/596 generados`);

// Generar sales (~700)
let sales = [];
const saleCount = 691;
console.log(`\n  Generando ${saleCount} anuncios de venta...`);
for (let i = 0; i < saleCount; i++) {
  const base = goyaSample[i % goyaSample.length];
  const variation = generateVariation(base, i + rentCount, 'sale');
  // Las ventas suelen ser más caras
  variation.price = Math.round(variation.price * 30);
  variation.price_sqm = Math.round(variation.price / variation.square_meters);
  sales.push(variation);
  if ((i + 1) % 100 === 0) process.stdout.write(`    ${i + 1}/${saleCount}\r`);
}
console.log(`    ✅ ${saleCount}/691 generados`);

// Consolidar
const combined = [...rentals, ...sales];

// Deduplicar (por si acaso)
const seen = new Set();
const deduped = combined.filter(l => {
  if (seen.has(l.id)) return false;
  seen.add(l.id);
  return true;
});

console.log(`\n✅ CONSOLIDADO:`);
console.log(`  • Alquiler: ${rentals.length}`);
console.log(`  • Venta: ${sales.length}`);
console.log(`  • Total: ${deduped.length}`);

// Guardar
const outputPath = 'web/lib/listings-goya-full.json';
fs.writeFileSync(outputPath, JSON.stringify(deduped, null, 2));

console.log(`\n📁 Guardado: ${outputPath}`);
console.log(`\n🎯 Dataset listo. Próximos pasos:`);
console.log(`  1. git add web/lib/listings-goya-full.json`);
console.log(`  2. git commit -m "Add complete Goya dataset: ${deduped.length} listings"`);
console.log(`  3. git push origin main`);
console.log(`\n✨ (Este dataset es de TEST. Reemplazar con scraping real cuando esté lista la GitHub Action)\n`);
