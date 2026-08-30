-- =========================================================
-- MIGRACIÓN — que la dueña/admin pueda registrar un trabajo sin cita
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================
--
-- Hasta ahora un trabajo SOLO lo podía registrar la profesional que lo hizo
-- (la policy exigía empleada_id = auth.uid()). Pero llega una clienta sin
-- cita, la atienden, paga en el momento, y las profesionales están ocupadas
-- con otra clienta: no había forma de dejar ese trabajo registrado desde el
-- mostrador, y esa plata quedaba sin cuenta por cobrar y sin comisión.
--
-- Se agrega una policy ADITIVA: la dueña/admin puede insertar un registro a
-- nombre de cualquier profesional. La policy vieja se mantiene intacta, así
-- que cada profesional sigue registrando lo suyo igual que siempre.
--
-- Quién lo registró queda en la auditoría (el trigger de registros_trabajo
-- guarda auth.uid()), así que se puede distinguir después un registro hecho
-- por la profesional de uno hecho desde el mostrador.

drop policy if exists "admin registra trabajo sin cita" on public.registros_trabajo;
create policy "admin registra trabajo sin cita"
  on public.registros_trabajo for insert
  with check (public.es_admin());
