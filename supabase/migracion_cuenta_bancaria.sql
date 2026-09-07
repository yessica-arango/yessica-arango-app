-- =========================================================
-- MIGRACIÓN — guardar la cuenta bancaria de cada persona
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================
--
-- Para consignarle el sueldo a cada profesional había que pedirle el número
-- de cuenta cada vez, y se perdía entre las notas. Ahora queda guardado en
-- su ficha, junto al resto de sus datos básicos.
--
-- Son dos campos porque en la práctica no siempre es un banco: muchas veces
-- es Nequi o Daviplata, donde lo que se guarda es un número de celular.

alter table public.profiles
  add column if not exists banco text;

alter table public.profiles
  add column if not exists cuenta_bancaria text;
