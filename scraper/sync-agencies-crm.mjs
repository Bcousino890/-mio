#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// sync-agencies-crm.mjs
//
// Sincroniza la tabla `agencies_crm_map` con los datos de `listings`.
// Agrupa por agency_domain y detecta qué CRM usa cada agencia.
//
// Uso:
//   node sync-agencies-crm.mjs
//
// Se ejecuta después de haber corrido scrape-zone.mjs varias veces para que
// la tabla listings tenga datos con agency_domain y agency_crm ya populados.
// ─────────────────────────────────────────────────────────────────────────────

async function syncAgenciesCRM() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    console.error('▶ Sincronizando agencies_crm_map desde listings...');

    // Agregar/actualizar agencias basándose en lo que hemos visto en listings.
    const result = await client.query(`
      INSERT INTO agencies_crm_map (
        agency_domain, crm_type, detection_samples, sample_url,
        first_detected_at, last_detected_at, listing_count
      )
      SELECT
        agency_domain,
        (array_agg(DISTINCT agency_crm ORDER BY agency_crm))[1] AS crm_type,
        COUNT(DISTINCT external_id) AS detection_samples,
        (array_agg(DISTINCT agency_url ORDER BY agency_url))[1] AS sample_url,
        MIN(created_at) AS first_detected_at,
        MAX(updated_at) AS last_detected_at,
        COUNT(*) AS listing_count
      FROM listings
      WHERE agency_domain IS NOT NULL AND agency_crm IS NOT NULL
      GROUP BY agency_domain
      ON CONFLICT (agency_domain) DO UPDATE SET
        crm_type = EXCLUDED.crm_type,
        detection_samples = EXCLUDED.detection_samples,
        sample_url = EXCLUDED.sample_url,
        last_detected_at = EXCLUDED.last_detected_at,
        listing_count = EXCLUDED.listing_count,
        updated_at = now()
      RETURNING agency_domain, crm_type, listing_count
    `);

    console.error(`✅ Sincronizadas ${result.rows.length} agencias:`);
    for (const row of result.rows) {
      console.error(`  · ${row.agency_domain} → ${row.crm_type} (${row.listing_count} anuncios)`);
    }

    // Estadísticas por CRM
    console.error('\n▶ Distribución de CRM:');
    const crmStats = await client.query(`
      SELECT crm_type, COUNT(*) as count, SUM(listing_count) as total_listings
      FROM agencies_crm_map
      WHERE crm_type IS NOT NULL
      GROUP BY crm_type
      ORDER BY total_listings DESC
    `);

    for (const stat of crmStats.rows) {
      console.error(`  · ${stat.crm_type}: ${stat.count} agencias, ${stat.total_listings} anuncios`);
    }
  } finally {
    await client.end();
  }
}

syncAgenciesCRM().catch((e) => {
  console.error('✗ Error:', e.message);
  process.exit(1);
});
