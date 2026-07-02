-- ─────────────────────────────────────────────────────────────────────────────
-- 0050 · refresh_market_views() — refresco de vistas materializadas
-- ─────────────────────────────────────────────────────────────────────────────
-- Las vistas mv_market_area (0007), mv_broken_exclusives (0007) y
-- mv_opportunities (0010) existían desde el principio pero nada las
-- refrescaba: solo había comentarios SQL sugiriendo el comando. Esta función
-- las refresca en el orden correcto (mv_opportunities depende de
-- mv_market_area) y la expone POST /api/admin/refresh-views (o pg_cron).
--
-- REFRESH ... CONCURRENTLY requiere índice único (existen: uq_market_area,
-- uq_broken_exclusives_rc20, uq_opportunities_listing) y NO bloquea lecturas,
-- pero falla si la vista nunca fue poblada — en ese caso cae al REFRESH normal.

CREATE OR REPLACE FUNCTION refresh_market_views()
RETURNS TABLE (view_name text, ok boolean, detail text)
LANGUAGE plpgsql
AS $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['mv_market_area', 'mv_broken_exclusives', 'mv_opportunities'] LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v);
      view_name := v; ok := true; detail := 'refreshed concurrently';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        EXECUTE format('REFRESH MATERIALIZED VIEW %I', v);
        view_name := v; ok := true; detail := 'refreshed (non-concurrent)';
        RETURN NEXT;
      EXCEPTION WHEN OTHERS THEN
        view_name := v; ok := false; detail := SQLERRM;
        RETURN NEXT;
      END;
    END;
  END LOOP;
END;
$$;
