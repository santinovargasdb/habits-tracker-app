-- =============================================================================
-- Dojo Ledger — Paso 2: Sistema de Cartas y Mazo (estilo Clash Royale)
-- Migración ADITIVA e idempotente sobre el esquema del Paso 1.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere haber corrido antes:  schema.sql  y  seed.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipo: rareza de carta
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'card_rarity') then
    create type public.card_rarity as enum ('Common', 'Rare', 'Epic', 'Legendary');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Tabla: cards  (catálogo global)
--   target_block NULL  => carta global (aplica a todos los bloques)
--   multiplier_percent => 10 significa +10%
-- -----------------------------------------------------------------------------
create table if not exists public.cards (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  rarity             public.card_rarity not null,
  target_block       public.time_block,           -- nullable = global
  multiplier_percent integer not null default 0,
  description        text,
  created_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Tabla: user_inventory  (MVP de un usuario)
-- -----------------------------------------------------------------------------
create table if not exists public.user_inventory (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.cards (id) on delete cascade,
  quantity   integer not null default 1,
  level      integer not null default 1,
  created_at timestamptz not null default now(),
  constraint user_inventory_card_unique unique (card_id)
);

-- -----------------------------------------------------------------------------
-- Tabla: active_deck  (singleton — 8 slots)
-- -----------------------------------------------------------------------------
create table if not exists public.active_deck (
  id         uuid primary key default gen_random_uuid(),
  slot_1     uuid references public.cards (id) on delete set null,
  slot_2     uuid references public.cards (id) on delete set null,
  slot_3     uuid references public.cards (id) on delete set null,
  slot_4     uuid references public.cards (id) on delete set null,
  slot_5     uuid references public.cards (id) on delete set null,
  slot_6     uuid references public.cards (id) on delete set null,
  slot_7     uuid references public.cards (id) on delete set null,
  slot_8     uuid references public.cards (id) on delete set null,
  singleton  boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint active_deck_singleton_unique unique (singleton)
);

-- -----------------------------------------------------------------------------
-- logs: guardamos las monedas realmente acreditadas por el estado actual.
-- Esto permite revertir el pago EXACTO (con multiplicador incluido) al cambiar
-- de estado, aunque el mazo haya cambiado entre medio.
-- -----------------------------------------------------------------------------
alter table public.logs
  add column if not exists coins_awarded integer not null default 0;

-- =============================================================================
-- Multiplicador del mazo para un bloque dado.
-- Suma multiplier_percent de las cartas equipadas cuyo target_block coincide
-- con el bloque (o es global / NULL).
-- =============================================================================
create or replace function public.deck_multiplier_percent(p_block public.time_block)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c.multiplier_percent), 0)::integer
  from public.active_deck d
  join public.cards c
    on c.id in (d.slot_1, d.slot_2, d.slot_3, d.slot_4,
                d.slot_5, d.slot_6, d.slot_7, d.slot_8)
  where c.target_block is null or c.target_block = p_block;
$$;

-- =============================================================================
-- RPC de economía ACTUALIZADO: aplica el multiplicador del mazo.
--   pago_base   = status_value(status)         (0 / 50 / 150)
--   multiplier  = deck_multiplier_percent(bloque del hábito)
--   pago        = round(pago_base * (100 + multiplier) / 100)
--   delta       = pago_nuevo - pago_previo (leído de logs.coins_awarded)
-- Debemos dropear primero porque cambia la firma de retorno (Paso 1).
-- =============================================================================
drop function if exists public.set_habit_status(uuid, date, public.habit_status);

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
  v_old_status public.habit_status;
  v_old_award  integer;
  v_block      public.time_block;
  v_base       integer;
  v_mult       integer;
  v_new_award  integer;
  v_delta      integer;
  v_balance    integer;
begin
  -- Bloque del hábito (para el multiplicador).
  select h.time_block into v_block from public.habits h where h.id = p_habit_id;

  -- Estado y pago previo (0 si no existía).
  select l.status, l.coins_awarded into v_old_status, v_old_award
  from public.logs l
  where l.habit_id = p_habit_id and l.date = p_date;

  v_old_status := coalesce(v_old_status, 'NONE');
  v_old_award  := coalesce(v_old_award, 0);

  -- Pago con multiplicador.
  v_base      := public.status_value(p_status);
  v_mult      := public.deck_multiplier_percent(v_block);
  v_new_award := round(v_base * (100 + v_mult) / 100.0)::integer;

  v_delta := v_new_award - v_old_award;

  -- Upsert del log con las monedas acreditadas.
  insert into public.logs (habit_id, date, status, coins_awarded)
  values (p_habit_id, p_date, p_status, v_new_award)
  on conflict (habit_id, date) do update
    set status = excluded.status,
        coins_awarded = excluded.coins_awarded,
        updated_at = now();

  -- Ajuste de la billetera.
  insert into public.wallet (balance) values (0)
  on conflict (singleton) do nothing;

  update public.wallet
  set balance = balance + v_delta, updated_at = now()
  returning wallet.balance into v_balance;

  return query select v_balance, p_status, v_new_award;
end;
$$;

-- =============================================================================
-- RPC para equipar/quitar cartas en un slot (1..8).
--   p_card NULL  => quitar (dejar el slot vacío)
--   Si la carta ya estaba en otro slot, se quita de ahí (sin duplicados).
-- Devuelve el mazo completo como array de 8 (con NULLs) para reconciliar la UI.
-- =============================================================================
create or replace function public.set_deck_slot(p_slot integer, p_card uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deck uuid[];
begin
  if p_slot < 1 or p_slot > 8 then
    raise exception 'slot fuera de rango (1..8): %', p_slot;
  end if;

  -- Aseguramos el mazo singleton.
  insert into public.active_deck (singleton) values (true)
  on conflict (singleton) do nothing;

  -- Anti-duplicados: quitamos la carta de cualquier slot donde ya esté.
  if p_card is not null then
    update public.active_deck set
      slot_1 = nullif(slot_1, p_card),
      slot_2 = nullif(slot_2, p_card),
      slot_3 = nullif(slot_3, p_card),
      slot_4 = nullif(slot_4, p_card),
      slot_5 = nullif(slot_5, p_card),
      slot_6 = nullif(slot_6, p_card),
      slot_7 = nullif(slot_7, p_card),
      slot_8 = nullif(slot_8, p_card);
  end if;

  -- Seteamos el slot destino (columna dinámica).
  execute format('update public.active_deck set slot_%s = $1, updated_at = now()', p_slot)
  using p_card;

  select array[slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8]
  into v_deck
  from public.active_deck
  limit 1;

  return v_deck;
end;
$$;

-- =============================================================================
-- Seed de cartas iniciales + inventario del usuario + mazo vacío.
-- UUIDs fijos: coinciden con el fallback demo del frontend (constants.ts).
-- =============================================================================
insert into public.cards (id, name, rarity, target_block, multiplier_percent, description) values
  ('aaaa1111-1111-1111-1111-111111111111', 'Libro de Viaje',       'Common',    'Viaje',     10, 'Aprovechá cada trayecto. +10% de monedas en los hábitos del bloque Viaje.'),
  ('bbbb2222-2222-2222-2222-222222222222', 'Foco en la Ecuación',  'Rare',      'Tarde',     15, 'Concentración total sobre el problema. +15% de monedas en el bloque Tarde.'),
  ('cccc3333-3333-3333-3333-333333333333', 'Cinturón Naranja',     'Epic',      'Tarde',     20, 'Disciplina marcial pasiva. +20% de monedas en el bloque Tarde.'),
  ('dddd4444-4444-4444-4444-444444444444', 'Voluntad de Acero',    'Legendary', 'Madrugada', 25, 'Dominá el amanecer. +25% de monedas en el bloque Madrugada.')
on conflict (id) do update
  set name = excluded.name,
      rarity = excluded.rarity,
      target_block = excluded.target_block,
      multiplier_percent = excluded.multiplier_percent,
      description = excluded.description;

-- El usuario arranca con una copia de cada carta.
insert into public.user_inventory (card_id, quantity, level)
select id, 1, 1 from public.cards
on conflict (card_id) do nothing;

-- Mazo singleton vacío.
insert into public.active_deck (singleton) values (true)
on conflict (singleton) do nothing;

-- =============================================================================
-- RLS (MVP sin auth — políticas permisivas para anon, igual que el Paso 1).
-- =============================================================================
alter table public.cards          enable row level security;
alter table public.user_inventory enable row level security;
alter table public.active_deck    enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='cards' and policyname='mvp_cards_all') then
    create policy mvp_cards_all on public.cards
      for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='user_inventory' and policyname='mvp_inventory_all') then
    create policy mvp_inventory_all on public.user_inventory
      for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='active_deck' and policyname='mvp_deck_all') then
    create policy mvp_deck_all on public.active_deck
      for all to anon, authenticated using (true) with check (true);
  end if;
end
$$;

grant execute on function public.deck_multiplier_percent(public.time_block) to anon, authenticated;
grant execute on function public.set_habit_status(uuid, date, public.habit_status) to anon, authenticated;
grant execute on function public.set_deck_slot(integer, uuid) to anon, authenticated;
