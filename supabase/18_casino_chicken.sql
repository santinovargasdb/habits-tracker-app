-- =============================================================================
-- Dojo Ledger — Paso 18: Casino "Pollito" (Chicken Road, server-authoritative)
-- Ejecutar en: Supabase Dashboard → SQL Editor. Correr TODO el archivo.
-- Requiere: schema.sql · 02..08 · 15/16 aplicados.
-- Dificultad fija: 25% de morir por carril (supervivencia 0.75); tope 20 carriles.
-- =============================================================================

create table if not exists public.chicken_games (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  bet        integer not null,
  lane       integer not null default 0,
  status     text not null default 'PLAYING',   -- PLAYING | DONE
  result     text,                              -- CASHED | DEAD | null
  multiplier numeric not null default 1,
  payout     integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chicken_user_unique unique (user_id)
);

alter table public.chicken_games enable row level security;
revoke all on public.chicken_games from anon;
revoke all on public.chicken_games from authenticated;

-- Multiplicador puro (espeja src/lib/casino.ts chickenMultiplier).
create or replace function public.chicken_multiplier(p_lane integer)
returns numeric language sql immutable as $$
  select case when p_lane <= 0 then 1::numeric
              else round((0.97 / power(0.75, p_lane))::numeric, 2) end;
$$;

create or replace function public.chicken_render(g public.chicken_games, p_balance integer)
returns table (status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)
language plpgsql stable as $$
begin
  return query select
    g.status, g.result, g.bet, g.lane, g.multiplier,
    case when g.status = 'PLAYING' and g.lane < 20 then public.chicken_multiplier(g.lane + 1) else null end,
    g.payout, p_balance;
end $$;

create or replace function public.chicken_start(p_bet integer)
returns table (status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_balance integer;
  v_game    public.chicken_games%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  if p_bet is null or p_bet <= 0 then raise exception 'Apuesta inválida: %', p_bet; end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0) on conflict (user_id) do nothing;
  select balance into v_balance from public.wallet where user_id = v_uid for update;
  if v_balance < p_bet then raise exception 'Saldo insuficiente: % < %', v_balance, p_bet using errcode = 'P0001'; end if;

  update public.wallet set balance = balance - p_bet, updated_at = now()
    where user_id = v_uid returning balance into v_balance;

  insert into public.chicken_games (user_id, bet, lane, status, result, multiplier, payout, updated_at)
  values (v_uid, p_bet, 0, 'PLAYING', null, 1, null, now())
  on conflict (user_id) do update set
    bet = excluded.bet, lane = 0, status = 'PLAYING', result = null, multiplier = 1, payout = null, updated_at = now()
  returning * into v_game;

  return query select * from public.chicken_render(v_game, v_balance);
end $$;

-- Avanzar un carril: tira la muerte (25%).
create or replace function public.chicken_step()
returns table (status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_game    public.chicken_games%rowtype;
  v_balance integer;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  select * into v_game from public.chicken_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYING' then raise exception 'No hay una partida en curso' using errcode = 'P0001'; end if;
  if v_game.lane >= 20 then raise exception 'Llegaste al tope; retirate'; end if;

  select balance into v_balance from public.wallet where user_id = v_uid;

  if random() < 0.25 then
    update public.chicken_games set status = 'DONE', result = 'DEAD', payout = 0, updated_at = now()
      where user_id = v_uid returning * into v_game;
    return query select * from public.chicken_render(v_game, v_balance);
    return;
  end if;

  v_game.lane := v_game.lane + 1;
  v_game.multiplier := public.chicken_multiplier(v_game.lane);
  update public.chicken_games set lane = v_game.lane, multiplier = v_game.multiplier, updated_at = now()
    where user_id = v_uid returning * into v_game;

  return query select * from public.chicken_render(v_game, v_balance);
end $$;

create or replace function public.chicken_cashout()
returns table (status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_game    public.chicken_games%rowtype;
  v_balance integer;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  select * into v_game from public.chicken_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYING' then raise exception 'No hay una partida en curso' using errcode = 'P0001'; end if;
  if v_game.lane < 1 then raise exception 'Avanzá al menos un carril antes de retirar'; end if;

  v_game.payout := round(v_game.bet * v_game.multiplier)::integer;
  update public.wallet set balance = balance + v_game.payout, updated_at = now()
    where user_id = v_uid returning balance into v_balance;
  update public.chicken_games set status = 'DONE', result = 'CASHED', payout = v_game.payout, updated_at = now()
    where user_id = v_uid returning * into v_game;

  return query select * from public.chicken_render(v_game, v_balance);
end $$;

grant execute on function public.chicken_start(integer) to authenticated;
grant execute on function public.chicken_step()         to authenticated;
grant execute on function public.chicken_cashout()      to authenticated;
revoke execute on function public.chicken_render(public.chicken_games, integer) from anon;
-- FIN Paso 18.
