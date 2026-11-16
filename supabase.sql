-- Ejecuta esto en Supabase > SQL Editor
create table presupuestos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero bigint generated always as identity,
  cliente text not null,
  telefono text,
  matricula text,
  vehiculo text,
  notas text,
  lineas jsonb not null default '[]',
  iva numeric not null default 21,
  total numeric not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente','aceptado','rechazado')),
  created_at timestamptz not null default now()
);

alter table presupuestos enable row level security;

-- Cada mecánico solo ve y toca lo suyo
create policy "propios" on presupuestos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index on presupuestos (user_id, created_at desc);

-- v2: administrador (email del administrador; desde v11 se usa la tabla admins) puede LEER los de todos; los mecánicos solo los suyos
alter table presupuestos add column email text default (auth.jwt()->>'email');
create policy "admin lee todo" on presupuestos
  for select using (auth.jwt()->>'email' = '<email-del-administrador>');

-- v3: fichas de cliente, vehículos e historial de mantenimiento
create table clientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email_mecanico text default (auth.jwt()->>'email'),
  nombre text not null,
  apellidos text,
  telefono text,
  email text,
  notas text,
  created_at timestamptz not null default now()
);
create table vehiculos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  vehiculo text,
  matricula text,
  anio int,
  created_at timestamptz not null default now()
);
alter table presupuestos
  add column cliente_id uuid references clientes(id) on delete set null,
  add column vehiculo_id uuid references vehiculos(id) on delete set null,
  add column km integer;

alter table clientes enable row level security;
alter table vehiculos enable row level security;
create policy "propios" on clientes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "propios" on vehiculos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admin lee todo" on clientes for select using (auth.jwt()->>'email' = '<email-del-administrador>');
create policy "admin lee todo" on vehiculos for select using (auth.jwt()->>'email' = '<email-del-administrador>');
create index on clientes (user_id, nombre);
create index on vehiculos (cliente_id);
create index on presupuestos (cliente_id);

-- v4: margen del mecánico sobre las piezas (sustituye al IVA)
alter table presupuestos add column margen numeric not null default 0;
alter table presupuestos alter column iva set default 0;

-- v5: perfil del mecánico y datos del taller en cada presupuesto
create table perfiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  taller text,
  datos text,
  margen_defecto numeric,
  precio_hora numeric,
  updated_at timestamptz not null default now()
);
alter table perfiles enable row level security;
create policy "propio" on perfiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admin lee todo" on perfiles for select using (auth.jwt()->>'email' = '<email-del-administrador>');
alter table presupuestos add column taller text, add column taller_datos text;

-- v6: cerrar presupuestos (trabajo ya hecho)
do $$ declare c text; begin
  select conname into c from pg_constraint
   where conrelid = 'presupuestos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%estado%';
  if c is not null then execute format('alter table presupuestos drop constraint %I', c); end if;
end $$;
alter table presupuestos add constraint presupuestos_estado_check check (estado in ('pendiente','aceptado','rechazado','cerrado'));
alter table presupuestos add column cerrado_at timestamptz;

-- v7: numeración propia por mecánico + cobro
alter table presupuestos
  add column n_taller integer,
  add column pagado boolean not null default false,
  add column pagado_at timestamptz,
  add column forma_pago text;

create or replace function asignar_n_taller() returns trigger language plpgsql as $$
begin
  select coalesce(max(n_taller), 0) + 1 into new.n_taller from presupuestos where user_id = new.user_id;
  return new;
end $$;
create trigger trg_n_taller before insert on presupuestos for each row execute function asignar_n_taller();

update presupuestos p set n_taller = r.rn
  from (select id, row_number() over (partition by user_id order by created_at, numero) rn from presupuestos) r
  where p.id = r.id and p.n_taller is null;
create unique index presupuestos_user_n on presupuestos (user_id, n_taller);

-- v8: gastos fijos, fotos (almacenamiento privado con tope de tamaño), anticipos, notas internas, objetivo y último acceso
alter table perfiles
  add column ultimo_acceso timestamptz,
  add column objetivo_mensual numeric,
  add column email text default (auth.jwt()->>'email');
alter table presupuestos
  add column anticipo numeric not null default 0,
  add column notas_internas text;

create table gastos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text default (auth.jwt()->>'email'),
  concepto text not null,
  categoria text,
  importe numeric not null check (importe >= 0),
  fecha date not null default current_date,
  mensual boolean not null default false,
  hasta date,
  created_at timestamptz not null default now()
);
alter table gastos enable row level security;
create policy "propios" on gastos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admin lee todo" on gastos for select using (auth.jwt()->>'email' = '<email-del-administrador>');

create table fotos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presupuesto_id uuid not null references presupuestos(id) on delete cascade,
  path text not null,
  bytes integer not null,
  created_at timestamptz not null default now()
);
alter table fotos enable row level security;
create policy "propias" on fotos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admin lee todo" on fotos for select using (auth.jwt()->>'email' = '<email-del-administrador>');
create index on fotos (presupuesto_id);

-- Almacenamiento privado: máx. 300 KB por foto (tope duro para proteger el 1 GB del plan gratis)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 300000, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;
create policy "fotos: ver las propias" on storage.objects for select
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos: subir a mi carpeta" on storage.objects for insert
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos: borrar las propias" on storage.objects for delete
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos: el admin ve todas" on storage.objects for select
  using (bucket_id = 'fotos' and auth.jwt()->>'email' = '<email-del-administrador>');

-- v9: cobro repartido entre efectivo y bizum; forma de pago del anticipo
alter table presupuestos
  add column pago_efectivo numeric not null default 0,
  add column pago_bizum numeric not null default 0,
  add column anticipo_forma text not null default 'efectivo';
update presupuestos set pago_bizum = greatest(total - anticipo, 0) where pagado and forma_pago ilike '%bizum%';
update presupuestos set pago_efectivo = greatest(total - anticipo, 0) where pagado and coalesce(forma_pago, '') not ilike '%bizum%';

-- v10: "latido" para que Supabase gratis no pause el proyecto (una ESCRITURA real en la base de datos, cada día)
create table if not exists latido (
  id int primary key default 1 check (id = 1),
  ultimo timestamptz not null default now(),
  veces bigint not null default 0
);
insert into latido (id) values (1) on conflict (id) do nothing;
alter table latido enable row level security;   -- sin políticas: nadie puede leer ni escribir la tabla directamente
create or replace function registrar_latido() returns bigint language sql security definer set search_path = public as $$
  update latido set ultimo = now(), veces = veces + 1 where id = 1 returning veces;
$$;
revoke all on function registrar_latido() from public;
grant execute on function registrar_latido() to anon, authenticated;

-- v11: correcciones de la auditoría de seguridad (S3, S4, S5, S6, S7). Detalle en SEGURIDAD.md (fuera de git).
-- Las reglas nuevas son "to authenticated": a quien no tiene sesión no le aplican y sigue sin ver nada.

-- S3 · el administrador se decide por su id de usuario (tabla admins), no por el email
create table if not exists admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table admins enable row level security;   -- sin políticas: nadie la lee ni la cambia desde la app
create or replace function es_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
revoke all on function es_admin() from public, anon, authenticated;
grant execute on function es_admin() to authenticated;
-- El administrador se añade UNA vez a mano en el SQL Editor (aquí no, para no publicar su email):
--   insert into admins (user_id) select id from auth.users where email = '<email del administrador>';

drop policy if exists "admin lee todo" on presupuestos;
create policy "admin lee todo" on presupuestos for select to authenticated using (es_admin());
drop policy if exists "admin lee todo" on clientes;
create policy "admin lee todo" on clientes for select to authenticated using (es_admin());
drop policy if exists "admin lee todo" on vehiculos;
create policy "admin lee todo" on vehiculos for select to authenticated using (es_admin());
drop policy if exists "admin lee todo" on perfiles;
create policy "admin lee todo" on perfiles for select to authenticated using (es_admin());
drop policy if exists "admin lee todo" on gastos;
create policy "admin lee todo" on gastos for select to authenticated using (es_admin());
drop policy if exists "admin lee todo" on fotos;
create policy "admin lee todo" on fotos for select to authenticated using (es_admin());
drop policy if exists "fotos: el admin ve todas" on storage.objects;
create policy "fotos: el admin ve todas" on storage.objects for select to authenticated using (bucket_id = 'fotos' and public.es_admin());

-- S5 · solo se puede enlazar con clientes, coches y presupuestos propios
drop policy if exists "propios" on presupuestos;
create policy "propios" on presupuestos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and (presupuestos.cliente_id is null or exists (select 1 from clientes c where c.id = presupuestos.cliente_id and c.user_id = auth.uid()))
    and (presupuestos.vehiculo_id is null or exists (select 1 from vehiculos v where v.id = presupuestos.vehiculo_id and v.user_id = auth.uid())));
drop policy if exists "propios" on vehiculos;
create policy "propios" on vehiculos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from clientes c where c.id = vehiculos.cliente_id and c.user_id = auth.uid()));
drop policy if exists "propias" on fotos;
create policy "propias" on fotos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from presupuestos p where p.id = fotos.presupuesto_id and p.user_id = auth.uid()));

-- S4 · el email del mecánico lo pone la base de datos, no quien escribe
create or replace function fijar_email_usuario() returns trigger
  language plpgsql security definer set search_path = public as $$
declare e text;
begin
  select email into e from auth.users where id = new.user_id;
  if tg_table_name = 'clientes' then new.email_mecanico := e; else new.email := e; end if;
  return new;
end $$;
revoke all on function fijar_email_usuario() from public, anon, authenticated;
drop trigger if exists trg_email on presupuestos; create trigger trg_email before insert or update on presupuestos for each row execute function fijar_email_usuario();
drop trigger if exists trg_email on clientes;     create trigger trg_email before insert or update on clientes     for each row execute function fijar_email_usuario();
drop trigger if exists trg_email on gastos;       create trigger trg_email before insert or update on gastos       for each row execute function fijar_email_usuario();
drop trigger if exists trg_email on perfiles;     create trigger trg_email before insert or update on perfiles     for each row execute function fijar_email_usuario();
update presupuestos set user_id = user_id; update clientes set user_id = user_id; update gastos set user_id = user_id; update perfiles set user_id = user_id;

-- S6 · límites en el servidor (antes solo los ponía la web)
alter table presupuestos
  add constraint lineas_es_lista check (jsonb_typeof(lineas) = 'array' and pg_column_size(lineas) < 200000),
  add constraint textos_presupuesto check (char_length(cliente) <= 200 and char_length(coalesce(telefono, '')) <= 40
    and char_length(coalesce(matricula, '')) <= 20 and char_length(coalesce(vehiculo, '')) <= 120
    and char_length(coalesce(notas, '')) <= 4000 and char_length(coalesce(notas_internas, '')) <= 4000
    and char_length(coalesce(taller, '')) <= 200 and char_length(coalesce(taller_datos, '')) <= 2000 and char_length(coalesce(forma_pago, '')) <= 40),
  add constraint importes_validos check (anticipo >= 0 and pago_efectivo >= 0 and pago_bizum >= 0 and margen between 0 and 1000 and (km is null or km >= 0)),
  add constraint anticipo_forma_valida check (anticipo_forma in ('efectivo', 'bizum'));
alter table clientes add constraint textos_cliente check (char_length(nombre) <= 120 and char_length(coalesce(apellidos, '')) <= 160
  and char_length(coalesce(telefono, '')) <= 40 and char_length(coalesce(email, '')) <= 200 and char_length(coalesce(notas, '')) <= 4000);
alter table vehiculos add constraint textos_vehiculo check (char_length(coalesce(vehiculo, '')) <= 120 and char_length(coalesce(matricula, '')) <= 20
  and (anio is null or anio between 1900 and 2100));
alter table gastos add constraint textos_gasto check (char_length(concepto) <= 200 and char_length(coalesce(categoria, '')) <= 80);
alter table perfiles add constraint textos_perfil check (char_length(coalesce(taller, '')) <= 120 and char_length(coalesce(datos, '')) <= 1000);
alter table fotos add constraint bytes_validos check (bytes between 1 and 300000), add constraint ruta_valida check (char_length(path) <= 300);

create or replace function limitar_fotos() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from fotos where presupuesto_id = new.presupuesto_id) >= 10 then
    raise exception 'Máximo 10 fotos por presupuesto';
  end if;
  return new;
end $$;
revoke all on function limitar_fotos() from public, anon, authenticated;
drop trigger if exists trg_limitar_fotos on fotos;
create trigger trg_limitar_fotos before insert on fotos for each row execute function limitar_fotos();

-- Subir al almacenamiento: solo a la carpeta de un presupuesto propio, máx. 10 fotos por presupuesto y 1500 por mecánico (~150 MB)
create or replace function puede_subir_foto(ruta text) returns boolean
  language sql stable security definer set search_path = public, storage as $$
  select (storage.foldername(ruta))[1] = auth.uid()::text
     and exists (select 1 from public.presupuestos p where p.id::text = (storage.foldername(ruta))[2] and p.user_id = auth.uid())
     and (select count(*) from storage.objects o where o.bucket_id = 'fotos' and o.name like auth.uid()::text || '/' || (storage.foldername(ruta))[2] || '/%') < 10
     and (select count(*) from storage.objects o where o.bucket_id = 'fotos' and o.name like auth.uid()::text || '/%') < 1500
$$;
revoke all on function puede_subir_foto(text) from public, anon, authenticated;
grant execute on function puede_subir_foto(text) to authenticated;
drop policy if exists "fotos: subir a mi carpeta" on storage.objects;
create policy "fotos: subir a mi carpeta" on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and public.puede_subir_foto(name));

-- S7 · registro de lo que hace la función de usuarios (solo lo lee el administrador)
create table if not exists auditoria (
  id bigint generated always as identity primary key,
  quien uuid, accion text not null, objetivo uuid,
  cuando timestamptz not null default now()
);
alter table auditoria enable row level security;
drop policy if exists "admin lee auditoria" on auditoria;
create policy "admin lee auditoria" on auditoria for select to authenticated using (es_admin());
