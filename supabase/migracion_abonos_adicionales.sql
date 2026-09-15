-- =========================================================
-- MIGRACIÓN — abonos adicionales a una cita ya agendada
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================
--
-- Una clienta abona al agendar y días después vuelve y paga otra parte (o
-- todo) antes del servicio. No había dónde registrarlo: el abono de la cita
-- queda congelado al confirmarla, y la única salida era cobrarlo el día del
-- servicio -- lo que descuadraba la caja, porque la plata entró un día y el
-- sistema la contaba otro.
--
-- No se suma dentro de citas.abono a propósito: ese campo tiene UNA fecha
-- (la de creación de la cita) y UN medio de pago. Si la clienta abonó $25.000
-- por Bre-B el lunes y $30.000 en efectivo el jueves, meterlo todo en el mismo
-- campo contaría los $55.000 el lunes y por Bre-B. Cada abono adicional
-- guarda su propia fecha, medio y comprobante, y se cuadra el día que entró.

create table if not exists public.cita_abonos (
  id uuid primary key default gen_random_uuid(),
  cita_id uuid not null references public.citas(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b')),
  foto_url text,
  nota text,
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_cita_abonos_cita on public.cita_abonos(cita_id);
create index if not exists idx_cita_abonos_created on public.cita_abonos(created_at);

alter table public.cita_abonos enable row level security;

drop policy if exists "admin registra abonos adicionales" on public.cita_abonos;
create policy "admin registra abonos adicionales"
  on public.cita_abonos for insert
  with check (public.es_admin() and registrado_por = auth.uid());

drop policy if exists "admin ve abonos adicionales" on public.cita_abonos;
create policy "admin ve abonos adicionales"
  on public.cita_abonos for select
  using (public.es_admin());

-- La profesional necesita verlos para saber cuánto falta por cobrar cuando
-- registra el trabajo desde la cita.
drop policy if exists "profesional ve abonos de sus citas" on public.cita_abonos;
create policy "profesional ve abonos de sus citas"
  on public.cita_abonos for select
  using (exists (
    select 1 from public.citas c
    where c.id = cita_abonos.cita_id and c.empleada_id = auth.uid()
  ));

-- Un abono registrado por error se borra completo (solo la dueña), igual
-- que un pago de comisión o un gasto.
drop policy if exists "super borra abonos adicionales" on public.cita_abonos;
create policy "super borra abonos adicionales"
  on public.cita_abonos for delete
  using (public.es_super());

-- No se le abona a una cita que ya se atendió o se canceló: ahí la plata
-- va por Cobros o por el saldo a favor, no como abono.
create or replace function public.bloquear_abono_cita_cerrada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  select estado into v_estado from public.citas where id = new.cita_id;
  if v_estado in ('completada', 'cancelada') then
    raise exception 'No se puede abonar a una cita %.', v_estado;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquear_abono_cita_cerrada on public.cita_abonos;
create trigger trg_bloquear_abono_cita_cerrada
  before insert on public.cita_abonos
  for each row execute function public.bloquear_abono_cita_cerrada();

drop trigger if exists trg_auditoria_cita_abonos on public.cita_abonos;
create trigger trg_auditoria_cita_abonos
  after insert on public.cita_abonos
  for each row execute function public.registrar_auditoria();
