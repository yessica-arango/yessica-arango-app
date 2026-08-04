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
  duracion_minutos integer not null default 30,
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
-- 2b. Productos (inventario). Se crean "poco a poco": solo la dueña
--     (superadmin) da de alta productos, precios y ajusta el stock.
-- ---------------------------------------------------------
create table public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  precio_venta numeric(12,2) not null default 0 check (precio_venta >= 0),
  costo numeric(12,2) check (costo is null or costo >= 0),
  stock integer not null default 0 check (stock >= 0),
  activo boolean not null default true,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.productos enable row level security;

create policy "gestor administra productos"
  on public.productos for all
  using (public.es_super())
  with check (public.es_super());

create policy "admin ve productos"
  on public.productos for select
  using (public.es_admin());

-- ---------------------------------------------------------
-- 2c. Obsequios (catálogo de cortesías, ej. Veloterapia). Solo la dueña
--     (superadmin) puede agregar más aparte de los predeterminados.
-- ---------------------------------------------------------
create table public.obsequios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.obsequios enable row level security;

create policy "gestor administra obsequios"
  on public.obsequios for all
  using (public.es_super())
  with check (public.es_super());

create policy "admin ve obsequios"
  on public.obsequios for select
  using (public.es_admin());

insert into public.obsequios (nombre, creado_por)
select nombre, (select id from public.profiles where rol = 'superadmin' order by created_at limit 1)
from (values
  ('Veloterapia'), ('Chocolaterapia'), ('Mascarilla menta'),
  ('Polvo espumoso'), ('Jelly spa'), ('Parafina')
) as v(nombre)
where exists (select 1 from public.profiles where rol = 'superadmin')
on conflict (nombre) do nothing;

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
  -- visita_id agrupa los servicios registrados juntos para una misma clienta;
  -- la administradora cobra la visita completa (tabla cobros).
  visita_id uuid,
  -- cita_id enlaza el registro con la cita agendada (si vino de una).
  -- (La FK se agrega más abajo, después de crear la tabla citas.)
  cita_id uuid,
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
     or new.visita_id is distinct from old.visita_id
     or new.cita_id is distinct from old.cita_id
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
  -- Horario de atención del salón: 9:00am a 8:00pm. Ninguna cita puede
  -- agendarse fuera de este rango, sin importar desde dónde se cree.
  hora time not null check (hora >= '09:00' and hora <= '20:00'),
  -- Sin tope de hora_fin: la hora de INICIO debe caer en el horario de
  -- atención, pero un servicio que empieza cerca del cierre puede terminar
  -- después (ej: empieza 7pm, dura 2 horas, termina 9pm).
  hora_fin time,
  abono numeric(12,2) not null default 0,
  abono_metodo_pago text check (abono_metodo_pago is null or abono_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  -- Foto del comprobante del abono (la clienta la sube al pedir la cita).
  abono_foto_url text,
  -- Saldo/excedente cobrado al completar la cita (además del abono).
  saldo_pagado numeric(12,2) not null default 0,
  saldo_metodo_pago text check (saldo_metodo_pago is null or saldo_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  obsequio text,
  nota text,
  -- Cuando se pide el servicio "Adicional" (monto y concepto libre, ej. un
  -- diseño de uñas especial), aquí se guarda el nombre y el valor que la
  -- clienta o el personal escribieron al agendar.
  adicional_concepto text,
  adicional_valor numeric(12,2) check (adicional_valor is null or adicional_valor >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'completada', 'cancelada')),
  motivo_cancelacion text,
  -- Se marca en true cuando se reprograma (cambia fecha/hora) una cita ya
  -- confirmada, para avisar en la campanita. Se apaga al "marcar como visto".
  reprogramada boolean not null default false,
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

-- La clienta solo puede crear SOLICITUDES para ella misma. Registra su abono
-- (monto + medio de pago + foto del comprobante) al pedir la cita.
create policy "clienta solicita su propia cita"
  on public.citas for insert
  with check (
    public.mi_rol() = 'cliente'
    and creado_por = auth.uid()
    and cliente_id = auth.uid()
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

  -- La profesional solo se congela cuando la cita ya está completada o cancelada
  -- (antes se puede asignar o cambiar).
  if old.estado in ('completada', 'cancelada') and new.empleada_id is distinct from old.empleada_id then
    raise exception 'No se puede cambiar la profesional de una cita completada o cancelada.';
  end if;

  -- Fecha/hora se pueden reprogramar (la clienta cambia de opinión o hubo un
  -- error) mientras la cita no esté completada ni cancelada. Una vez asistida
  -- o cancelada, quedan congeladas como registro histórico.
  if old.estado in ('completada', 'cancelada') and (
       new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
     ) then
    raise exception 'No se puede reprogramar una cita ya completada o cancelada.';
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

  if old.estado <> 'pendiente' then
    -- Cita ya confirmada/completada/cancelada: los datos quedan congelados
    -- (salvo estado, profesional, fecha/hora, aviso de reprogramación y saldo).
    if new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or (new.abono_foto_url is distinct from old.abono_foto_url and new.abono_foto_url is not null)
       or new.obsequio is distinct from old.obsequio
       or new.nota is distinct from old.nota
       or new.adicional_concepto is distinct from old.adicional_concepto
       or new.adicional_valor is distinct from old.adicional_valor
    then
      raise exception 'Una cita ya confirmada no se puede modificar; solo estado, profesional, fecha/hora y saldo.';
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

-- FK pendiente: registros_trabajo.cita_id (la tabla citas ya existe aquí).
alter table public.registros_trabajo
  add constraint registros_trabajo_cita_id_fkey
  foreign key (cita_id) references public.citas(id);

create index if not exists idx_registros_visita on public.registros_trabajo(visita_id);

-- ---------------------------------------------------------
-- 4b. Cobros: lo que la administradora recibe de la clienta.
--     La profesional NO toca dinero: al registrar el trabajo se genera una
--     "cuenta por cobrar" (la visita) y la administradora la cobra aquí,
--     eligiendo el medio de pago y subiendo la foto del pago.
--     Puede haber más de un cobro por visita (ej: mitad efectivo, mitad Nequi).
-- ---------------------------------------------------------
create table public.cobros (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null,
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  -- Foto del comprobante del pago (obligatoria en la app para pagos digitales).
  foto_url text,
  nota text,
  cobrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_cobros_visita on public.cobros(visita_id);

alter table public.cobros enable row level security;

-- Solo admin y superadmin manejan cobros.
create policy "admin registra cobros"
  on public.cobros for insert
  with check (public.es_admin() and cobrado_por = auth.uid());

create policy "admin ve cobros"
  on public.cobros for select
  using (public.es_admin());

-- Sin policy de DELETE: un cobro registrado no se borra (anti-fraude).
-- El UPDATE solo existe para limpiar la foto (retención); el trigger lo limita.
create policy "gestor limpia foto de cobro"
  on public.cobros for update
  using (public.es_gestor())
  with check (public.es_gestor());

create or replace function public.bloquear_edicion_cobro()
returns trigger
language plpgsql
as $$
begin
  if new.visita_id is distinct from old.visita_id
     or new.monto is distinct from old.monto
     or new.metodo_pago is distinct from old.metodo_pago
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.cobrado_por is distinct from old.cobrado_por
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Un cobro registrado no se puede modificar.';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_edicion_cobro
  before update on public.cobros
  for each row execute function public.bloquear_edicion_cobro();

-- ---------------------------------------------------------
-- 5. Cierres de caja (lo que la administradora reporta/entrega)
-- ---------------------------------------------------------
create table public.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  administradora_id uuid not null references public.profiles(id),
  base numeric(12,2) not null default 0,
  efectivo_entregado numeric(12,2) not null default 0,
  nequi_reportado numeric(12,2) not null default 0,
  daviplata_reportado numeric(12,2) not null default 0,
  datafono_reportado numeric(12,2) not null default 0,
  -- Pago a proveedores hecho ese día (salida de caja).
  proveedor_monto numeric(12,2) not null default 0,
  proveedor_metodo_pago text check (proveedor_metodo_pago is null or proveedor_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  proveedor_nota text,
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
  hora_desde time,
  hora_hasta time,
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

-- El superadmin puede registrar permisos/descansos para cualquier persona.
create policy "super registra permisos de cualquiera"
  on public.permisos for insert
  with check (public.es_super());

-- Aprobar/rechazar permisos: solo el superadmin.
create policy "super gestiona permisos"
  on public.permisos for update
  using (public.es_super())
  with check (public.es_super());

-- ---------------------------------------------------------
-- 5d. Préstamos / insumos fiados a cada persona
-- ---------------------------------------------------------
create table public.prestamos (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.profiles(id),
  tipo text not null default 'dinero' check (tipo in ('dinero', 'insumo')),
  descripcion text,
  monto numeric(12,2) not null default 0,
  metodo_pago text check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  pagado boolean not null default false,
  -- Si el insumo fiado es un producto del inventario, se enlaza aquí y se
  -- descuenta el stock automáticamente (ver trigger más abajo).
  producto_id uuid references public.productos(id),
  cantidad integer check (cantidad is null or cantidad > 0),
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
-- 5d-2. Pagos de préstamos (ledger): permite abonos parciales con medio de
--       pago para que el cierre de caja pueda reflejarlos. Inmutable: no hay
--       policy de update/delete, así que ningún pago se puede alterar.
-- ---------------------------------------------------------
create table public.prestamo_pagos (
  id uuid primary key default gen_random_uuid(),
  prestamo_id uuid not null references public.prestamos(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  nota text,
  pagado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_prestamo_pagos_prestamo on public.prestamo_pagos(prestamo_id);

alter table public.prestamo_pagos enable row level security;

create policy "super registra pagos de prestamo"
  on public.prestamo_pagos for insert
  with check (public.es_super() and pagado_por = auth.uid());

create policy "admin ve pagos de prestamo"
  on public.prestamo_pagos for select
  using (public.es_admin());

-- Descuenta el stock cuando el préstamo (insumo fiado) está enlazado a un
-- producto del inventario. Bloqueo de fila para evitar carreras.
create or replace function public.descontar_stock_prestamo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
begin
  if new.producto_id is null then
    return new;
  end if;
  select stock into v_stock from public.productos where id = new.producto_id for update;
  if v_stock is null then
    raise exception 'Producto no encontrado.';
  end if;
  if v_stock < coalesce(new.cantidad, 1) then
    raise exception 'No hay suficiente stock de este producto (disponible: %).', v_stock;
  end if;
  update public.productos set stock = stock - coalesce(new.cantidad, 1) where id = new.producto_id;
  return new;
end;
$$;

create trigger trg_descontar_stock_prestamo
  after insert on public.prestamos
  for each row execute function public.descontar_stock_prestamo();

-- ---------------------------------------------------------
-- 5d-3. Ventas: venta de un producto de la vitrina a una clienta o
--       cualquier persona (distinto del fiado a empleadas, que es por
--       Préstamos). Descuenta el stock automáticamente. Inmutable salvo
--       anulación (igual que registros_trabajo).
-- ---------------------------------------------------------
create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  total numeric(12,2) not null check (total >= 0),
  cliente_nombre text,
  -- El pago real (uno o varios medios) se registra en venta_pagos, ver más
  -- abajo. Estas dos columnas quedan solo por compatibilidad con ventas viejas.
  metodo_pago text check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  foto_url text,
  nota text,
  vendido_por uuid not null references public.profiles(id),
  anulado boolean not null default false,
  motivo_anulacion text,
  anulado_por uuid references public.profiles(id),
  anulado_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ventas enable row level security;

create policy "admin registra ventas"
  on public.ventas for insert
  with check (public.es_admin() and vendido_por = auth.uid());

create policy "admin ve ventas"
  on public.ventas for select
  using (public.es_admin());

create policy "gestor anula ventas"
  on public.ventas for update
  using (public.es_gestor())
  with check (public.es_gestor());

-- Nadie borra una venta ya registrada (No se crea policy de DELETE).

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
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de una venta ya registrada no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_edicion_venta
  before update on public.ventas
  for each row execute function public.bloquear_edicion_venta();

-- Descuenta el stock al registrar la venta (con bloqueo de fila para evitar
-- que dos ventas simultáneas dejen el stock en negativo).
create or replace function public.descontar_stock_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
begin
  select stock into v_stock from public.productos where id = new.producto_id for update;
  if v_stock is null then
    raise exception 'Producto no encontrado.';
  end if;
  if v_stock < new.cantidad then
    raise exception 'No hay suficiente stock de este producto (disponible: %).', v_stock;
  end if;
  update public.productos set stock = stock - new.cantidad where id = new.producto_id;
  return new;
end;
$$;

create trigger trg_descontar_stock_venta
  after insert on public.ventas
  for each row execute function public.descontar_stock_venta();

-- Si se anula una venta, el producto vuelve al inventario.
create or replace function public.restaurar_stock_venta_anulada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.anulado = true and old.anulado = false then
    update public.productos set stock = stock + old.cantidad where id = old.producto_id;
  end if;
  return new;
end;
$$;

create trigger trg_restaurar_stock_venta_anulada
  after update on public.ventas
  for each row execute function public.restaurar_stock_venta_anulada();

-- ---------------------------------------------------------
-- 5d-4. Pagos de una venta: permite pagar una sola venta con varios medios
--       (ej. mitad efectivo, mitad Nequi) en un solo formulario. Igual que
--       cobros: inmutable, cada línea con su propia foto si aplica.
-- ---------------------------------------------------------
create table public.venta_pagos (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  foto_url text,
  pagado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_venta_pagos_venta on public.venta_pagos(venta_id);

alter table public.venta_pagos enable row level security;

create policy "admin registra pagos de venta"
  on public.venta_pagos for insert
  with check (public.es_admin() and pagado_por = auth.uid());

create policy "admin ve pagos de venta"
  on public.venta_pagos for select
  using (public.es_admin());

-- ---------------------------------------------------------
-- 5e. Disponibilidad de profesionales (para evitar cruces de horario)
-- ---------------------------------------------------------
create or replace function public.profesionales_disponibles(p_fecha date, p_desde time, p_hasta time)
returns table (id uuid, nombre text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.nombre
  from public.profiles p
  where p.rol = 'personal' and p.activo = true
    and not exists (
      select 1 from public.citas c
      where c.empleada_id = p.id
        and c.fecha = p_fecha
        and c.estado <> 'cancelada'
        and c.hora < p_hasta
        and coalesce(c.hora_fin, c.hora) > p_desde
    )
  order by p.nombre;
$$;

grant execute on function public.profesionales_disponibles(date, time, time) to anon, authenticated;

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

create trigger trg_auditoria_cobros
  after insert or update on public.cobros
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

create trigger trg_auditoria_prestamo_pagos
  after insert on public.prestamo_pagos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_productos
  after insert or update on public.productos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_obsequios
  after insert or update on public.obsequios
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_ventas
  after insert or update on public.ventas
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_venta_pagos
  after insert on public.venta_pagos
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

-- ---------------------------------------------------------
-- 9. Acceso: la dueña puede cambiar el usuario/correo de acceso y la
--    contraseña de cualquier persona, sin pasar por el Dashboard de Supabase.
-- ---------------------------------------------------------
create extension if not exists pgcrypto;

create or replace function public.admin_actualizar_acceso(
  p_user_id uuid,
  p_nuevo_usuario text default null,
  p_nueva_password text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text;
begin
  if not public.es_super() then
    raise exception 'Solo la dueña puede cambiar el acceso de un usuario.';
  end if;

  if p_nuevo_usuario is not null and length(trim(p_nuevo_usuario)) > 0 then
    v_email := lower(trim(p_nuevo_usuario));
    if position('@' in v_email) = 0 then
      v_email := v_email || '@yessica-arango.app';
    end if;
    update auth.users set email = v_email where id = p_user_id;
  end if;

  if p_nueva_password is not null and length(p_nueva_password) > 0 then
    if length(p_nueva_password) < 6 then
      raise exception 'La contraseña debe tener al menos 6 caracteres.';
    end if;
    update auth.users set encrypted_password = crypt(p_nueva_password, gen_salt('bf')) where id = p_user_id;
  end if;
end;
$$;

grant execute on function public.admin_actualizar_acceso(uuid, text, text) to authenticated;
