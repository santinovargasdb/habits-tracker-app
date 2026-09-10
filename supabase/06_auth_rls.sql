-- =============================================================================
-- Dojo Ledger — Paso 6: Autenticación y Cierre de Seguridad (RLS multiusuario)
-- Migración ADITIVA e idempotente sobre los Pasos 1..5.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere haber corrido antes:  schema.sql · seed.sql · 02..05
--
-- Qué hace:
--   1. Añade user_id (→ auth.users, default auth.uid()) a las tablas de datos.
--   2. Reemplaza el mecanismo "singleton" por constraints por-usuario.
--   3. Trigger handle_new_user(): al registrarse un usuario, le crea la wallet,
--      los hábitos seed, los fondos de inversión, el mazo vacío y el inventario
--      inicial (una copia de cada carta del catálogo global).
--   4. Cierra el acceso anónimo: dropea las políticas permisivas mvp_* y revoca
--      privilegios/execute al rol `anon`.
--   5. RLS ESTRICTA: cada usuario sólo ve/opera sus filas (user_id = auth.uid()).
--   6. Reescribe los RPCs para operar con auth.uid() (ya no asumen usuario único).
--
-- ⚠️  Fresh start: las filas creadas ANTES del Paso 6 quedan con user_id NULL e
--     invisibles bajo RLS. Cada usuario nuevo obtiene su propio seed vía trigger.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna user_id en todas las tablas de datos (NO en `cards`, que es un
--    catálogo GLOBAL compartido por todos los usuarios).
--    default auth.uid() cubre inserts directos de un cliente autenticado; el
--    trigger y los RPCs igualmente setean user_id de forma explícita.
-- -----------------------------------------------------------------------------
alter table public.wallet
  add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();
alter table public.habits
  add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();
alter table public.logs
  add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();
alter table public.user_inventory
  add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();
alter table public.active_deck
  add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();
alter table public.investments
  add column if not exists user_id uuid references auth.users (id) on delete cascade default auth.uid();

create index if not exists wallet_user_idx         on public.wallet (user_id);
create index if not exists habits_user_idx         on public.habits (user_id);
create index if not exists logs_user_idx           on public.logs (user_id);
create index if not exists user_inventory_user_idx on public.user_inventory (user_id);
create index if not exists active_deck_user_idx    on public.active_deck (user_id);
create index if not exists investments_user_idx    on public.investments (user_id);

-- -----------------------------------------------------------------------------
-- 2. Constraints por-usuario (reemplazan el mecanismo "singleton").
--    Nota: unique(user_id) permite múltiples filas viejas con user_id NULL
--    (los NULL se consideran distintos), así el fresh-start no rompe la migración.
-- -----------------------------------------------------------------------------
-- wallet: una billetera por usuario.  Dropear la columna singleton cae en
-- cascada sobre wallet_singleton_unique.
alter table public.wallet      drop column if exists singleton;
alter table public.active_deck drop column if exists singleton;

-- user_inventory: una fila por (usuario, carta).
alter table public.user_inventory drop constraint if exists user_inventory_card_unique;
-- investments: una fila por (usuario, fondo).
alter table public.investments    drop constraint if exists investments_fund_unique;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_user_unique') then
    alter table public.wallet add constraint wallet_user_unique unique (user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'active_deck_user_unique') then
    alter table public.active_deck add constraint active_deck_user_unique unique (user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_inventory_user_card_unique') then
    alter table public.user_inventory add constraint user_inventory_user_card_unique unique (user_id, card_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'investments_user_fund_unique') then
    alter table public.investments add constraint investments_user_fund_unique unique (user_id, fund_type);
  end if;
end
$$;

-- logs mantiene su unique (habit_id, date): un hábito pertenece a un solo
-- usuario, así que el par ya es único por usuario.

-- =============================================================================
-- 3. Trigger de alta de usuario: siembra los datos iniciales por usuario.
--    security definer para poder insertar en public.* durante el signup (el
--    contexto de auth no tiene auth.uid()); por eso usamos new.id explícito.
-- =============================================================================
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

  -- Hábitos seed (mismos que seed.sql; UUIDs generados por usuario).
  insert into public.habits (user_id, name, time_block, sort_order) values
    (new.id, 'Despertar 5:30 AM',              'Madrugada', 1),
    (new.id, 'Trabajo (Mañana)',               'Madrugada', 2),
    (new.id, 'Lectura en el tren',             'Viaje',     3),
    (new.id, 'Repaso de Kanjis',               'Viaje',     4),
    (new.id, 'Entrenar MMA (15:30 - 17:00)',   'Tarde',     5),
    (new.id, 'Preparación Álgebra/Entropía',   'Tarde',     6),
    (new.id, 'Colegio secundario',             'Noche',     7),
    (new.id, 'Cierre a las 22:00',             'Noche',     8);

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 4. Cierre del acceso anónimo (⚠️  reemplaza el MVP permisivo de los Pasos 1..5).
-- =============================================================================
drop policy if exists mvp_wallet_all      on public.wallet;
drop policy if exists mvp_habits_all      on public.habits;
drop policy if exists mvp_logs_all        on public.logs;
drop policy if exists mvp_cards_all        on public.cards;
drop policy if exists mvp_inventory_all   on public.user_inventory;
drop policy if exists mvp_deck_all        on public.active_deck;
drop policy if exists mvp_investments_all on public.investments;

-- El rol anónimo no debe poder tocar ninguna tabla de la app.
revoke all on public.wallet         from anon;
revoke all on public.habits         from anon;
revoke all on public.logs           from anon;
revoke all on public.cards          from anon;
revoke all on public.user_inventory from anon;
revoke all on public.active_deck    from anon;
revoke all on public.investments    from anon;

-- ...ni ejecutar los RPCs.
revoke execute on function public.status_value(public.habit_status)                    from anon;
revoke execute on function public.effective_multiplier(integer, integer)               from anon;
revoke execute on function public.deck_multiplier_percent(public.time_block)           from anon;
revoke execute on function public.set_habit_status(uuid, date, public.habit_status)    from anon;
revoke execute on function public.set_deck_slot(integer, uuid)                         from anon;
revoke execute on function public.purchase_chest(integer, text)                        from anon;
revoke execute on function public.manage_investment(text, text, integer)               from anon;
revoke execute on function public.calculate_daily_interest()                           from anon;
revoke execute on function public.spin_roulette(integer)                               from anon;
revoke execute on function public.upgrade_card(uuid)                                   from anon;

-- =============================================================================
-- 5. RLS ESTRICTA por tabla: el usuario sólo accede a sus propias filas.
-- =============================================================================
alter table public.wallet          enable row level security;
alter table public.habits          enable row level security;
alter table public.logs            enable row level security;
alter table public.cards           enable row level security;
alter table public.user_inventory  enable row level security;
alter table public.active_deck     enable row level security;
alter table public.investments     enable row level security;

drop policy if exists wallet_owner         on public.wallet;
drop policy if exists habits_owner         on public.habits;
drop policy if exists logs_owner           on public.logs;
drop policy if exists inventory_owner      on public.user_inventory;
drop policy if exists deck_owner           on public.active_deck;
drop policy if exists investments_owner    on public.investments;
drop policy if exists cards_read           on public.cards;

create policy wallet_owner on public.wallet
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy habits_owner on public.habits
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy logs_owner on public.logs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy inventory_owner on public.user_inventory
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy deck_owner on public.active_deck
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy investments_owner on public.investments
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- cards es un catálogo GLOBAL de sólo lectura para usuarios autenticados.
create policy cards_read on public.cards
  for select to authenticated
  using (true);

-- =============================================================================
-- 6. Reescritura de los RPCs para operar con auth.uid() (multiusuario).
--    Todos capturan v_uid := auth.uid() y filtran/insertan por user_id.
--    Se mantienen las firmas (create or replace, sin cambiar el tipo de retorno).
-- =============================================================================

-- 6.1 Multiplicador del mazo del usuario (mazo + niveles de SU inventario).
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
  left join public.user_inventory ui
    on ui.card_id = c.id and ui.user_id = auth.uid()
  where d.user_id = auth.uid()
    and (c.target_block is null or c.target_block = p_block);
$$;

-- 6.2 Setear estado de un hábito + ajustar la wallet del usuario.
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
  v_base       integer;
  v_mult       integer;
  v_new_award  integer;
  v_delta      integer;
  v_balance    integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;

  -- El hábito debe pertenecer al usuario.
  select h.time_block into v_block
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

  v_base      := public.status_value(p_status);
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

-- 6.3 Equipar/quitar carta en un slot del mazo del usuario.
create or replace function public.set_deck_slot(p_slot integer, p_card uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_deck uuid[];
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;
  if p_slot < 1 or p_slot > 8 then
    raise exception 'slot fuera de rango (1..8): %', p_slot;
  end if;

  -- La carta a equipar debe estar en el inventario del usuario.
  if p_card is not null and not exists (
    select 1 from public.user_inventory
    where user_id = v_uid and card_id = p_card
  ) then
    raise exception 'La carta no está en tu inventario';
  end if;

  insert into public.active_deck (user_id) values (v_uid)
  on conflict (user_id) do nothing;

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
      slot_8 = nullif(slot_8, p_card)
    where user_id = v_uid;
  end if;

  execute format(
    'update public.active_deck set slot_%s = $1, updated_at = now() where user_id = $2',
    p_slot
  ) using p_card, v_uid;

  select array[slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8]
  into v_deck
  from public.active_deck
  where user_id = v_uid
  limit 1;

  return v_deck;
end;
$$;

-- 6.4 Compra de cofre (wallet + inventario del usuario).
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
  v_uid      uuid := auth.uid();
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
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;

  case upper(coalesce(p_chest_type, ''))
    when 'BASICO' then v_cost := 500;  w_common := 80; w_rare := 18; w_epic := 2;  w_legend := 0;
    when 'ORO'    then v_cost := 2000; w_common := 20; w_rare := 65; w_epic := 14; w_legend := 1;
    when 'MAGICO' then v_cost := 5000; w_common := 0;  w_rare := 30; w_epic := 60; w_legend := 10;
    else raise exception 'Tipo de cofre inválido: %', p_chest_type;
  end case;

  if p_chest_cost is not null and p_chest_cost <> v_cost then
    raise exception 'Costo inconsistente para el cofre % (esperado %, recibido %)',
      p_chest_type, v_cost, p_chest_cost;
  end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.wallet
  where user_id = v_uid
  for update;

  if v_balance < v_cost then
    raise exception 'Saldo insuficiente: % < %', v_balance, v_cost
      using errcode = 'P0001';
  end if;

  update public.wallet
  set balance = balance - v_cost, updated_at = now()
  where user_id = v_uid
  returning balance into v_balance;

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

  select exists (
    select 1 from public.user_inventory where user_id = v_uid and card_id = v_card
  ) into v_existed;

  insert into public.user_inventory (user_id, card_id, quantity, level)
  values (v_uid, v_card, 1, 1)
  on conflict (user_id, card_id)
  do update set quantity = public.user_inventory.quantity + 1
  returning quantity into v_qty;

  return query select v_card, v_balance, v_qty, (not v_existed);
end;
$$;

-- 6.5 Depósito / retiro de inversión (wallet + fondos del usuario).
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
  v_uid      uuid := auth.uid();
  v_fund     public.fund_type;
  v_balance  integer;
  v_invested integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Monto inválido: %', p_amount;
  end if;

  v_fund := p_fund::public.fund_type;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance from public.wallet
    where user_id = v_uid for update;
  select invested_amount into v_invested from public.investments
    where user_id = v_uid and fund_type = v_fund for update;

  if v_invested is null then
    raise exception 'Fondo inexistente: %', p_fund;
  end if;

  if upper(p_action) = 'DEPOSIT' then
    if v_balance < p_amount then
      raise exception 'Saldo insuficiente en la billetera: % < %', v_balance, p_amount
        using errcode = 'P0001';
    end if;
    update public.wallet set balance = balance - p_amount, updated_at = now()
      where user_id = v_uid returning balance into v_balance;
    update public.investments set invested_amount = invested_amount + p_amount
      where user_id = v_uid and fund_type = v_fund returning invested_amount into v_invested;

  elsif upper(p_action) = 'WITHDRAW' then
    if v_invested < p_amount then
      raise exception 'Fondos insuficientes en la inversión: % < %', v_invested, p_amount
        using errcode = 'P0001';
    end if;
    update public.investments set invested_amount = invested_amount - p_amount
      where user_id = v_uid and fund_type = v_fund returning invested_amount into v_invested;
    update public.wallet set balance = balance + p_amount, updated_at = now()
      where user_id = v_uid returning balance into v_balance;

  else
    raise exception 'Acción inválida: %', p_action;
  end if;

  return query select v_balance, v_invested;
end;
$$;

-- 6.6 Interés diario sobre los fondos del usuario.
create or replace function public.calculate_daily_interest()
returns setof public.investments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  r        public.investments%rowtype;
  v_days   integer;
  v_amount numeric;
  d        integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;

  for r in select * from public.investments where user_id = v_uid for update loop
    v_days := floor(extract(epoch from (now() - r.last_compounded_at)) / 86400)::integer;

    if v_days <= 0 then
      continue;
    end if;

    v_days   := least(v_days, 365);
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

  return query select * from public.investments where user_id = v_uid order by fund_type;
end;
$$;

-- 6.7 Ruleta (wallet del usuario).
create or replace function public.spin_roulette(p_bet integer)
returns table (multiplier integer, payout integer, new_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance integer;
  v_roll    numeric;
  v_mult    integer;
  v_payout  integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;
  if p_bet is null or p_bet <= 0 then
    raise exception 'Apuesta inválida: %', p_bet;
  end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance from public.wallet
    where user_id = v_uid for update;

  if v_balance < p_bet then
    raise exception 'Saldo insuficiente para apostar: % < %', v_balance, p_bet
      using errcode = 'P0001';
  end if;

  update public.wallet set balance = balance - p_bet, updated_at = now()
    where user_id = v_uid returning balance into v_balance;

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
      where user_id = v_uid returning balance into v_balance;
  end if;

  return query select v_mult, v_payout, v_balance;
end;
$$;

-- 6.8 Subir de nivel una carta del inventario del usuario.
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
  v_uid     uuid := auth.uid();
  v_level   integer;
  v_qty     integer;
  v_base    integer;
  v_dups    integer;
  v_cost    integer;
  v_balance integer;
  v_max     constant integer := 10;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = 'P0001';
  end if;

  select ui.level, ui.quantity, c.multiplier_percent
  into v_level, v_qty, v_base
  from public.user_inventory ui
  join public.cards c on c.id = ui.card_id
  where ui.card_id = p_card_id and ui.user_id = v_uid
  for update of ui;

  if v_level is null then
    raise exception 'La carta no está en el inventario';
  end if;
  if v_level >= v_max then
    raise exception 'La carta ya está en nivel máximo (%).', v_max;
  end if;

  v_dups := v_level + 1;
  v_cost := v_level * 500;

  if v_qty < v_dups then
    raise exception 'Duplicados insuficientes: % < %', v_qty, v_dups
      using errcode = 'P0001';
  end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance from public.wallet
    where user_id = v_uid for update;
  if v_balance < v_cost then
    raise exception 'Saldo insuficiente: % < %', v_balance, v_cost
      using errcode = 'P0001';
  end if;

  update public.wallet set balance = balance - v_cost, updated_at = now()
    where user_id = v_uid returning balance into v_balance;

  update public.user_inventory
  set quantity = quantity - v_dups,
      level     = level + 1
  where card_id = p_card_id and user_id = v_uid
  returning level, quantity into v_level, v_qty;

  return query
    select v_level, public.effective_multiplier(v_base, v_level), v_qty, v_balance;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: sólo el rol `authenticated` puede ejecutar los RPCs.
-- -----------------------------------------------------------------------------
grant execute on function public.status_value(public.habit_status)                    to authenticated;
grant execute on function public.effective_multiplier(integer, integer)               to authenticated;
grant execute on function public.deck_multiplier_percent(public.time_block)           to authenticated;
grant execute on function public.set_habit_status(uuid, date, public.habit_status)    to authenticated;
grant execute on function public.set_deck_slot(integer, uuid)                         to authenticated;
grant execute on function public.purchase_chest(integer, text)                        to authenticated;
grant execute on function public.manage_investment(text, text, integer)               to authenticated;
grant execute on function public.calculate_daily_interest()                           to authenticated;
grant execute on function public.spin_roulette(integer)                               to authenticated;
grant execute on function public.upgrade_card(uuid)                                   to authenticated;

-- =============================================================================
-- FIN Paso 6.  Recordá: en el dashboard de Supabase → Authentication → Providers
-- dejá habilitado "Email" y "Confirm email" (flujo elegido). Configurá también
-- Authentication → URL Configuration → Redirect URLs con la URL del sitio.
-- =============================================================================
