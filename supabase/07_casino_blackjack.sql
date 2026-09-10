-- =============================================================================
-- Dojo Ledger — Paso 7: Casino (Ruleta V2 por color + Blackjack)
-- Migración ADITIVA e idempotente.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere:  schema.sql · seed.sql · 02..06  (RLS/auth del Paso 6 ya aplicado).
--
-- Qué hace:
--   1. Ruleta europea por color: roulette_color(n) + spin_roulette(bet, choice).
--   2. Blackjack multiusuario con estado en servidor (tabla blackjack_games) y
--      RPCs bj_deal / bj_hit / bj_stand.  El mazo y la carta tapada del crupier
--      viven en el servidor: la tabla NO se expone al cliente (acceso RPC-only).
-- =============================================================================

-- =============================================================================
-- 1. RULETA EUROPEA POR COLOR
-- =============================================================================

-- Mapa de color auténtico de la ruleta europea (18 rojos / 18 negros / 1 verde).
create or replace function public.roulette_color(p_n integer)
returns text
language sql
immutable
as $$
  select case
    when p_n = 0 then 'GREEN'
    when p_n = any (array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]) then 'RED'
    else 'BLACK'
  end;
$$;

-- Cambia la firma respecto del Paso 4 (bet → bet+choice), así que dropeamos.
drop function if exists public.spin_roulette(integer);

-- spin_roulette(bet, choice): apuesta a un color.
--   Saca un número uniforme 0..36; paga GREEN ×14, RED/BLACK ×2 si acierta.
create or replace function public.spin_roulette(p_bet_amount integer, p_choice text)
returns table (
  result_number integer,
  result_color  text,
  won           boolean,
  payout        integer,
  new_balance   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_choice text := upper(coalesce(p_choice, ''));
  v_balance integer;
  v_number integer;
  v_color  text;
  v_won    boolean;
  v_mult   integer;
  v_payout integer := 0;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;
  if p_bet_amount is null or p_bet_amount <= 0 then
    raise exception 'Apuesta inválida: %', p_bet_amount;
  end if;
  if v_choice not in ('RED', 'BLACK', 'GREEN') then
    raise exception 'Color inválido: %', p_choice;
  end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance from public.wallet where user_id = v_uid for update;
  if v_balance < p_bet_amount then
    raise exception 'Saldo insuficiente: % < %', v_balance, p_bet_amount
      using errcode = 'P0001';
  end if;

  -- Resta la apuesta.
  update public.wallet set balance = balance - p_bet_amount, updated_at = now()
    where user_id = v_uid returning balance into v_balance;

  -- RNG de la casilla (0..36) y su color.
  v_number := floor(random() * 37)::integer;
  v_color  := public.roulette_color(v_number);
  v_won    := (v_color = v_choice);

  if v_won then
    v_mult   := case when v_color = 'GREEN' then 14 else 2 end;
    v_payout := p_bet_amount * v_mult;
    update public.wallet set balance = balance + v_payout, updated_at = now()
      where user_id = v_uid returning balance into v_balance;
  end if;

  return query select v_number, v_color, v_won, v_payout, v_balance;
end;
$$;

-- =============================================================================
-- 2. BLACKJACK
-- -----------------------------------------------------------------------------
-- Representación de cartas: entero 0..51.  rank = card % 13 (0=As,1..8 = 2..9,
-- 9..12 = 10/J/Q/K).  palo = card / 13 (solo estético en la UI).
-- =============================================================================

create table if not exists public.blackjack_games (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  bet          integer not null,
  deck         integer[] not null,                 -- cartas restantes, barajadas
  player_cards integer[] not null default '{}',
  dealer_cards integer[] not null default '{}',
  status       text not null default 'PLAYER_TURN', -- PLAYER_TURN | DONE
  result       text,                                -- PLAYER_BLACKJACK|DEALER_BLACKJACK|PLAYER_WIN|DEALER_WIN|PUSH|PLAYER_BUST
  payout       integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint blackjack_user_unique unique (user_id)  -- una partida activa por usuario
);

-- Acceso RPC-only: habilitamos RLS y NO creamos policy para el cliente, además
-- de revocar privilegios directos. Así el cliente jamás ve `deck` ni la carta
-- tapada del crupier: sólo los RPCs (security definer, owner postgres) acceden.
alter table public.blackjack_games enable row level security;
revoke all on public.blackjack_games from anon;
revoke all on public.blackjack_games from authenticated;

-- Puntaje de una mano con lógica de ases (11 → 1 si conviene).
create or replace function public.bj_hand_score(p_cards integer[])
returns integer
language plpgsql
immutable
as $$
declare
  v_total integer := 0;
  v_aces  integer := 0;
  c integer;
  r integer;
begin
  if p_cards is null then return 0; end if;
  foreach c in array p_cards loop
    r := c % 13;
    if r = 0 then
      v_total := v_total + 11;
      v_aces  := v_aces + 1;
    elsif r >= 9 then
      v_total := v_total + 10;
    else
      v_total := v_total + (r + 1);
    end if;
  end loop;
  while v_total > 21 and v_aces > 0 loop
    v_total := v_total - 10;
    v_aces  := v_aces - 1;
  end loop;
  return v_total;
end;
$$;

-- Vista SANEADA de la partida para el cliente: mientras es el turno del jugador,
-- sólo se expone la carta visible del crupier (la tapada queda oculta).
create or replace function public.bj_render(g public.blackjack_games, p_balance integer)
returns table (
  status        text,
  result        text,
  bet           integer,
  player_cards  integer[],
  player_score  integer,
  dealer_cards  integer[],
  dealer_score  integer,
  dealer_hidden boolean,
  payout        integer,
  new_balance   integer
)
language plpgsql
stable
as $$
declare
  v_dealer integer[];
  v_hidden boolean;
begin
  if g.status = 'PLAYER_TURN' then
    v_dealer := array[g.dealer_cards[1]];  -- sólo la carta visible
    v_hidden := true;
  else
    v_dealer := g.dealer_cards;
    v_hidden := false;
  end if;

  return query select
    g.status,
    g.result,
    g.bet,
    g.player_cards,
    public.bj_hand_score(g.player_cards),
    v_dealer,
    public.bj_hand_score(v_dealer),
    v_hidden,
    coalesce(g.payout, 0),
    p_balance;
end;
$$;

-- Repartir: resta la apuesta, baraja, da 2+2 y resuelve blackjacks naturales.
create or replace function public.bj_deal(p_bet integer)
returns table (
  status text, result text, bet integer,
  player_cards integer[], player_score integer,
  dealer_cards integer[], dealer_score integer, dealer_hidden boolean,
  payout integer, new_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_balance integer;
  v_deck   integer[];
  v_player integer[];
  v_dealer integer[];
  v_ps integer;
  v_ds integer;
  v_status text;
  v_result text;
  v_payout integer;
  v_game public.blackjack_games%rowtype;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;
  if p_bet is null or p_bet <= 0 then
    raise exception 'Apuesta inválida: %', p_bet;
  end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance from public.wallet where user_id = v_uid for update;
  if v_balance < p_bet then
    raise exception 'Saldo insuficiente: % < %', v_balance, p_bet
      using errcode = 'P0001';
  end if;

  update public.wallet set balance = balance - p_bet, updated_at = now()
    where user_id = v_uid returning balance into v_balance;

  -- Mazo barajado (52 cartas 0..51).
  select array_agg(g order by random()) into v_deck from generate_series(0, 51) g;

  v_player := array[v_deck[1], v_deck[3]];
  v_dealer := array[v_deck[2], v_deck[4]];
  v_deck   := v_deck[5:];

  v_ps := public.bj_hand_score(v_player);
  v_ds := public.bj_hand_score(v_dealer);

  -- Resolución de blackjacks naturales al repartir.
  if v_ps = 21 and v_ds = 21 then
    v_status := 'DONE'; v_result := 'PUSH';              v_payout := p_bet;
  elsif v_ps = 21 then
    v_status := 'DONE'; v_result := 'PLAYER_BLACKJACK';  v_payout := p_bet + (p_bet * 3) / 2; -- 3:2 → total 2.5×
  elsif v_ds = 21 then
    v_status := 'DONE'; v_result := 'DEALER_BLACKJACK';  v_payout := 0;
  else
    v_status := 'PLAYER_TURN'; v_result := null;         v_payout := null;
  end if;

  if v_payout is not null and v_payout > 0 then
    update public.wallet set balance = balance + v_payout, updated_at = now()
      where user_id = v_uid returning balance into v_balance;
  end if;

  insert into public.blackjack_games
    (user_id, bet, deck, player_cards, dealer_cards, status, result, payout, updated_at)
  values
    (v_uid, p_bet, v_deck, v_player, v_dealer, v_status, v_result, v_payout, now())
  on conflict (user_id) do update set
    bet = excluded.bet, deck = excluded.deck,
    player_cards = excluded.player_cards, dealer_cards = excluded.dealer_cards,
    status = excluded.status, result = excluded.result, payout = excluded.payout,
    updated_at = now()
  returning * into v_game;

  return query select * from public.bj_render(v_game, v_balance);
end;
$$;

-- Pedir carta: si el jugador se pasa de 21 pierde (BUST).
create or replace function public.bj_hit()
returns table (
  status text, result text, bet integer,
  player_cards integer[], player_score integer,
  dealer_cards integer[], dealer_score integer, dealer_hidden boolean,
  payout integer, new_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_game public.blackjack_games%rowtype;
  v_balance integer;
  v_ps integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;

  select * into v_game from public.blackjack_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYER_TURN' then
    raise exception 'No hay una mano en curso' using errcode = 'P0001';
  end if;

  v_game.player_cards := v_game.player_cards || v_game.deck[1];
  v_game.deck := v_game.deck[2:];
  v_ps := public.bj_hand_score(v_game.player_cards);

  if v_ps > 21 then
    v_game.status := 'DONE';
    v_game.result := 'PLAYER_BUST';
    v_game.payout := 0;
  end if;

  select balance into v_balance from public.wallet where user_id = v_uid;

  update public.blackjack_games set
    player_cards = v_game.player_cards, deck = v_game.deck,
    status = v_game.status, result = v_game.result, payout = v_game.payout,
    updated_at = now()
  where user_id = v_uid returning * into v_game;

  return query select * from public.bj_render(v_game, v_balance);
end;
$$;

-- Plantarse: el crupier roba al azar hasta 17+, se compara y se paga.
create or replace function public.bj_stand()
returns table (
  status text, result text, bet integer,
  player_cards integer[], player_score integer,
  dealer_cards integer[], dealer_score integer, dealer_hidden boolean,
  payout integer, new_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_game public.blackjack_games%rowtype;
  v_balance integer;
  v_ps integer;
  v_ds integer;
  v_result text;
  v_payout integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;

  select * into v_game from public.blackjack_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYER_TURN' then
    raise exception 'No hay una mano en curso' using errcode = 'P0001';
  end if;

  -- El crupier roba al azar mientras su total sea < 17.
  loop
    exit when public.bj_hand_score(v_game.dealer_cards) >= 17;
    v_game.dealer_cards := v_game.dealer_cards || v_game.deck[1];
    v_game.deck := v_game.deck[2:];
  end loop;

  v_ps := public.bj_hand_score(v_game.player_cards);
  v_ds := public.bj_hand_score(v_game.dealer_cards);

  if v_ds > 21 or v_ps > v_ds then
    v_result := 'PLAYER_WIN'; v_payout := v_game.bet * 2;      -- 1:1 → total 2×
  elsif v_ps < v_ds then
    v_result := 'DEALER_WIN'; v_payout := 0;
  else
    v_result := 'PUSH';       v_payout := v_game.bet;          -- devuelve la apuesta
  end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  if v_payout > 0 then
    update public.wallet set balance = balance + v_payout, updated_at = now()
      where user_id = v_uid returning balance into v_balance;
  else
    select balance into v_balance from public.wallet where user_id = v_uid;
  end if;

  update public.blackjack_games set
    dealer_cards = v_game.dealer_cards, deck = v_game.deck,
    status = 'DONE', result = v_result, payout = v_payout, updated_at = now()
  where user_id = v_uid returning * into v_game;

  return query select * from public.bj_render(v_game, v_balance);
end;
$$;

-- =============================================================================
-- Grants: sólo `authenticated`.  Nada para `anon`.
-- =============================================================================
grant execute on function public.roulette_color(integer)                     to authenticated;
grant execute on function public.spin_roulette(integer, text)                 to authenticated;
grant execute on function public.bj_hand_score(integer[])                     to authenticated;
grant execute on function public.bj_deal(integer)                             to authenticated;
grant execute on function public.bj_hit()                                     to authenticated;
grant execute on function public.bj_stand()                                   to authenticated;

revoke execute on function public.roulette_color(integer)                     from anon;
revoke execute on function public.spin_roulette(integer, text)                from anon;
revoke execute on function public.bj_hand_score(integer[])                    from anon;
revoke execute on function public.bj_render(public.blackjack_games, integer)  from anon;
revoke execute on function public.bj_deal(integer)                            from anon;
revoke execute on function public.bj_hit()                                    from anon;
revoke execute on function public.bj_stand()                                  from anon;

-- =============================================================================
-- FIN Paso 7.
-- =============================================================================
