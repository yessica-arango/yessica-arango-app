-- =========================================================
-- MIGRACIÓN — separar el cierre de caja en dos cuadres independientes:
-- "servicios" (lo de siempre: cobros, préstamos, reembolsos, proveedores)
-- y "abonos" (solo los abonos de citas, con su propio esperado/reportado).
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Todos los cierres ya guardados quedan como 'servicios' (el default),
-- que es exactamente lo que eran antes de este cambio.
alter table public.cierres_caja
  add column if not exists tipo text not null default 'servicios' check (tipo in ('servicios', 'abonos'));

-- Antes solo se podía tener un cierre por fecha+administradora. Ahora se
-- permite uno de cada tipo el mismo día (uno de servicios y uno de abonos).
alter table public.cierres_caja drop constraint if exists cierres_caja_fecha_administradora_id_key;
alter table public.cierres_caja drop constraint if exists cierres_caja_fecha_administradora_id_tipo_key;
alter table public.cierres_caja
  add constraint cierres_caja_fecha_administradora_id_tipo_key unique (fecha, administradora_id, tipo);
