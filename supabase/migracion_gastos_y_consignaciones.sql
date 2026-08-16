-- =========================================================
-- MIGRACIÓN — gastos varios (con factura) y consignaciones al banco
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================
--
-- Dos salidas de caja que hasta ahora no tenían dónde registrarse:
--
-- 1. GASTOS: las compras chiquitas del día a día (una copia, unos vasos,
--    un taxi). Antes se metían en "Pago a proveedores" del cierre, que es
--    un campo único por cierre y sin foto -- así que varias compras el
--    mismo día no cabían y no quedaba soporte de ninguna.
--
-- 2. CONSIGNACIONES: cuando se lleva el efectivo al banco. Sin esto no
--    había forma de saber cuánto efectivo se ha acumulado sin consignar.
--
-- En ambas la foto es obligatoria a nivel de base de datos (foto_url not
-- null), no solo en la pantalla: un gasto sin factura o una consignación
-- sin comprobante no se pueden guardar ni saltándose la app.

-- ---------------------------------------------------------
-- Gastos varios (compras fuera de proveedores)
-- ---------------------------------------------------------
create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  monto numeric(12,2) not null check (monto > 0),
  concepto text not null,
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b')),
  -- Factura/recibo: obligatorio.
  foto_url text not null,
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_gastos_created on public.gastos(created_at);

alter table public.gastos enable row level security;

drop policy if exists "admin registra gastos" on public.gastos;
create policy "admin registra gastos"
  on public.gastos for insert
  with check (public.es_admin() and registrado_por = auth.uid());

drop policy if exists "admin ve gastos" on public.gastos;
create policy "admin ve gastos"
  on public.gastos for select
  using (public.es_admin());

-- Un gasto mal registrado se borra completo (solo la dueña), igual que un
-- pago de comisión: no se edita para no dejar un soporte que no coincide
-- con la factura que se subió.
drop policy if exists "super borra gastos" on public.gastos;
create policy "super borra gastos"
  on public.gastos for delete
  using (public.es_super());

-- ---------------------------------------------------------
-- Consignaciones (efectivo llevado al banco)
-- ---------------------------------------------------------
create table if not exists public.consignaciones (
  id uuid primary key default gen_random_uuid(),
  monto numeric(12,2) not null check (monto > 0),
  banco text,
  nota text,
  -- Comprobante de la consignación: obligatorio.
  foto_url text not null,
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_consignaciones_created on public.consignaciones(created_at);

alter table public.consignaciones enable row level security;

drop policy if exists "admin registra consignaciones" on public.consignaciones;
create policy "admin registra consignaciones"
  on public.consignaciones for insert
  with check (public.es_admin() and registrado_por = auth.uid());

drop policy if exists "admin ve consignaciones" on public.consignaciones;
create policy "admin ve consignaciones"
  on public.consignaciones for select
  using (public.es_admin());

drop policy if exists "super borra consignaciones" on public.consignaciones;
create policy "super borra consignaciones"
  on public.consignaciones for delete
  using (public.es_super());

-- ---------------------------------------------------------
-- Auditoría (mismo patrón que el resto de tablas de dinero)
-- ---------------------------------------------------------
drop trigger if exists trg_auditoria_gastos on public.gastos;
create trigger trg_auditoria_gastos
  after insert on public.gastos
  for each row execute function public.registrar_auditoria();

drop trigger if exists trg_auditoria_consignaciones on public.consignaciones;
create trigger trg_auditoria_consignaciones
  after insert on public.consignaciones
  for each row execute function public.registrar_auditoria();
