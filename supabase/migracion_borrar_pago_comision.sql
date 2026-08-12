-- =========================================================
-- MIGRACIÓN — permitir borrar un pago de comisión mal registrado
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Igual que con préstamos: un pago de comisión registrado por error
-- (fecha equivocada, se confirmó por accidente probando la pantalla, etc.)
-- se puede borrar por completo — solo la dueña. El saldo pendiente se
-- recalcula solo, porque no es una columna guardada sino "ganado - pagado".
drop policy if exists "super borra pagos de comision" on public.comision_pagos;
create policy "super borra pagos de comision"
  on public.comision_pagos for delete
  using (public.es_super());
