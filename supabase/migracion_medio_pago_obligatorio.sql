-- =========================================================
-- MIGRACIÓN — exigir el medio de pago en todas las salidas de dinero
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================
--
-- Sin el medio de pago no se puede saber si una salida fue del cajón o de
-- una cuenta, y el "Efectivo por consignar" del cierre queda inflado (esa
-- plata salió de verdad, pero no se resta porque no se sabe de dónde).
--
-- Se usa CHECK ... NOT VALID a propósito: la regla aplica de aquí en
-- adelante (a todo lo que se inserte o se actualice), pero NO revisa las
-- filas viejas -- si las revisara, la migración fallaría por los registros
-- históricos que ya están sin medio. Esos se corrigen a mano desde la
-- pantalla de Cierre de caja, y a medida que se corrigen el pendiente por
-- consignar se va volviendo exacto.
--
-- Cada regla está condicionada, porque no todas las filas mueven plata:
--   * prestamos: solo los de tipo 'dinero' (un insumo asignado no se paga).
--   * creditos_clientes: solo los de resolución 'reembolso' (si queda como
--     crédito para la próxima cita, no salió plata).
--   * cierres_caja: solo si de verdad se le pagó algo a un proveedor.
--   * comision_pagos: siempre, todo pago de comisión mueve plata.

alter table public.prestamos
  drop constraint if exists prestamos_dinero_exige_medio;
alter table public.prestamos
  add constraint prestamos_dinero_exige_medio
  check (tipo <> 'dinero' or metodo_pago is not null) not valid;

alter table public.creditos_clientes
  drop constraint if exists reembolso_exige_medio;
alter table public.creditos_clientes
  add constraint reembolso_exige_medio
  check (resolucion <> 'reembolso' or metodo_pago is not null) not valid;

alter table public.cierres_caja
  drop constraint if exists proveedor_exige_medio;
alter table public.cierres_caja
  add constraint proveedor_exige_medio
  check (proveedor_monto = 0 or proveedor_metodo_pago is not null) not valid;

alter table public.comision_pagos
  drop constraint if exists comision_exige_medio;
alter table public.comision_pagos
  add constraint comision_exige_medio
  check (metodo_pago is not null) not valid;

-- ---------------------------------------------------------
-- Corregir los registros históricos que quedaron sin medio
-- ---------------------------------------------------------
-- Para poder asignarles el medio desde la pantalla hace falta permitir el
-- UPDATE, que hasta ahora estaba cerrado en estas tablas. Se abre lo
-- mínimo: solo la dueña, solo sobre filas que HOY tienen el medio en nulo
-- (el "using") y solo para dejarlo lleno (el "with check"). Una vez
-- corregida, la fila vuelve a quedar bloqueada -- no se puede cambiar un
-- medio ya registrado ni borrarlo.
drop policy if exists "super completa medio de comision" on public.comision_pagos;
create policy "super completa medio de comision"
  on public.comision_pagos for update
  using (public.es_super() and metodo_pago is null)
  with check (public.es_super() and metodo_pago is not null);

drop policy if exists "super completa medio de prestamo" on public.prestamos;
create policy "super completa medio de prestamo"
  on public.prestamos for update
  using (public.es_super() and metodo_pago is null)
  with check (public.es_super() and metodo_pago is not null);

drop policy if exists "super completa medio de reembolso" on public.creditos_clientes;
create policy "super completa medio de reembolso"
  on public.creditos_clientes for update
  using (public.es_super() and resolucion = 'reembolso' and metodo_pago is null)
  with check (public.es_super() and metodo_pago is not null);
