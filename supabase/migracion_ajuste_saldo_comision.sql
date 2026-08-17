-- =========================================================
-- MIGRACIÓN — ajustes de saldo de comisión (saldos de apertura)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================
--
-- Al entrar el sistema en producción, el 50% de todo el trabajo cargado
-- quedó como "pendiente por pagar", aunque a varias profesionales ya se les
-- había pagado por fuera antes. Ese saldo no es una deuda real: es el
-- arrastre de estar alineando el sistema con la realidad.
--
-- No se puede resolver anulando el trabajo (el trabajo SÍ se hizo y ese
-- ingreso es real), ni registrando un pago falso (inventaría una salida de
-- plata que descuadraría el efectivo por consignar y el balance general).
-- Hace falta una tercera cosa: un AJUSTE, que baja el saldo pendiente sin
-- mover plata.
--
-- Se implementa como un tipo dentro del mismo ledger de comision_pagos, así
-- que el saldo sigue siendo "ganado - (pagos + ajustes)" sin lógica nueva,
-- pero el frontend puede excluir los ajustes de todo cálculo de caja.

alter table public.comision_pagos
  add column if not exists tipo text not null default 'pago' check (tipo in ('pago', 'ajuste'));

-- Por qué se ajustó. Obligatorio en los ajustes: un saldo que se borra sin
-- explicación es indistinguible de un descuido.
alter table public.comision_pagos
  add column if not exists motivo text;

-- Un ajuste no mueve plata, así que no tiene medio de pago. Se reemplaza la
-- regla que lo exigía para que siga aplicando solo a los pagos reales.
alter table public.comision_pagos
  drop constraint if exists comision_exige_medio;
alter table public.comision_pagos
  add constraint comision_exige_medio
  check (tipo = 'ajuste' or metodo_pago is not null) not valid;

alter table public.comision_pagos
  drop constraint if exists ajuste_exige_motivo;
alter table public.comision_pagos
  add constraint ajuste_exige_motivo
  check (tipo <> 'ajuste' or (motivo is not null and length(btrim(motivo)) > 0)) not valid;

-- Un ajuste con medio de pago sería contradictorio (no salió plata), y
-- dejarlo pasar volvería a inflar las salidas en efectivo.
alter table public.comision_pagos
  drop constraint if exists ajuste_sin_medio;
alter table public.comision_pagos
  add constraint ajuste_sin_medio
  check (tipo <> 'ajuste' or metodo_pago is null) not valid;

-- La policy de insert ya existente ("super paga comisiones") cubre también
-- los ajustes: es la misma tabla y sigue siendo solo la dueña. Y la de
-- delete ("super borra pagos de comision") permite deshacer un ajuste mal
-- hecho, que es la forma de "modificarlo": se borra y se hace de nuevo.
