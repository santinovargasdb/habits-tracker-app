-- =============================================================================
-- Dojo Ledger — Paso 3: Tienda de Cofres y Gacha (Mercado)
-- Migración ADITIVA e idempotente.  No agrega tablas: sólo el RPC transaccional.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere:  schema.sql · seed.sql · 02_cards_deck.sql
-- =============================================================================

-- =============================================================================
-- purchase_chest(chest_cost, chest_type)
--   1. Verifica saldo suficiente (si no, lanza error).
--   2. Descuenta el costo.
--   3. RNG por pesos de rareza DENTRO de Postgres.
--   4. UPSERT en user_inventory (quantity + 1 o insert quantity = 1).
--   5. Devuelve la carta ganada + nuevo balance.
--
-- SEGURIDAD: el costo y las probabilidades son AUTORITATIVOS del servidor
-- (por chest_type). El p_chest_cost del cliente sólo se valida por coherencia,
-- así un cliente manipulado no puede abaratar el cofre ni alterar las odds.
-- =============================================================================
create or replace function public.purchase_chest(
  p_chest_cost integer,
  p_chest_type text
)
returns table (
  won_card_id  uuid,
  new_balance  integer,
  new_quantity integer,
  is_new       boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost     integer;
  w_common   integer;
  w_rare     integer;
  w_epic     integer;
  w_legend   integer;
  v_balance  integer;
  v_roll     numeric;
  v_rarity   public.card_rarity;
  v_card     uuid;
  v_existed  boolean;
  v_qty      integer;
begin
  -- --- Config autoritativa del cofre --------------------------------------
  case upper(coalesce(p_chest_type, ''))
    when 'BASICO' then v_cost := 500;  w_common := 80; w_rare := 18; w_epic := 2;  w_legend := 0;
    when 'ORO'    then v_cost := 2000; w_common := 20; w_rare := 65; w_epic := 14; w_legend := 1;
    when 'MAGICO' then v_cost := 5000; w_common := 0;  w_rare := 30; w_epic := 60; w_legend := 10;
    else raise exception 'Tipo de cofre inválido: %', p_chest_type;
  end case;

  -- Coherencia con lo que envió el cliente (anti-tampering).
  if p_chest_cost is not null and p_chest_cost <> v_cost then
    raise exception 'Costo inconsistente para el cofre % (esperado %, recibido %)',
      p_chest_type, v_cost, p_chest_cost;
  end if;

  -- --- Billetera (lock del singleton) -------------------------------------
  insert into public.wallet (balance) values (0)
  on conflict (singleton) do nothing;

  select balance into v_balance
  from public.wallet
  where singleton = true
  for update;

  if v_balance < v_cost then
    raise exception 'Saldo insuficiente: % < %', v_balance, v_cost
      using errcode = 'P0001';
  end if;

  -- Descontar el costo.
  update public.wallet
  set balance = balance - v_cost, updated_at = now()
  where singleton = true
  returning balance into v_balance;

  -- --- RNG de rareza (0..100 acumulado) -----------------------------------
  v_roll := random() * 100;
  if v_roll < w_common then
    v_rarity := 'Common';
  elsif v_roll < w_common + w_rare then
    v_rarity := 'Rare';
  elsif v_roll < w_common + w_rare + w_epic then
    v_rarity := 'Epic';
  else
    v_rarity := 'Legendary';
  end if;

  -- Carta aleatoria de esa rareza. Fallback: cualquier carta del catálogo.
  select id into v_card
  from public.cards
  where rarity = v_rarity
  order by random()
  limit 1;

  if v_card is null then
    select id into v_card from public.cards order by random() limit 1;
  end if;

  if v_card is null then
    raise exception 'No hay cartas en el catálogo';
  end if;

  -- --- UPSERT en inventario -----------------------------------------------
  select exists (select 1 from public.user_inventory where card_id = v_card)
  into v_existed;

  insert into public.user_inventory (card_id, quantity, level)
  values (v_card, 1, 1)
  on conflict (card_id)
  do update set quantity = public.user_inventory.quantity + 1
  returning quantity into v_qty;

  return query select v_card, v_balance, v_qty, (not v_existed);
end;
$$;

grant execute on function public.purchase_chest(integer, text) to anon, authenticated;
