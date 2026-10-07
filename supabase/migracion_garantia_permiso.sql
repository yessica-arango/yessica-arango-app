-- =========================================================
-- MIGRACIÓN — Permiso para registrar un trabajo a nombre de otra persona.
--
-- Al pasar un trabajo a garantía salía:
--   "new row violates row-level security policy for table registros_trabajo"
-- porque en la base faltaba la regla que deja a la dueña/admin registrar un
-- trabajo a nombre de una profesional (la misma que usa "Registrar trabajo
-- sin cita"). Esta migración la deja puesta. Es la misma de
-- migracion_trabajo_sin_cita.sql: si ya está, no pasa nada por repetirla.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

drop policy if exists "admin registra trabajo sin cita" on public.registros_trabajo;
create policy "admin registra trabajo sin cita"
  on public.registros_trabajo for insert
  with check (public.es_admin());
