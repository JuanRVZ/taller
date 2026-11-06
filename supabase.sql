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

-- v2: administrador (juanravaz@icloud.com) puede LEER los de todos; los mecánicos solo los suyos
alter table presupuestos add column email text default (auth.jwt()->>'email');
create policy "admin lee todo" on presupuestos
  for select using (auth.jwt()->>'email' = 'juanravaz@icloud.com');

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
create policy "admin lee todo" on clientes for select using (auth.jwt()->>'email' = 'juanravaz@icloud.com');
create policy "admin lee todo" on vehiculos for select using (auth.jwt()->>'email' = 'juanravaz@icloud.com');
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
create policy "admin lee todo" on perfiles for select using (auth.jwt()->>'email' = 'juanravaz@icloud.com');
alter table presupuestos add column taller text, add column taller_datos text;

-- v6: cerrar presupuestos (trabajo ya hecho)
do $$ declare c text; begin
  select conname into c from pg_constraint
   where conrelid = 'presupuestos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%estado%';
  if c is not null then execute format('alter table presupuestos drop constraint %I', c); end if;
end $$;
alter table presupuestos add constraint presupuestos_estado_check check (estado in ('pendiente','aceptado','rechazado','cerrado'));
alter table presupuestos add column cerrado_at timestamptz;
