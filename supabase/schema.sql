-- =============================================================================
-- Dojo Ledger — Paso 1: Motor de Tracking y Economía Base
-- Esquema de base de datos para Supabase (PostgreSQL)
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Orden:        1) schema.sql   2) seed.sql
-- =============================================================================

-- Extensión para generar UUIDs (Supabase la trae, esto es idempotente).
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Tipos (enums)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'time_block') then
    create type public.time_block as enum ('Madrugada', 'Viaje', 'Tarde', 'Noche');
  end if;

  if not exists (select 1 from pg_type where typname = 'habit_status') then
    create type public.habit_status as enum ('NONE', 'MET', 'SURPASSED');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Tabla: wallet  (una única fila para el usuario del MVP)
-- -----------------------------------------------------------------------------
create table if not exists public.wallet (
  id         uuid primary key default gen_random_uuid(),
  balance    integer not null default 0,
  updated_at timestamptz not null default now(),
  -- El MVP es de un único usuario: forzamos que exista una sola billetera.
  singleton  boolean not null default true,
  constraint wallet_singleton_unique unique (singleton)
);

-- -----------------------------------------------------------------------------
-- Tabla: habits
-- -----------------------------------------------------------------------------
create table if not exists public.habits (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  time_block public.time_block not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists habits_time_block_idx on public.habits (time_block, sort_order);

-- -----------------------------------------------------------------------------
-- Tabla: logs  (un registro por hábito y por día)
-- -----------------------------------------------------------------------------
create table if not exists public.logs (
  id         uuid primary key default gen_random_uuid(),
  habit_id   uuid not null references public.habits (id) on delete cascade,
  date       date not null default current_date,
  status     public.habit_status not null default 'NONE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Clave para el upsert "un log por hábito por día".
  constraint logs_habit_date_unique unique (habit_id, date)
);

create index if not exists logs_date_idx on public.logs (date);

-- =============================================================================
-- Economía: recompensas por estado
--   NONE = 0 · MET = 50 · SURPASSED = 150
-- El balance se ajusta SIEMPRE por la DIFERENCIA entre el valor nuevo y el
-- anterior, de modo que cambiar de estado (incluido volver a 'NONE') resta
-- o suma exactamente lo que corresponde.  Ej.: SURPASSED -> MET = -100.
-- =============================================================================
create or replace function public.status_value(p_status public.habit_status)
returns integer
language sql
immutable
as $$
  select case p_status
           when 'MET'       then 50
           when 'SURPASSED' then 150
           else 0
         end;
$$;

-- -----------------------------------------------------------------------------
-- RPC atómico: setea el estado de un hábito para una fecha y ajusta la wallet.
-- Devuelve el balance autoritativo + el estado persistido.
-- El frontend lo llama vía una Server Action (ver src/actions/habits.ts).
-- -----------------------------------------------------------------------------
create or replace function public.set_habit_status(
  p_habit_id uuid,
  p_date     date,
  p_status   public.habit_status
)
returns table (balance integer, log_status public.habit_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.habit_status;
  v_delta integer;
  v_balance integer;
begin
  -- Estado previo para ese hábito+día (NONE si aún no existe).
  select l.status into v_old
  from public.logs l
  where l.habit_id = p_habit_id and l.date = p_date;

  v_old := coalesce(v_old, 'NONE');

  -- Diferencia de monedas a aplicar.
  v_delta := public.status_value(p_status) - public.status_value(v_old);

  -- Upsert del log (un registro por hábito por día).
  insert into public.logs (habit_id, date, status)
  values (p_habit_id, p_date, p_status)
  on conflict (habit_id, date)
  do update set status = excluded.status, updated_at = now();

  -- Aseguramos que exista la billetera única y aplicamos el delta.
  insert into public.wallet (balance) values (0)
  on conflict (singleton) do nothing;

  update public.wallet
  set balance = balance + v_delta, updated_at = now()
  returning wallet.balance into v_balance;

  return query select v_balance, p_status;
end;
$$;

-- =============================================================================
-- Row Level Security (RLS)
-- -----------------------------------------------------------------------------
-- ⚠️  MVP SIN AUTENTICACIÓN (Paso 1).  Habilitamos RLS pero con políticas
--     permisivas para el rol anónimo, de modo que la app funcione con la
--     ANON KEY sin login.  En el Paso de Auth reemplazá estas políticas por
--     `auth.uid()`-based y quitá el acceso anónimo.
-- =============================================================================
alter table public.wallet enable row level security;
alter table public.habits enable row level security;
alter table public.logs   enable row level security;

do $$
begin
  -- wallet
  if not exists (select 1 from pg_policies where tablename='wallet' and policyname='mvp_wallet_all') then
    create policy mvp_wallet_all on public.wallet
      for all to anon, authenticated using (true) with check (true);
  end if;
  -- habits
  if not exists (select 1 from pg_policies where tablename='habits' and policyname='mvp_habits_all') then
    create policy mvp_habits_all on public.habits
      for all to anon, authenticated using (true) with check (true);
  end if;
  -- logs
  if not exists (select 1 from pg_policies where tablename='logs' and policyname='mvp_logs_all') then
    create policy mvp_logs_all on public.logs
      for all to anon, authenticated using (true) with check (true);
  end if;
end
$$;

-- Permitir ejecutar el RPC desde el rol anónimo (MVP).
grant execute on function public.set_habit_status(uuid, date, public.habit_status) to anon, authenticated;
grant execute on function public.status_value(public.habit_status) to anon, authenticated;
