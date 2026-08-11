-- =========================================================
-- MIGRACIÓN — pagos de comisión (saldo acumulado histórico)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Ledger de lo que ya se le pagó a cada profesional de su 50%. El saldo
-- pendiente NO es una columna: se calcula como (50% de todo lo trabajado
-- histórico) menos (suma de estos pagos) — igual patrón que
-- prestamos/prestamo_pagos pero al revés (aquí la empresa le debe a ella).
create table if not exists public.comision_pagos (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.profiles(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b')),
  nota text,
  pagado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_comision_pagos_persona on public.comision_pagos(persona_id);

alter table public.comision_pagos enable row level security;

drop policy if exists "super paga comisiones" on public.comision_pagos;
create policy "super paga comisiones"
  on public.comision_pagos for insert
  with check (public.es_super() and pagado_por = auth.uid());

drop policy if exists "admin ve pagos de comision" on public.comision_pagos;
create policy "admin ve pagos de comision"
  on public.comision_pagos for select
  using (public.es_admin());

drop policy if exists "personal ve sus pagos de comision" on public.comision_pagos;
create policy "personal ve sus pagos de comision"
  on public.comision_pagos for select
  using (persona_id = auth.uid());
