-- =============================================================================
-- Dojo Ledger — Paso 8: Bloque Semanal (hábitos WEEKLY con ×5 de recompensa)
-- Migración ADITIVA e idempotente sobre los Pasos 1..7.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere haber corrido antes:  schema.sql · seed.sql · 02..06 (auth/RLS)
--
-- Qué hace:
--   1. Enum public.habit_frequency ('DAILY','WEEKLY').
--   2. Columna habits.frequency (default 'DAILY', not null).
--   3. frequency_reward_factor(): ×5 para semanales (espeja el frontend).
--   4. Reescribe set_habit_status para aplicar el factor de cadencia.
--      Los hábitos semanales anclan su log al LUNES de la semana (lo decide el
--      cliente pasando p_date = inicio de semana), de modo que el estado se
--      mantiene toda la semana y se reinicia solo al arrancar la siguiente.
--   5. Alta de los hábitos del Bloque Semanal: en el trigger de nuevos usuarios
--      y (backfill idempotente) para los usuarios existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum de cadencia.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'habit_frequency') then
    create type public.habit_frequency as enum ('DAILY', 'WEEKLY');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Columna frequency en habits (los existentes quedan como DAILY).
-- -----------------------------------------------------------------------------
alter table public.habits
  add column if not exists frequency public.habit_frequency not null default 'DAILY';

create index if not exists habits_frequency_idx on public.habits (frequency);

-- -----------------------------------------------------------------------------
-- 3. Factor de recompensa por cadencia (fuente de verdad del ×5 en servidor).
--    Espeja frequencyRewardFactor() de src/lib/constants.ts.
-- -----------------------------------------------------------------------------
create or replace function public.frequency_reward_factor(p_freq public.habit_frequency)
returns integer
language sql
immutable
as $$
  select case when p_freq = 'WEEKLY' then 5 else 1 end;
$$;

grant execute on function public.frequency_reward_factor(public.habit_frequency) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. set_habit_status: aplica el factor de cadencia sobre la recompensa base.
--    Pago = round(status_value * factor_cadencia * (100 + mult_mazo) / 100).
--    (Reescritura completa sobre la versión del Paso 6; misma firma.)
-- -----------------------------------------------------------------------------
create or replace function public.set_habit_status(
  p_habit_id uuid,
  p_date     date,
  p_status   public.habit_status
)
returns table (balance integer, log_status public.habit_status, coins_awarded integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_old_status public.habit_status;
  v_old_award  integer;
  v_block      public.time_block;
  v_freq       public.habit_frequency;
  v_base       integer;
  v_mult       integer;
  v_new_award  integer;
  v_delta      integer;
  v_balance    integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;

  -- El hábito debe pertenecer al usuario. Traemos bloque y cadencia.
  select h.time_block, h.frequency into v_block, v_freq
  from public.habits h
  where h.id = p_habit_id and h.user_id = v_uid;
  if v_block is null then
    raise exception 'Hábito inexistente o ajeno';
  end if;

  select l.status, l.coins_awarded into v_old_status, v_old_award
  from public.logs l
  where l.habit_id = p_habit_id and l.date = p_date and l.user_id = v_uid;

  v_old_status := coalesce(v_old_status, 'NONE');
  v_old_award  := coalesce(v_old_award, 0);

  -- Recompensa base con factor de cadencia (×5 semanal), luego mult. del mazo.
  v_base      := public.status_value(p_status)
                 * public.frequency_reward_factor(v_freq);
  v_mult      := public.deck_multiplier_percent(v_block);
  v_new_award := round(v_base * (100 + v_mult) / 100.0)::integer;
  v_delta     := v_new_award - v_old_award;

  insert into public.logs (user_id, habit_id, date, status, coins_awarded)
  values (v_uid, p_habit_id, p_date, p_status, v_new_award)
  on conflict (habit_id, date) do update
    set status        = excluded.status,
        coins_awarded = excluded.coins_awarded,
        updated_at    = now();

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  update public.wallet
  set balance = balance + v_delta, updated_at = now()
  where user_id = v_uid
  returning wallet.balance into v_balance;

  return query select v_balance, p_status, v_new_award;
end;
$$;

grant execute on function public.set_habit_status(uuid, date, public.habit_status) to authenticated;

-- -----------------------------------------------------------------------------
-- 5a. Trigger de alta: los nuevos usuarios reciben también los hábitos del
--     Bloque Semanal. (Reescritura completa sobre la versión del Paso 6.)
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Billetera en 0.
  insert into public.wallet (user_id, balance)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  -- Hábitos seed diarios.
  insert into public.habits (user_id, name, time_block, sort_order, frequency) values
    (new.id, 'Despertar 5:30 AM',              'Madrugada', 1,  'DAILY'),
    (new.id, 'Trabajo (Mañana)',               'Madrugada', 2,  'DAILY'),
    (new.id, 'Lectura en el tren',             'Viaje',     3,  'DAILY'),
    (new.id, 'Repaso de Kanjis',               'Viaje',     4,  'DAILY'),
    (new.id, 'Entrenar MMA (15:30 - 17:00)',   'Tarde',     5,  'DAILY'),
    (new.id, 'Preparación Álgebra/Entropía',   'Tarde',     6,  'DAILY'),
    (new.id, 'Colegio secundario',             'Noche',     7,  'DAILY'),
    (new.id, 'Cierre a las 22:00',             'Noche',     8,  'DAILY'),
    -- Bloque Semanal (×5).
    (new.id, 'Planificar la semana',           'Noche',     9,  'WEEKLY'),
    (new.id, 'Limpieza profunda / orden',      'Tarde',     10, 'WEEKLY');

  -- Inventario inicial: una copia de cada carta del catálogo global.
  insert into public.user_inventory (user_id, card_id, quantity, level)
  select new.id, c.id, 1, 1 from public.cards c
  on conflict (user_id, card_id) do nothing;

  -- Mazo vacío.
  insert into public.active_deck (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- Fondos de inversión en 0.
  insert into public.investments (user_id, fund_type, invested_amount) values
    (new.id, 'CONSERVATIVE', 0),
    (new.id, 'AGGRESSIVE',   0)
  on conflict (user_id, fund_type) do nothing;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5b. Backfill idempotente: agrega los hábitos semanales a los usuarios que ya
--     existen y todavía no tienen ninguno (así el bloque es visible al instante).
-- -----------------------------------------------------------------------------
insert into public.habits (user_id, name, time_block, sort_order, frequency)
select u.id, v.name, v.block::public.time_block, v.sort_order, 'WEEKLY'::public.habit_frequency
from auth.users u
cross join (values
  ('Planificar la semana',      'Noche', 9),
  ('Limpieza profunda / orden', 'Tarde', 10)
) as v(name, block, sort_order)
where not exists (
  select 1 from public.habits h
  where h.user_id = u.id and h.frequency = 'WEEKLY'
);
