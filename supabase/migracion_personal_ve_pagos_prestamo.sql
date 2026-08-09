-- =========================================================
-- MIGRACIÓN — el personal puede ver los pagos de SUS propios préstamos
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Bug encontrado: en "Mi perfil" (personal) el saldo pendiente de un
-- préstamo se calculaba solo con el monto original, ignorando los abonos
-- registrados en prestamo_pagos — porque la única policy de select en esa
-- tabla era "admin ve pagos de prestamo" (es_admin()), que no incluye al rol
-- personal. Resultado: superadmin veía el préstamo pagado (con sus abonos
-- restados) pero la propia empleada seguía viendo la deuda completa.
drop policy if exists "personal ve pagos de sus prestamos" on public.prestamo_pagos;
create policy "personal ve pagos de sus prestamos"
  on public.prestamo_pagos for select
  using (
    exists (
      select 1 from public.prestamos pr
      where pr.id = prestamo_id and pr.persona_id = auth.uid()
    )
  );
