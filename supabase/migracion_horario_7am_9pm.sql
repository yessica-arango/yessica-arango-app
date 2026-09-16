-- =========================================================
-- MIGRACIÓN — Horario de citas de 7:00am a 9:00pm.
-- La hora de INICIO de una cita debe estar entre las 7am y las 9pm
-- (antes era 9am a 8pm). La hora de término sigue sin tope.
-- Solo aplica a citas nuevas o que se modifiquen (NOT VALID).
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.citas drop constraint if exists citas_hora_check;
alter table public.citas drop constraint if exists citas_hora_en_horario;

alter table public.citas
  add constraint citas_hora_en_horario check (hora >= '07:00' and hora <= '21:00') not valid;
