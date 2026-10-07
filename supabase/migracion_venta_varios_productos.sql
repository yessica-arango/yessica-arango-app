-- =========================================================
-- MIGRACIÓN — Vender varios productos en una sola venta.
--
-- Cada producto sigue siendo su propia fila en "ventas" (así el descuento de
-- stock y la anulación siguen funcionando igual, producto por producto), pero
-- todas las filas de una misma compra comparten venta_grupo_id, para mostrarla
-- y anularla como una sola venta.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.ventas add column if not exists venta_grupo_id uuid;

create index if not exists idx_ventas_grupo on public.ventas(venta_grupo_id);

-- El grupo es parte de los datos de la venta: tampoco se puede cambiar después.
create or replace function public.bloquear_edicion_venta()
returns trigger
language plpgsql
as $$
begin
  if new.producto_id is distinct from old.producto_id
     or new.cantidad is distinct from old.cantidad
     or new.precio_unitario is distinct from old.precio_unitario
     or new.total is distinct from old.total
     or new.cliente_nombre is distinct from old.cliente_nombre
     or new.metodo_pago is distinct from old.metodo_pago
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.vendido_por is distinct from old.vendido_por
     or new.venta_grupo_id is distinct from old.venta_grupo_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de una venta ya registrada no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;
