-- =============================================================================
-- Dojo Ledger — Paso 5: Subida de Nivel de Cartas con Duplicados
-- Migración ADITIVA e idempotente.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere:  schema.sql · seed.sql · 02_cards_deck.sql · 03_store_chests.sql · 04_finances.sql
-- -----------------------------------------------------------------------------
-- Modelo:
--   cards.multiplier_percent  = BASE del catálogo (no se toca al mejorar).
--   user_inventory.level       = progreso del usuario.
--   multiplicador EFECTIVO     = base + (level - 1) * 5   (ver effective_multiplier)
--   Requisitos nivel L → L+1:  duplicados = L + 1  ·  costo = L * 500  🪙
--   Nivel máximo: 10
-- =============================================================================

-- Multiplicador efectivo (base + bonus por nivel). Fuente de verdad compartida.
create or replace function public.effective_multiplier(p_base integer, p_level integer)
returns integer
language sql
immutable
as $$
  select p_base + greatest(coalesce(p_level, 1) - 1, 0) * 5;
$$;

-- -----------------------------------------------------------------------------
-- Recalcular el multiplicador del mazo TENIENDO EN CUENTA EL NIVEL.
-- (Reemplaza la versión del Paso 2 — misma firma.)
-- -----------------------------------------------------------------------------
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
  from public.active_deck d
  join public.cards c
    on c.id in (d.slot_1, d.slot_2, d.slot_3, d.slot_4,
                d.slot_5, d.slot_6, d.slot_7, d.slot_8)
  left join public.user_inventory ui on ui.card_id = c.id
  where c.target_block is null or c.target_block = p_block;
$$;

-- =============================================================================
-- RPC: upgrade_card(p_card_id)
--   1. Verifica duplicados suficientes (quantity >= level + 1).
--   2. Verifica saldo suficiente (>= level * 500).
--   3. Descuenta monedas, resta duplicados y sube el nivel.
--   4. Devuelve nuevo nivel, multiplicador efectivo, quantity y balance.
-- =============================================================================
create or replace function public.upgrade_card(p_card_id uuid)
returns table (
  new_level      integer,
  new_multiplier integer,
  new_quantity   integer,
  new_balance    integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level   integer;
  v_qty     integer;
  v_base    integer;
  v_dups    integer;
  v_cost    integer;
  v_balance integer;
  v_max     constant integer := 10;
begin
  -- Nivel + cantidad actuales (+ base del catálogo). Lock de la fila de inventario.
  select ui.level, ui.quantity, c.multiplier_percent
  into v_level, v_qty, v_base
  from public.user_inventory ui
  join public.cards c on c.id = ui.card_id
  where ui.card_id = p_card_id
  for update of ui;

  if v_level is null then
    raise exception 'La carta no está en el inventario';
  end if;
  if v_level >= v_max then
    raise exception 'La carta ya está en nivel máximo (%).', v_max;
  end if;

  v_dups := v_level + 1;      -- duplicados requeridos
  v_cost := v_level * 500;    -- costo en monedas

  if v_qty < v_dups then
    raise exception 'Duplicados insuficientes: % < %', v_qty, v_dups
      using errcode = 'P0001';
  end if;

  -- Saldo
  insert into public.wallet (balance) values (0)
  on conflict (singleton) do nothing;

  select balance into v_balance from public.wallet where singleton = true for update;
  if v_balance < v_cost then
    raise exception 'Saldo insuficiente: % < %', v_balance, v_cost
      using errcode = 'P0001';
  end if;

  -- Aplicar: descuenta monedas, resta duplicados, sube nivel.
  update public.wallet set balance = balance - v_cost, updated_at = now()
    where singleton = true returning balance into v_balance;

  update public.user_inventory
  set quantity = quantity - v_dups,
      level     = level + 1
  where card_id = p_card_id
  returning level, quantity into v_level, v_qty;

  return query
    select v_level, public.effective_multiplier(v_base, v_level), v_qty, v_balance;
end;
$$;

grant execute on function public.effective_multiplier(integer, integer)  to anon, authenticated;
grant execute on function public.upgrade_card(uuid)                       to anon, authenticated;
