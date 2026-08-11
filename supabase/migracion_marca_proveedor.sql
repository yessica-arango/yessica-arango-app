-- =========================================================
-- MIGRACIÓN — marca y proveedor en productos de inventario
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.productos add column if not exists marca text;
alter table public.productos add column if not exists proveedor text;
