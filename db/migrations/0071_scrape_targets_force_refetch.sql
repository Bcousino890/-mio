-- ─────────────────────────────────────────────────────────────────────────────
-- 0071 · scrape_targets_cl.force_refetch: backfill de re-fetch de fichas
--        (plan Anuncios CL · ficha completa)
-- ─────────────────────────────────────────────────────────────────────────────
-- Las mejoras de la ficha (30 fotos, características completas, permalink con
-- slug) solo entran al RE-scrapear cada aviso, y el discovery normal encola el
-- detalle únicamente de los avisos NUEVOS (los que ya conoce no se re-bajan).
-- La URL corta guardada (MLC-<id>) redirige al home, así que el re-fetch no puede
-- reusarla: hay que pasar por el discovery, que obtiene el permalink fresco del
-- listado.
--
-- `force_refetch` = TRUE hace que el próximo barrido de esa comuna encole el
-- detalle de TODOS los avisos vistos (no solo los nuevos), con el permalink
-- fresco. El worker lo apaga solo tras un barrido forzado completo. La UI
-- (botón "Re-scrapear todo") lo activa + pone last_run_at=NULL para dispararlo ya.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE scrape_targets_cl
  ADD COLUMN IF NOT EXISTS force_refetch boolean NOT NULL DEFAULT false;
