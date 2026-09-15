-- =============================================================================
-- Dojo Ledger — Paso 19: Recompensa del mazo desde cartas EQUIPADAS (is_equipped)
-- Migración ADITIVA e idempotente. Correr en: Supabase → SQL Editor → Run.
-- -----------------------------------------------------------------------------
-- Qué hace:
--   1. Puebla cards.multiplier_percent (hoy 0) por rareza: 5/10/20/35.
--   2. deck_multiplier_percent(block): suma el efectivo de las EQUIPADAS del user.
--   3. set_habit_status(uuid,date,text): mismo cuerpo que prod, pero el bonus del
--      mazo se calcula desde user_inventory equipado (no desde active_deck).
--   4. Trigger duro: máximo 8 cartas equipadas por usuario.
-- =============================================================================

-- 1) Poblar el % por rareza (fiel a cards.multiplier = 1.05/1.10/1.20/1.35).
update public.cards set multiplier_percent = case rarity::text
  when 'Common'    then 5
  when 'Rare'      then 10
  when 'Epic'      then 20
  when 'Legendary' then 35
  else multiplier_percent
end;

-- 2) Multiplicador del mazo por bloque = suma del efectivo de las EQUIPADAS.
create or replace function public.deck_multiplier_percent(p_block public.time_block)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    sum(public.effective_multiplier(c.multiplier_percent, coalesce(ui.level, 1))),
    0
  )::integer
  from public.user_inventory ui
  join public.cards c on c.id = ui.card_id
  where ui.user_id = auth.uid()
    and coalesce(ui.is_equipped, false) = true
    and (c.target_block is null or c.target_block = p_block);
$$;

-- 3) set_habit_status: copia fiel de prod, con el bonus desde equipadas.
create or replace function public.set_habit_status(p_habit_id uuid, p_date date, p_status text)
returns table(balance integer, log_status text, coins_awarded integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_time_block text;
  v_frequency  text;
  v_is_weekly  boolean;
  v_log_date   date := p_date;
  v_old_reward integer := 0;
  v_base       integer;
  v_deck_bonus integer := 0;
  v_final      integer := 0;
  v_delta      integer;
  v_balance    integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;

  select h.time_block, h.frequency into v_time_block, v_frequency
  from public.habits h
  where h.id = p_habit_id and h.user_id = v_uid;
  if v_time_block is null then
    raise exception 'Hábito inexistente o ajeno' using errcode = 'P0001';
  end if;

  v_is_weekly := upper(coalesce(v_frequency, 'DAILY')) = 'WEEKLY';
  if v_is_weekly then
    v_log_date := date_trunc('week', p_date)::date;
  end if;

  select coalesce(l.coins_awarded, 0) into v_old_reward
  from public.logs l
  where l.habit_id = p_habit_id and l.date = v_log_date and l.user_id = v_uid;
  v_old_reward := coalesce(v_old_reward, 0);

  v_base := case upper(coalesce(p_status, 'NONE'))
              when 'MET' then 50 when 'SURPASSED' then 150 else 0 end;
  if v_is_weekly then
    v_base := v_base * 5;
  end if;

  if v_base > 0 then
    -- BONUS del mazo desde las cartas EQUIPADAS del usuario (con nivel).
    select coalesce(sum(public.effective_multiplier(c.multiplier_percent, coalesce(ui.level, 1))), 0)
      into v_deck_bonus
    from public.user_inventory ui
    join public.cards c on c.id = ui.card_id
    where ui.user_id = v_uid
      and coalesce(ui.is_equipped, false) = true
      and (c.target_block is null or c.target_block::text = v_time_block);
    v_final := round(v_base * (100.0 + v_deck_bonus) / 100.0)::integer;
  else
    v_final := 0;
  end if;

  v_delta := v_final - v_old_reward;

  if upper(coalesce(p_status, 'NONE')) = 'NONE' then
    delete from public.logs
    where habit_id = p_habit_id and date = v_log_date and user_id = v_uid;
  else
    insert into public.logs (user_id, habit_id, date, status, coins_awarded)
    values (v_uid, p_habit_id, v_log_date, upper(p_status)::public.habit_status, v_final)
    on conflict (habit_id, date) do update
      set status = excluded.status,
          coins_awarded = excluded.coins_awarded,
          updated_at = now();
  end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  update public.wallet
    set balance = public.wallet.balance + v_delta, updated_at = now()
    where user_id = v_uid
    returning public.wallet.balance into v_balance;

  return query select v_balance, p_status, v_final;
end;
$$;

-- 4) Tope duro: no más de 8 cartas equipadas por usuario.
create or replace function public.enforce_max_equipped()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.is_equipped, false) and (
    select count(*) from public.user_inventory
    where user_id = new.user_id and coalesce(is_equipped, false) and id <> new.id
  ) >= 8 then
    raise exception 'No se pueden equipar más de 8 cartas' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_max_equipped on public.user_inventory;
create trigger trg_max_equipped
  before insert or update of is_equipped on public.user_inventory
  for each row execute function public.enforce_max_equipped();

grant execute on function public.deck_multiplier_percent(public.time_block) to anon, authenticated;
grant execute on function public.set_habit_status(uuid, date, text)         to anon, authenticated;

-- =============================================================================
-- VERIFICACIÓN (correr aparte tras aplicar; NO es parte de la migración):
--   -- % poblado por rareza:
--   select rarity, min(multiplier_percent), max(multiplier_percent), count(*)
--   from public.cards group by rarity order by rarity;
--   -- esperado: Common 5/5, Rare 10/10, Epic 20/20, Legendary 35/35
--
--   -- El trigger existe:
--   select tgname from pg_trigger where tgrelid = 'public.user_inventory'::regclass
--     and tgname = 'trg_max_equipped';
-- =============================================================================
