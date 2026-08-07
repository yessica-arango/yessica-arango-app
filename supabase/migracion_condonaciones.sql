-- =========================================================
-- MIGRACIÓN — eliminar/condonar saldo pendiente (solo superadmin)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Cuando la dueña decide no cobrar un saldo que quedó pendiente (ej. la
-- clienta no volvió, se le hizo una cortesía). No es un cobro real — no
-- entra dinero a caja — es un ajuste administrativo, reservado solo a
-- superadmin. Ledger inmutable, igual que cobros/creditos_clientes.
create table if not exists public.condonaciones (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null,
  monto numeric(12,2) not null check (monto > 0),
  motivo text not null,
  condonado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_condonaciones_visita on public.condonaciones(visita_id);

alter table public.condonaciones enable row level security;

-- (Postgres no soporta "CREATE POLICY IF NOT EXISTS": se borran primero por
-- si ya existen, para que esta migración se pueda volver a correr sin error.)
drop policy if exists "super condona saldo" on public.condonaciones;
create policy "super condona saldo"
  on public.condonaciones for insert
  with check (public.es_super() and condonado_por = auth.uid());

drop policy if exists "admin ve condonaciones" on public.condonaciones;
create policy "admin ve condonaciones"
  on public.condonaciones for select
  using (public.es_admin());

-- Nadie edita ni borra una condonación ya registrada (no se crean policies de update/delete).
