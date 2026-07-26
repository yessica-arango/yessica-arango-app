-- =========================================================
-- MIGRACIÓN — Bloque J: horario de atención (9:00am a 8:00pm).
-- Ninguna cita se puede agendar fuera de este rango, sin importar desde
-- dónde se cree (app de la clienta o panel del admin).
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.citas
  add constraint citas_hora_en_horario check (hora >= '09:00' and hora <= '20:00');

alter table public.citas
  add constraint citas_hora_fin_en_horario check (hora_fin is null or hora_fin <= '20:00');
