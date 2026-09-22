-- =========================================================
-- MIGRACIÓN — Devolver o dejar registrado el abono de una clienta SIN cuenta.
--
-- Muchas citas se agendan solo con el nombre de la clienta (no tiene cuenta
-- en la app). Al cancelar una de esas citas y devolverle el abono, el
-- registro fallaba: "null value in column cliente_id of relation
-- creditos_clientes violates not-null constraint".
--
-- Ahora cliente_id puede quedar vacío y se guarda el nombre tal como está en
-- la cita. El saldo a favor (crédito) SÍ sigue necesitando cuenta, porque se
-- le descuenta en su próxima cita y para eso hay que saber quién es.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.creditos_clientes alter column cliente_id drop not null;

alter table public.creditos_clientes add column if not exists cliente_nombre text;

alter table public.creditos_clientes drop constraint if exists creditos_credito_necesita_cuenta;
alter table public.creditos_clientes
  add constraint creditos_credito_necesita_cuenta
  check (resolucion <> 'credito' or cliente_id is not null) not valid;
