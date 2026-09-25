-- =========================================================
-- MIGRACIÓN — Garantías: pasar un trabajo de días anteriores a otra persona.
--
-- Cuando un trabajo se tiene que rehacer por garantía, la comisión no la
-- gana quien lo hizo mal sino quien lo rehace. La plata NO se toca: la
-- clienta ya pagó ese día y no vuelve a pagar, así que el trabajo original
-- sigue contando como ingreso de su día y el trabajo de la garantía se
-- registra en $0.
--
--   * valor_comision      -> base con la que se calcula la comisión cuando es
--                            distinta de lo cobrado (garantía: cobrado $0 pero
--                            comisiona por el valor del servicio).
--   * es_garantia         -> este registro es un trabajo rehecho por garantía.
--   * garantia_de         -> el trabajo original que se rehizo.
--   * comision_anulada    -> a este trabajo se le quitó la comisión.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.registros_trabajo
  add column if not exists valor_comision numeric(12,2) check (valor_comision is null or valor_comision >= 0);
alter table public.registros_trabajo
  add column if not exists es_garantia boolean not null default false;
alter table public.registros_trabajo
  add column if not exists garantia_de uuid references public.registros_trabajo(id);
alter table public.registros_trabajo
  add column if not exists comision_anulada boolean not null default false;
alter table public.registros_trabajo
  add column if not exists comision_anulada_motivo text;
alter table public.registros_trabajo
  add column if not exists comision_anulada_por uuid references public.profiles(id);
alter table public.registros_trabajo
  add column if not exists comision_anulada_at timestamptz;

-- El trigger que protege los datos del trabajo ya registrado tiene que
-- proteger también los datos nuevos. Lo único que se puede cambiar después
-- es anular el trabajo o quitarle la comisión.
create or replace function public.bloquear_edicion_registro_trabajo()
returns trigger
language plpgsql
as $$
begin
  if new.empleada_id is distinct from old.empleada_id
     or new.servicio_id is distinct from old.servicio_id
     or new.precio_cobrado is distinct from old.precio_cobrado
     or new.metodo_pago is distinct from old.metodo_pago
     or new.cliente_nombre is distinct from old.cliente_nombre
     or new.cliente_telefono is distinct from old.cliente_telefono
     -- Se permite BORRAR la foto (ponerla en NULL) por la retención de 1 mes,
     -- pero no cambiarla por otra.
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.visita_id is distinct from old.visita_id
     or new.cita_id is distinct from old.cita_id
     or new.valor_comision is distinct from old.valor_comision
     or new.es_garantia is distinct from old.es_garantia
     or new.garantia_de is distinct from old.garantia_de
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de un trabajo ya registrado no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;
