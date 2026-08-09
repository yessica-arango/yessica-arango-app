-- =========================================================
-- MIGRACIÓN — nuevo medio de pago "Bre-B"
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- 1) Todas las columnas metodo_pago (o similares) que restringen los
--    valores permitidos con un check inline. Postgres nombra estos checks
--    automáticamente como "<tabla>_<columna>_check" cuando no se les da
--    nombre explícito (como aquí) — por eso se pueden borrar por ese nombre
--    de forma segura y volver a crear con el valor nuevo agregado.
alter table public.registros_trabajo drop constraint if exists registros_trabajo_metodo_pago_check;
alter table public.registros_trabajo add constraint registros_trabajo_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.citas drop constraint if exists citas_abono_metodo_pago_check;
alter table public.citas add constraint citas_abono_metodo_pago_check
  check (abono_metodo_pago is null or abono_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.citas drop constraint if exists citas_saldo_metodo_pago_check;
alter table public.citas add constraint citas_saldo_metodo_pago_check
  check (saldo_metodo_pago is null or saldo_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.cobros drop constraint if exists cobros_metodo_pago_check;
alter table public.cobros add constraint cobros_metodo_pago_check
  check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.cierres_caja drop constraint if exists cierres_caja_proveedor_metodo_pago_check;
alter table public.cierres_caja add constraint cierres_caja_proveedor_metodo_pago_check
  check (proveedor_metodo_pago is null or proveedor_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.prestamos drop constraint if exists prestamos_metodo_pago_check;
alter table public.prestamos add constraint prestamos_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.prestamo_pagos drop constraint if exists prestamo_pagos_metodo_pago_check;
alter table public.prestamo_pagos add constraint prestamo_pagos_metodo_pago_check
  check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.ventas drop constraint if exists ventas_metodo_pago_check;
alter table public.ventas add constraint ventas_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.venta_pagos drop constraint if exists venta_pagos_metodo_pago_check;
alter table public.venta_pagos add constraint venta_pagos_metodo_pago_check
  check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.creditos_clientes drop constraint if exists creditos_clientes_metodo_pago_check;
alter table public.creditos_clientes add constraint creditos_clientes_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

-- 2) El cierre de caja reporta cada medio en su propia columna (no en una
--    tabla de líneas), así que Bre-B necesita su propia columna, igual que
--    nequi/daviplata/datafono.
alter table public.cierres_caja add column if not exists bre_b_reportado numeric(12,2) not null default 0;
