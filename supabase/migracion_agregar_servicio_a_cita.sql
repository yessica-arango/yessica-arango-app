-- =========================================================
-- MIGRACIÓN — poder agregar/quitar servicios a una cita ya confirmada
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================
--
-- Antes, apenas una cita pasaba de "pendiente" a "confirmada" quedaban
-- congelados TODOS sus datos, incluidos los servicios. Pero en la práctica
-- la clienta agenda con días de anticipación y después llama a agregar algo
-- ("ya que voy, hágame también las cejas") -- y no había forma de reflejarlo:
-- tocaba cancelar la cita y volverla a crear, perdiendo el abono.
--
-- El criterio nuevo separa dos cosas distintas:
--   * Lo que se le VA A HACER a la clienta (servicios, adicional, obsequios,
--     nota, profesional, fecha/hora): se puede ajustar hasta que la atiendan.
--     Una vez completada o cancelada, se congela como registro histórico.
--   * QUIÉN es y CUÁNTO abonó (cliente, teléfono, abono y su medio/foto):
--     se congela apenas la cita se confirma, como estaba.
--
-- De paso corrige un bug: el modal de confirmar/reprogramar deja editar los
-- obsequios, pero el trigger los bloqueaba para una cita ya confirmada, así
-- que cambiar el obsequio al reprogramar reventaba con un error.

create or replace function public.bloquear_edicion_cita()
returns trigger
language plpgsql
as $$
begin
  -- Datos de origen: SIEMPRE inmutables.
  if new.creado_por is distinct from old.creado_por
     or new.created_at is distinct from old.created_at
     or new.cliente_id is distinct from old.cliente_id
  then
    raise exception 'No se pueden modificar los datos de origen de una cita.';
  end if;

  -- Todo lo relativo a la visita en sí queda congelado una vez atendida o
  -- cancelada: ahí ya es historia y no se toca.
  if old.estado in ('completada', 'cancelada') then
    if new.empleada_id is distinct from old.empleada_id then
      raise exception 'No se puede cambiar la profesional de una cita completada o cancelada.';
    end if;
    if new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
    then
      raise exception 'No se puede reprogramar una cita ya completada o cancelada.';
    end if;
    if new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.adicional_concepto is distinct from old.adicional_concepto
       or new.adicional_valor is distinct from old.adicional_valor
       or new.obsequios is distinct from old.obsequios
       or new.nota is distinct from old.nota
    then
      raise exception 'No se pueden cambiar los servicios de una cita ya completada o cancelada.';
    end if;
  end if;

  -- Si se reprograma una cita YA confirmada, se marca para avisar en la
  -- campanita (la dueña/admin la revisa y la marca como vista).
  if old.estado = 'confirmada' and (
       new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
     ) then
    new.reprogramada := true;
  end if;

  -- Identidad de la clienta y plata ya recibida: se congelan apenas la cita
  -- deja de estar pendiente. Cambiar esto sería reescribir un hecho, no
  -- ajustar un plan.
  if old.estado <> 'pendiente' then
    if new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or (new.abono_foto_url is distinct from old.abono_foto_url and new.abono_foto_url is not null)
    then
      raise exception 'De una cita ya confirmada no se puede cambiar la clienta ni el abono.';
    end if;
  end if;

  -- El saldo se registra UNA vez (de 0 a un valor). Después queda fijo.
  if old.saldo_pagado <> 0 and (
       new.saldo_pagado is distinct from old.saldo_pagado
       or new.saldo_metodo_pago is distinct from old.saldo_metodo_pago
     ) then
    raise exception 'El saldo de esta cita ya fue registrado.';
  end if;

  return new;
end;
$$;
