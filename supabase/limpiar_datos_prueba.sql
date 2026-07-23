-- =========================================================
-- LIMPIAR DATOS DE PRUEBA
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ⚠️ BORRA DATOS. Mantiene el esquema (tablas, políticas, triggers) y
--    conserva SOLO el usuario Superadmin. Úsalo en pruebas / antes de producción.
-- =========================================================

-- 1) Borrar todos los datos transaccionales (trabajos, citas, jornada, etc.)
truncate table
  public.auditoria,
  public.marcaciones,
  public.permisos,
  public.prestamos,
  public.cierres_caja,
  public.registros_trabajo,
  public.citas
cascade;

-- 2) Borrar TODOS los usuarios de prueba (personal y clientas) EXCEPTO el Superadmin.
--    Esto borra en cascada sus perfiles automáticamente.
delete from auth.users
where email <> 'superadmin@yessica-arango.app';

-- 3) (Opcional) Las fotos de evidencia de prueba NO se pueden borrar por SQL
--    (Supabase lo bloquea). Bórralas desde el panel:
--    Supabase Dashboard > Storage > bucket "evidencias" > seleccionar > eliminar.
--    O simplemente déjalas: quedan huérfanas pero no afectan nada.

-- =========================================================
-- OPCIONAL: reiniciar el catálogo de servicios/precios.
-- Solo si metiste servicios de prueba y quieres empezar el catálogo de cero.
-- Descomenta estas 2 líneas y luego vuelve a correr supabase/seed_servicios.sql
-- =========================================================
-- truncate table public.servicios cascade;
-- (después ejecuta seed_servicios.sql para recargar los servicios reales)

-- 4) Verificar que quedó limpio (deben salir en 0, y 1 en profiles = Superadmin):
select
  (select count(*) from public.registros_trabajo) as trabajos,
  (select count(*) from public.citas)             as citas,
  (select count(*) from public.marcaciones)       as marcaciones,
  (select count(*) from public.permisos)          as permisos,
  (select count(*) from public.prestamos)         as prestamos,
  (select count(*) from public.cierres_caja)      as cierres,
  (select count(*) from public.profiles)          as usuarios;
