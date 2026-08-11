-- =========================================================
-- MIGRACIÓN — admin ve todos los cierres del día (no solo los propios)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Necesario para que "movimientos después del cierre van al día siguiente"
-- funcione bien: si otra persona (otro admin, o la dueña) ya cerró la caja
-- de hoy, hace falta poder verlo para calcular el corte, no solo ver los
-- cierres que uno mismo hizo.
drop policy if exists "admin ve todos los cierres" on public.cierres_caja;
create policy "admin ve todos los cierres"
  on public.cierres_caja for select
  using (public.es_admin());
