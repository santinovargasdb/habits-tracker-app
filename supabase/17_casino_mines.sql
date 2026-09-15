-- =============================================================================
-- Dojo Ledger — Paso 17: Casino "Minas" (server-authoritative)
-- Ejecutar en: Supabase Dashboard → SQL Editor. Correr TODO el archivo.
-- Requiere: schema.sql · 02..08 (wallet, casino) y 15/16 aplicados.
-- =============================================================================

-- Tabla de estado (una partida activa por usuario). RPC-only.
create table if not exists public.mines_games (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  bet            integer not null,
  mines_count    integer not null,            -- 1..24
  mine_positions integer[] not null,          -- OCULTO (0..24)
  picks          integer[] not null default '{}',
  status         text not null default 'PLAYING',   -- PLAYING | DONE
  result         text,                              -- CASHED | BUSTED | null
  multiplier     numeric not null default 1,
  payout         integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint mines_user_unique unique (user_id)
);

alter table public.mines_games enable row level security;
revoke all on public.mines_games from anon;
revoke all on public.mines_games from authenticated;

-- Multiplicador puro (espeja src/lib/casino.ts minesMultiplier).
create or replace function public.mines_multiplier(p_mines integer, p_picks integer)
returns numeric language plpgsql immutable as $$
declare
  v_p    numeric := 1;
  v_safe integer := 25 - p_mines;
  i      integer;
begin
  if p_picks <= 0 then return 1; end if;
  for i in 0..(p_picks - 1) loop
    v_p := v_p * ((v_safe - i)::numeric / (25 - i));
  end loop;
  return round(0.97 / v_p, 2);
end $$;

-- Vista saneada: nunca expone mine_positions mientras se juega.
create or replace function public.mines_render(g public.mines_games, p_balance integer)
returns table (
  status text, result text, bet integer, mines_count integer,
  picks integer[], multiplier numeric, next_multiplier numeric,
  payout integer, revealed_mines integer[], new_balance integer
) language plpgsql stable as $$
begin
  return query select
    g.status, g.result, g.bet, g.mines_count, g.picks, g.multiplier,
    case when g.status = 'PLAYING'
      then public.mines_multiplier(g.mines_count, coalesce(array_length(g.picks, 1), 0) + 1)
      else null end,
    g.payout,
    case when g.status = 'DONE' then g.mine_positions else null end,
    p_balance;
end $$;

-- Iniciar partida: valida, descuenta la apuesta, sortea las minas.
create or replace function public.mines_start(p_bet integer, p_mines integer)
returns table (status text, result text, bet integer, mines_count integer, picks integer[], multiplier numeric, next_multiplier numeric, payout integer, revealed_mines integer[], new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_balance   integer;
  v_positions integer[];
  v_game      public.mines_games%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  if p_mines is null or p_mines < 1 or p_mines > 24 then raise exception 'Cantidad de minas inválida: %', p_mines; end if;
  if p_bet is null or p_bet <= 0 then raise exception 'Apuesta inválida: %', p_bet; end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0) on conflict (user_id) do nothing;
  select balance into v_balance from public.wallet where user_id = v_uid for update;
  if v_balance < p_bet then raise exception 'Saldo insuficiente: % < %', v_balance, p_bet using errcode = 'P0001'; end if;

  update public.wallet set balance = balance - p_bet, updated_at = now()
    where user_id = v_uid returning balance into v_balance;

  select array_agg(pos) into v_positions
  from (select generate_series(0, 24) as pos order by random() limit p_mines) s;

  insert into public.mines_games (user_id, bet, mines_count, mine_positions, picks, status, result, multiplier, payout, updated_at)
  values (v_uid, p_bet, p_mines, v_positions, '{}', 'PLAYING', null, 1, null, now())
  on conflict (user_id) do update set
    bet = excluded.bet, mines_count = excluded.mines_count, mine_positions = excluded.mine_positions,
    picks = '{}', status = 'PLAYING', result = null, multiplier = 1, payout = null, updated_at = now()
  returning * into v_game;

  return query select * from public.mines_render(v_game, v_balance);
end $$;

-- Destapar una casilla.
create or replace function public.mines_pick(p_cell integer)
returns table (status text, result text, bet integer, mines_count integer, picks integer[], multiplier numeric, next_multiplier numeric, payout integer, revealed_mines integer[], new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_game    public.mines_games%rowtype;
  v_balance integer;
  v_safe    integer;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  if p_cell is null or p_cell < 0 or p_cell > 24 then raise exception 'Casilla inválida: %', p_cell; end if;

  select * into v_game from public.mines_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYING' then raise exception 'No hay una partida en curso' using errcode = 'P0001'; end if;
  if p_cell = any(v_game.picks) then raise exception 'Casilla ya destapada'; end if;

  select balance into v_balance from public.wallet where user_id = v_uid;

  if p_cell = any(v_game.mine_positions) then
    update public.mines_games set status = 'DONE', result = 'BUSTED', payout = 0, updated_at = now()
      where user_id = v_uid returning * into v_game;
    return query select * from public.mines_render(v_game, v_balance);
    return;
  end if;

  v_game.picks := v_game.picks || p_cell;
  v_game.multiplier := public.mines_multiplier(v_game.mines_count, coalesce(array_length(v_game.picks, 1), 0));
  v_safe := 25 - v_game.mines_count;

  if coalesce(array_length(v_game.picks, 1), 0) >= v_safe then
    v_game.status := 'DONE'; v_game.result := 'CASHED';
    v_game.payout := round(v_game.bet * v_game.multiplier)::integer;
    update public.wallet set balance = balance + v_game.payout, updated_at = now()
      where user_id = v_uid returning balance into v_balance;
  end if;

  update public.mines_games set
    picks = v_game.picks, multiplier = v_game.multiplier,
    status = v_game.status, result = v_game.result, payout = v_game.payout, updated_at = now()
    where user_id = v_uid returning * into v_game;

  return query select * from public.mines_render(v_game, v_balance);
end $$;

-- Retirarse (cobrar).
create or replace function public.mines_cashout()
returns table (status text, result text, bet integer, mines_count integer, picks integer[], multiplier numeric, next_multiplier numeric, payout integer, revealed_mines integer[], new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_game    public.mines_games%rowtype;
  v_balance integer;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  select * into v_game from public.mines_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYING' then raise exception 'No hay una partida en curso' using errcode = 'P0001'; end if;
  if coalesce(array_length(v_game.picks, 1), 0) < 1 then raise exception 'Destapá al menos una casilla antes de retirar'; end if;

  v_game.payout := round(v_game.bet * v_game.multiplier)::integer;
  update public.wallet set balance = balance + v_game.payout, updated_at = now()
    where user_id = v_uid returning balance into v_balance;
  update public.mines_games set status = 'DONE', result = 'CASHED', payout = v_game.payout, updated_at = now()
    where user_id = v_uid returning * into v_game;

  return query select * from public.mines_render(v_game, v_balance);
end $$;

grant execute on function public.mines_start(integer, integer) to authenticated;
grant execute on function public.mines_pick(integer)           to authenticated;
grant execute on function public.mines_cashout()               to authenticated;
revoke execute on function public.mines_render(public.mines_games, integer) from anon;
-- FIN Paso 17.
