-- =========================================================
-- MIGRACIÓN — Poder anular un cobro registrado por error.
--
-- Un cobro no se borra nunca (anti-fraude), pero hasta ahora tampoco había
-- forma de corregir uno repetido: si la misma plata se registraba dos veces,
-- el cierre de caja quedaba pidiendo un dinero que nunca entró y no se podía
-- arreglar. Ahora la dueña puede ANULARLO: el cobro sigue guardado, con quién
-- lo anuló, cuándo y por qué, pero deja de contar en las cuentas.
--
-- No hace falta policy nueva: "gestor limpia foto de cobro" ya deja a la dueña
-- hacer update, y el trigger de inmutabilidad sigue bloqueando todo lo demás
-- (monto, medio, visita...).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.cobros add column if not exists anulado boolean not null default false;
alter table public.cobros add column if not exists motivo_anulacion text;
alter table public.cobros add column if not exists anulado_por uuid references public.profiles(id);
alter table public.cobros add column if not exists anulado_at timestamptz;
