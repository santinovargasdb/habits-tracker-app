-- =============================================================================
-- Dojo Ledger — Paso 21: Fix RNG de Minas (las minas salían siempre 0,1,2…)
-- Ejecutar en: Supabase Dashboard → SQL Editor. Correr TODO el archivo.
-- Requiere: 17_casino_mines.sql aplicado.
--
-- CAUSA RAÍZ: en mines_start el sorteo usaba generate_series en el SELECT:
--   from (select generate_series(0,24) as pos order by random() limit p_mines) s
-- Con la SRF en el target list, el `order by random()` NO ordena el conjunto y
-- el LIMIT devuelve siempre las primeras N posiciones (0,1,2… = arriba-izquierda).
-- Probado en prod: el sorteo daba {0,1,2} en el 100% de las tiradas.
-- FIX: mover generate_series al FROM (row-source real) → random() sí ordena.
-- =============================================================================

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

  -- generate_series en el FROM: acá el order by random() SÍ ordena antes del LIMIT.
  select array_agg(pos) into v_positions
  from (
    select g.pos from generate_series(0, 24) as g(pos)
    order by random()
    limit p_mines
  ) s;

  insert into public.mines_games (user_id, bet, mines_count, mine_positions, picks, status, result, multiplier, payout, updated_at)
  values (v_uid, p_bet, p_mines, v_positions, '{}', 'PLAYING', null, 1, null, now())
  on conflict (user_id) do update set
    bet = excluded.bet, mines_count = excluded.mines_count, mine_positions = excluded.mine_positions,
    picks = '{}', status = 'PLAYING', result = null, multiplier = 1, payout = null, updated_at = now()
  returning * into v_game;

  return query select * from public.mines_render(v_game, v_balance);
end $$;

-- Defensa: cerrar partidas EN CURSO creadas con el tablero amañado y devolver la
-- apuesta, para que nadie siga cobrando un board fijo. Al iniciar una nueva
-- partida (mines_start) el on-conflict ya re-sortea, así que esto solo limpia
-- las que quedaron a mitad de camino.
with reset as (
  delete from public.mines_games where status = 'PLAYING' returning user_id, bet
)
update public.wallet w
set balance = w.balance + r.bet, updated_at = now()
from reset r
where w.user_id = r.user_id;

-- VERIFICACIÓN (correr aparte, 3 veces → deben salir posiciones distintas y dispersas):
--   select array_agg(pos) from (
--     select g.pos from generate_series(0,24) as g(pos) order by random() limit 3
--   ) s;
-- FIN Paso 21.
