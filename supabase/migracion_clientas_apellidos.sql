-- =========================================================
-- MIGRACIÓN — guardar apellidos al crear una cuenta (signUp)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- El trigger que crea el perfil al registrarse (auth.users -> profiles) no
-- guardaba "apellidos" del metadata del signUp; ahora las clientas tienen
-- nombre y apellidos por separado.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, apellidos, telefono, cedula, rol)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'apellidos', ''),
    nullif(new.raw_user_meta_data->>'telefono', ''),
    nullif(new.raw_user_meta_data->>'cedula', ''),
    'cliente'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
