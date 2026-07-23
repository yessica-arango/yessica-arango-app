-- =========================================================
-- Control de Trabajos - Estética
-- Esquema Supabase (Postgres + RLS)
-- Ejecutar completo en: Supabase Dashboard > SQL Editor
-- =========================================================

-- ---------------------------------------------------------
-- 1. Perfiles (uno por usuario de auth.users)
-- ---------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  -- Rol = nivel de acceso (permisos):
  --   superadmin -> la dueña / control total
  --   admin      -> gestiona al personal, su horario y las citas, cierre de caja
  --   personal   -> profesional del servicio (marca su jornada, registra trabajos)
  --   cliente    -> se registra y pide citas
  rol text not null default 'cliente'
    check (rol in ('superadmin', 'admin', 'personal', 'cliente')),
  -- Especialidades del personal (SOLO una etiqueta, NO limita qué se le asigna):
  -- una misma persona puede tener varias, p.ej. {'manicurista','estilista'}.
  especialidades text[] not null default '{}',
  telefono text,
  -- Datos básicos (los llena la dueña/admin; la especialista no los edita).
  apellidos text,
  direccion text,
  cedula text,
  correo text,
  fecha_nacimiento date,
  fecha_ingreso date,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.mi_rol()
returns text
language sql
security definer
stable
as $$
  select rol from public.profiles where id = auth.uid()
$$;

-- Super = control total (la dueña).
create or replace function public.es_super()
returns boolean
language sql
security definer
stable
as $$
  select public.mi_rol() = 'superadmin'
$$;

-- Admin operativo = superadmin + admin (gestionan personal, horarios y citas).
create or replace function public.es_admin()
returns boolean
language sql
security definer
stable
as $$
  select public.mi_rol() in ('superadmin', 'admin')
$$;

-- "Gestor" (control total) se mantiene como alias de superadmin para las áreas
-- más sensibles: precios, anulaciones, cierres de caja y auditoría.
create or replace function public.es_gestor()
returns boolean
language sql
security definer
stable
as $$
  select public.mi_rol() = 'superadmin'
$$;

-- Cuando alguien crea su cuenta (auth.users), se le crea automáticamente su
-- perfil con rol 'cliente'. Luego la dueña / superadmin puede cambiarle el rol
-- (a empleada, administradora, etc.) desde la pantalla de Usuarios.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, telefono, cedula, rol)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'telefono', ''),
    nullif(new.raw_user_meta_data->>'cedula', ''),
    'cliente'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "cada usuario ve su propio perfil"
  on public.profiles for select
  using (id = auth.uid());

create policy "admin ve todos los perfiles"
  on public.profiles for select
  using (public.es_admin());

-- El superadmin cambia cualquier rol; el admin solo puede tocar perfiles de
-- personal/clientas (activar, especialidades) — no a otros admins ni superadmins.
create policy "gestor administra perfiles"
  on public.profiles for update
  using (public.es_super() or (public.mi_rol() = 'admin' and rol in ('personal', 'cliente')))
  with check (public.es_super() or (public.mi_rol() = 'admin' and rol in ('personal', 'cliente')));

create policy "gestor crea perfiles"
  on public.profiles for insert
  with check (public.es_admin());

-- Necesario para poder elegir a la profesional al agendar/asignar una cita:
-- cualquier usuario logueado puede ver al PERSONAL activo (no a otras clientas).
create policy "usuarios autenticados ven personal activo"
  on public.profiles for select
  using (activo = true and rol in ('personal', 'admin', 'superadmin'));

-- ---------------------------------------------------------
-- 2. Servicios ofrecidos (catálogo)
-- ---------------------------------------------------------
create table public.servicios (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  nombre text not null,
  precio_base numeric(12,2) not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (categoria, nombre)
);

alter table public.servicios enable row level security;

create policy "cualquier usuario autenticado lee servicios"
  on public.servicios for select
  using (auth.uid() is not null);

create policy "solo gestor administra servicios"
  on public.servicios for all
  using (public.es_gestor())
  with check (public.es_gestor());

-- ---------------------------------------------------------
-- 3. Registros de trabajo (el corazón del control)
--    Estos registros son INMUTABLES: nadie puede editar
--    los datos del trabajo ni borrarlos. Solo la dueña
--    puede marcarlos como "anulado" dejando rastro.
-- ---------------------------------------------------------
create table public.registros_trabajo (
  id uuid primary key default gen_random_uuid(),
  empleada_id uuid not null references public.profiles(id),
  servicio_id uuid not null references public.servicios(id),
  precio_cobrado numeric(12,2) not null check (precio_cobrado >= 0),
  descuento_porcentaje numeric(5,2) not null default 0 check (descuento_porcentaje >= 0 and descuento_porcentaje <= 100),
  -- Las especialistas NO reciben pagos, así que no registran medio de pago
  -- (queda opcional; el medio de pago lo maneja Admin en cita/cierre de caja).
  metodo_pago text check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  cliente_nombre text,
  cliente_telefono text,
  foto_url text,
  nota text,
  anulado boolean not null default false,
  motivo_anulacion text,
  anulado_por uuid references public.profiles(id),
  anulado_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.registros_trabajo enable row level security;

create policy "empleada crea sus propios registros"
  on public.registros_trabajo for insert
  with check (empleada_id = auth.uid());

create policy "empleada ve sus propios registros"
  on public.registros_trabajo for select
  using (empleada_id = auth.uid());

create policy "admin y super ven todos los registros"
  on public.registros_trabajo for select
  using (public.es_admin());

-- Solo la dueña / superadmin puede anular (nunca editar precio/servicio/cliente)
create policy "gestor puede anular registros"
  on public.registros_trabajo for update
  using (public.es_gestor())
  with check (public.es_gestor());

-- Nadie puede borrar un registro de trabajo, ni siquiera la dueña.
-- (No se crea policy de DELETE => queda bloqueado por RLS)

-- Trigger: impide modificar los datos del trabajo ya creado.
-- Solo permite tocar las columnas de anulación.
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
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de un trabajo ya registrado no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_edicion_registro_trabajo
  before update on public.registros_trabajo
  for each row execute function public.bloquear_edicion_registro_trabajo();

-- ---------------------------------------------------------
-- 4. Citas (agenda). El abono es dinero cobrado por adelantado,
--    así que se protege igual que los registros de trabajo:
--    nadie puede editar sus datos financieros ni borrarla, solo
--    cambiar el estado (confirmar / completar / cancelar).
-- ---------------------------------------------------------
create table public.citas (
  id uuid primary key default gen_random_uuid(),
  -- empleada_id es NULL mientras es una "solicitud" sin manicurista asignada
  -- (por ejemplo cuando la clienta la pide desde la app). El gestor/admin la asigna.
  empleada_id uuid references public.profiles(id),
  servicio_id uuid not null references public.servicios(id),
  -- lista completa de servicios de la cita (una clienta puede pedir varios)
  servicios_ids uuid[] not null default '{}',
  -- cliente_id apunta al perfil de la clienta cuando ella misma se registró y
  -- pidió la cita. Si la agenda el personal a nombre de alguien externo, queda NULL.
  cliente_id uuid references public.profiles(id),
  cliente_nombre text not null,
  cliente_telefono text,
  fecha date not null,
  hora time not null,
  abono numeric(12,2) not null default 0,
  abono_metodo_pago text check (abono_metodo_pago is null or abono_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  -- Saldo/excedente cobrado al completar la cita (además del abono).
  saldo_pagado numeric(12,2) not null default 0,
  saldo_metodo_pago text check (saldo_metodo_pago is null or saldo_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  obsequio text,
  nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'completada', 'cancelada')),
  motivo_cancelacion text,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.citas enable row level security;

-- Solo admin/super agendan citas. Las especialistas NO crean ni gestionan citas;
-- únicamente completan la suya al registrar el trabajo (eso es un UPDATE).
create policy "staff agenda citas"
  on public.citas for insert
  with check (
    creado_por = auth.uid()
    and public.mi_rol() in ('admin', 'superadmin')
  );

-- La clienta solo puede crear SOLICITUDES para ella misma: sin manicurista
-- asignada y sin abono (el abono lo registra el negocio cuando ella paga).
create policy "clienta solicita su propia cita"
  on public.citas for insert
  with check (
    public.mi_rol() = 'cliente'
    and creado_por = auth.uid()
    and cliente_id = auth.uid()
    and empleada_id is null
    and abono = 0
  );

create policy "clienta ve sus propias citas"
  on public.citas for select
  using (cliente_id = auth.uid());

create policy "empleada ve sus propias citas"
  on public.citas for select
  using (empleada_id = auth.uid() or creado_por = auth.uid());

create policy "admin y super ven todas las citas"
  on public.citas for select
  using (public.es_admin());

-- El personal puede actualizar (asignar profesional, confirmar, completar,
-- cancelar). Los límites de qué se puede tocar los pone el trigger de abajo.
create policy "personal actualiza citas"
  on public.citas for update
  using (empleada_id = auth.uid() or creado_por = auth.uid() or public.es_admin())
  with check (empleada_id = auth.uid() or creado_por = auth.uid() or public.es_admin());

-- Nadie puede borrar una cita ya creada.
-- (No se crea policy de DELETE => queda bloqueado por RLS)

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

  if old.estado <> 'pendiente' then
    -- Cita ya confirmada/completada/cancelada: queda congelada.
    -- Solo se permite cambiar el estado y el motivo de cancelación.
    if new.empleada_id is distinct from old.empleada_id
       or new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or new.obsequio is distinct from old.obsequio
       or new.nota is distinct from old.nota
    then
      raise exception 'Una cita ya confirmada no se puede modificar; solo se puede cambiar su estado.';
    end if;
  else
    -- Mientras está pendiente: una manicurista ya asignada no se puede cambiar
    -- por otra (para no borrar responsabilidad). Cancela y crea otra si hace falta.
    if old.empleada_id is not null and new.empleada_id is distinct from old.empleada_id then
      raise exception 'La manicurista asignada no se puede cambiar; cancela la cita y crea otra.';
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

create trigger trg_bloquear_edicion_cita
  before update on public.citas
  for each row execute function public.bloquear_edicion_cita();

-- ---------------------------------------------------------
-- 5. Cierres de caja (lo que la administradora reporta/entrega)
-- ---------------------------------------------------------
create table public.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  administradora_id uuid not null references public.profiles(id),
  efectivo_entregado numeric(12,2) not null default 0,
  nequi_reportado numeric(12,2) not null default 0,
  daviplata_reportado numeric(12,2) not null default 0,
  datafono_reportado numeric(12,2) not null default 0,
  observaciones text,
  created_at timestamptz not null default now(),
  unique (fecha, administradora_id)
);

alter table public.cierres_caja enable row level security;

create policy "admin crea su cierre del dia"
  on public.cierres_caja for insert
  with check (administradora_id = auth.uid() and public.mi_rol() in ('admin', 'superadmin'));

create policy "administradora ve sus propios cierres"
  on public.cierres_caja for select
  using (administradora_id = auth.uid());

create policy "gestor ve todos los cierres"
  on public.cierres_caja for select
  using (public.es_gestor());

-- Un cierre de caja tampoco se edita ni se borra una vez creado:
-- si hay un error, se corrige con un nuevo registro y observaciones.
-- (No se crean policies de UPDATE/DELETE => quedan bloqueadas por RLS)

-- ---------------------------------------------------------
-- 5b. Marcaciones (control horario: entrada / almuerzo / salida)
--     Cada profesional marca su propia jornada. Los registros son
--     INMUTABLES (no se editan ni se borran) para que el horario sea confiable.
-- ---------------------------------------------------------
create table public.marcaciones (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.profiles(id),
  tipo text not null check (tipo in ('entrada', 'inicio_almuerzo', 'fin_almuerzo', 'salida')),
  momento timestamptz not null default now(),
  nota text,
  created_at timestamptz not null default now()
);

alter table public.marcaciones enable row level security;

-- Cada quien marca su propia jornada.
create policy "personal registra su propia marcacion"
  on public.marcaciones for insert
  with check (
    personal_id = auth.uid()
    and public.mi_rol() in ('personal', 'admin', 'superadmin')
  );

create policy "personal ve sus propias marcaciones"
  on public.marcaciones for select
  using (personal_id = auth.uid());

-- El admin y el superadmin ven la jornada de todo el personal.
create policy "admin ve todas las marcaciones"
  on public.marcaciones for select
  using (public.es_admin());

-- Nadie edita ni borra una marcación.
-- (No se crean policies de UPDATE/DELETE => quedan bloqueadas por RLS)

-- ---------------------------------------------------------
-- 5c. Permisos y descansos
-- ---------------------------------------------------------
create table public.permisos (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.profiles(id),
  tipo text not null default 'permiso' check (tipo in ('permiso', 'descanso')),
  fecha_desde date not null,
  fecha_hasta date not null,
  motivo text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.permisos enable row level security;

create policy "persona solicita su permiso"
  on public.permisos for insert
  with check (persona_id = auth.uid() and creado_por = auth.uid());

create policy "persona ve sus permisos"
  on public.permisos for select
  using (persona_id = auth.uid());

create policy "admin ve todos los permisos"
  on public.permisos for select
  using (public.es_admin());

create policy "admin gestiona permisos"
  on public.permisos for update
  using (public.es_admin())
  with check (public.es_admin());

-- ---------------------------------------------------------
-- 5d. Préstamos / insumos fiados a cada persona
-- ---------------------------------------------------------
create table public.prestamos (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.profiles(id),
  tipo text not null default 'dinero' check (tipo in ('dinero', 'insumo')),
  descripcion text,
  monto numeric(12,2) not null default 0,
  pagado boolean not null default false,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.prestamos enable row level security;

create policy "super administra prestamos"
  on public.prestamos for all
  using (public.es_super())
  with check (public.es_super());

create policy "persona ve sus prestamos"
  on public.prestamos for select
  using (persona_id = auth.uid());

create policy "admin ve prestamos"
  on public.prestamos for select
  using (public.es_admin());

-- ---------------------------------------------------------
-- 6. Auditoría (registro inmutable de toda la actividad)
-- ---------------------------------------------------------
create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  tabla text not null,
  registro_id uuid not null,
  accion text not null,
  usuario_id uuid references public.profiles(id),
  detalle jsonb,
  created_at timestamptz not null default now()
);

alter table public.auditoria enable row level security;

create policy "solo gestor lee auditoria"
  on public.auditoria for select
  using (public.es_gestor());

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.auditoria (tabla, registro_id, accion, usuario_id, detalle)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    auth.uid(),
    to_jsonb(coalesce(new, old))
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_auditoria_registros_trabajo
  after insert or update on public.registros_trabajo
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_cierres_caja
  after insert on public.cierres_caja
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_citas
  after insert or update on public.citas
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_marcaciones
  after insert on public.marcaciones
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_permisos
  after insert or update on public.permisos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_prestamos
  after insert or update on public.prestamos
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------
-- 7. Vista de comparación diaria (para el dashboard y alertas)
--    Compara el TOTAL de servicios realizados contra el TOTAL reportado
--    en el cierre de caja (las especialistas ya no registran medio de pago).
-- ---------------------------------------------------------
create or replace view public.vista_comparacion_diaria as
select
  coalesce(r.fecha, c.fecha) as fecha,
  coalesce(r.total, 0) as total_registrado,
  coalesce(c.total, 0) as total_reportado,
  coalesce(r.total, 0) - coalesce(c.total, 0) as diferencia
from (
  select (created_at at time zone 'America/Bogota')::date as fecha, sum(precio_cobrado) as total
  from public.registros_trabajo
  where not anulado
  group by (created_at at time zone 'America/Bogota')::date
) r
full outer join (
  select fecha,
         sum(efectivo_entregado + nequi_reportado + daviplata_reportado + datafono_reportado) as total
  from public.cierres_caja
  group by fecha
) c on r.fecha = c.fecha
order by fecha desc;

-- ---------------------------------------------------------
-- 8. Storage: bucket para fotos de evidencia
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', false)
on conflict (id) do nothing;

create policy "usuarios autenticados suben evidencias"
  on storage.objects for insert
  with check (bucket_id = 'evidencias' and auth.uid() is not null);

create policy "usuarios autenticados ven evidencias"
  on storage.objects for select
  using (bucket_id = 'evidencias' and auth.uid() is not null);

-- El admin / superadmin puede borrar fotos (retención automática de 1 mes).
create policy "gestor borra evidencias"
  on storage.objects for delete
  using (bucket_id = 'evidencias' and public.es_admin());
