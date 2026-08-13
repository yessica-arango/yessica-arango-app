-- =========================================================
-- MIGRACIÓN — permitir borrar un permiso/descanso registrado por error
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Igual que con préstamos y pagos de comisión: un permiso o descanso
-- registrado por error (persona o tipo equivocados, por ejemplo) se puede
-- borrar por completo — solo la dueña. Para corregir fechas/horas/motivo/
-- estado de uno que sí es correcto pero tiene datos mal puestos, ya existe
-- la policy de UPDATE "super gestiona permisos" (no hace falta migración).
drop policy if exists "super borra permisos" on public.permisos;
create policy "super borra permisos"
  on public.permisos for delete
  using (public.es_super());
