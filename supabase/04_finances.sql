-- =============================================================================
-- Dojo Ledger — Paso 4: Finanzas (Interés Compuesto y Ruleta)
-- Migración ADITIVA e idempotente.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere:  schema.sql · seed.sql · 02_cards_deck.sql · 03_store_chests.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipo: fondo de inversión
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'fund_type') then
    create type public.fund_type as enum ('CONSERVATIVE', 'AGGRESSIVE');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Tabla: investments  (una fila por fondo, MVP de un usuario)
-- -----------------------------------------------------------------------------
create table if not exists public.investments (
  id                 uuid primary key default gen_random_uuid(),
  fund_type          public.fund_type not null,
  invested_amount    integer not null default 0,
  last_compounded_at timestamptz not null default now(),
  constraint investments_fund_unique unique (fund_type)
);

-- Seed: los dos fondos del usuario en 0.
insert into public.investments (fund_type, invested_amount) values
  ('CONSERVATIVE', 0),
  ('AGGRESSIVE', 0)
on conflict (fund_type) do nothing;

-- =============================================================================
-- RPC: manage_investment(action, fund, amount)
--   action: 'DEPOSIT' | 'WITHDRAW'
--   Mueve monedas entre la wallet y el fondo, validando saldo suficiente.
--   Devuelve el nuevo balance de la wallet y el nuevo monto invertido.
-- =============================================================================
create or replace function public.manage_investment(
  p_action text,
  p_fund   text,
  p_amount integer
)
returns table (new_balance integer, new_invested integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fund     public.fund_type;
  v_balance  integer;
  v_invested integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Monto inválido: %', p_amount;
  end if;

  v_fund := p_fund::public.fund_type;  -- valida el enum

  -- Aseguramos la wallet y lockeamos ambas filas.
  insert into public.wallet (balance) values (0)
  on conflict (singleton) do nothing;

  select balance into v_balance from public.wallet where singleton = true for update;
  select invested_amount into v_invested
  from public.investments where fund_type = v_fund for update;

  if v_invested is null then
    raise exception 'Fondo inexistente: %', p_fund;
  end if;

  if upper(p_action) = 'DEPOSIT' then
    if v_balance < p_amount then
      raise exception 'Saldo insuficiente en la billetera: % < %', v_balance, p_amount
        using errcode = 'P0001';
    end if;
    update public.wallet set balance = balance - p_amount, updated_at = now()
      where singleton = true returning balance into v_balance;
    update public.investments set invested_amount = invested_amount + p_amount
      where fund_type = v_fund returning invested_amount into v_invested;

  elsif upper(p_action) = 'WITHDRAW' then
    if v_invested < p_amount then
      raise exception 'Fondos insuficientes en la inversión: % < %', v_invested, p_amount
        using errcode = 'P0001';
    end if;
    update public.investments set invested_amount = invested_amount - p_amount
      where fund_type = v_fund returning invested_amount into v_invested;
    update public.wallet set balance = balance + p_amount, updated_at = now()
      where singleton = true returning balance into v_balance;

  else
    raise exception 'Acción inválida: %', p_action;
  end if;

  return query select v_balance, v_invested;
end;
$$;

-- =============================================================================
-- RPC: calculate_daily_interest()
--   Aplica el interés por cada día ENTERO transcurrido desde last_compounded_at.
--     CONSERVATIVE → +1% diario fijo (compuesto): amount * 1.01^días
--     AGGRESSIVE   → RNG por día: 70% +5% / 30% −3%
--   Avanza last_compounded_at por (días enteros), preservando el remanente
--   sub-día → es idempotente dentro del mismo día.
--   Devuelve las filas de investments actualizadas.
-- =============================================================================
create or replace function public.calculate_daily_interest()
returns setof public.investments
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.investments%rowtype;
  v_days   integer;
  v_amount numeric;
  d        integer;
begin
  for r in select * from public.investments for update loop
    v_days := floor(extract(epoch from (now() - r.last_compounded_at)) / 86400)::integer;

    if v_days <= 0 then
      continue;
    end if;

    v_days   := least(v_days, 365);  -- tope defensivo anti-loops largos
    v_amount := r.invested_amount;

    if v_amount > 0 then
      if r.fund_type = 'CONSERVATIVE' then
        v_amount := v_amount * power(1.01, v_days);
      else
        for d in 1..v_days loop
          if random() < 0.70 then
            v_amount := v_amount * 1.05;
          else
            v_amount := v_amount * 0.97;
          end if;
        end loop;
      end if;
    end if;

    update public.investments
    set invested_amount    = greatest(round(v_amount)::integer, 0),
        last_compounded_at = r.last_compounded_at + (v_days || ' days')::interval
    where id = r.id;
  end loop;

  return query select * from public.investments order by fund_type;
end;
$$;

-- =============================================================================
-- RPC: spin_roulette(bet_amount)
--   Valida saldo, resta la apuesta, RNG por pesos y paga bet * multiplicador.
--   Pesos: 45% x0 · 30% x1 · 15% x2 · 9% x3 · 1% x50
--   Devuelve multiplicador, pago y nuevo balance.
-- =============================================================================
create or replace function public.spin_roulette(p_bet integer)
returns table (multiplier integer, payout integer, new_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_roll    numeric;
  v_mult    integer;
  v_payout  integer;
begin
  if p_bet is null or p_bet <= 0 then
    raise exception 'Apuesta inválida: %', p_bet;
  end if;

  insert into public.wallet (balance) values (0)
  on conflict (singleton) do nothing;

  select balance into v_balance from public.wallet where singleton = true for update;

  if v_balance < p_bet then
    raise exception 'Saldo insuficiente para apostar: % < %', v_balance, p_bet
      using errcode = 'P0001';
  end if;

  -- Resta la apuesta.
  update public.wallet set balance = balance - p_bet, updated_at = now()
    where singleton = true returning balance into v_balance;

  -- RNG por pesos (acumulado 0..100).
  v_roll := random() * 100;
  if v_roll < 45 then
    v_mult := 0;
  elsif v_roll < 75 then
    v_mult := 1;
  elsif v_roll < 90 then
    v_mult := 2;
  elsif v_roll < 99 then
    v_mult := 3;
  else
    v_mult := 50;
  end if;

  v_payout := p_bet * v_mult;

  if v_payout > 0 then
    update public.wallet set balance = balance + v_payout, updated_at = now()
      where singleton = true returning balance into v_balance;
  end if;

  return query select v_mult, v_payout, v_balance;
end;
$$;

-- =============================================================================
-- RLS + grants (MVP: permisivo para anon, igual que pasos previos)
-- =============================================================================
alter table public.investments enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='investments' and policyname='mvp_investments_all') then
    create policy mvp_investments_all on public.investments
      for all to anon, authenticated using (true) with check (true);
  end if;
end
$$;

grant execute on function public.manage_investment(text, text, integer)    to anon, authenticated;
grant execute on function public.calculate_daily_interest()                 to anon, authenticated;
grant execute on function public.spin_roulette(integer)                     to anon, authenticated;
