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
