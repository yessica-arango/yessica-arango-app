-- =========================================================
-- MIGRACIÓN — solo la dueña puede registrar devoluciones de dinero
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Admin puede dejar un saldo a favor (crédito, no sale dinero de caja);
-- sacar dinero de caja para devolverlo es más delicado y queda reservado
-- solo para la dueña (superadmin).
drop policy if exists "admin registra creditos" on public.creditos_clientes;
create policy "admin registra creditos"
  on public.creditos_clientes for insert
  with check (
    public.es_admin() and creado_por = auth.uid()
    and (resolucion = 'credito' or public.es_super())
  );
