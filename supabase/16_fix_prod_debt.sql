-- =============================================================================
-- Dojo Ledger — Paso 16: Corrección de deudas técnicas de producción
-- Migración correctiva, transaccional e idempotente.
-- -----------------------------------------------------------------------------
-- Ejecutar en: Supabase Dashboard → SQL Editor. Corré TODO el archivo de una.
-- Requiere: schema.sql · seed.sql · 02..15 aplicados (estado real de prod).
--
-- Qué corrige (ver docs/superpowers/specs/2026-09-14-paso-16-fix-prod-debt-design.md):
--   1. Unifica set_habit_status en UN overload (uuid,date,text)->TABLE con balance.
--   2. purchase_chest: compara rarity (text) correctamente → arregla el gacha.
--   3. handle_new_user: search_path + siembra una copia de cada carta del catálogo.
--   4. Normaliza datos: habits.time_block (inglés→español), cards.rarity (Capitalizado).
--   5. Dropea la policy redundante "Permitir lectura de habitos".
--
-- SIN cambio de economía (base 50/150, semanal ×5, bonus del mazo sin escalar por nivel).
--
-- ⚠️  DRY-RUN primero: pegá este contenido reemplazando el `commit;` final por
--     `rollback;` para validar contra el esquema real sin persistir nada.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 5. Policy redundante en habits (duplica habits_owner).
-- -----------------------------------------------------------------------------
drop policy if exists "Permitir lectura de habitos" on public.habits;

-- -----------------------------------------------------------------------------
-- 4. Normalización de datos existentes.
-- -----------------------------------------------------------------------------
-- 4a. habits.time_block: inglés → español canónico (los ya-español no se tocan).
update public.habits h set time_block = m.canon
from (values
  ('MORNING','Madrugada'), ('COMMUTE','Viaje'),
  ('AFTERNOON','Tarde'),   ('NIGHT','Noche'),
  ('WEEKLY','Semanal')
) as m(raw, canon)
where upper(h.time_block) = m.raw and h.time_block <> m.canon;

-- 4b. cards.rarity: → Capitalizado ('common' → 'Common', etc.).
update public.cards
set rarity = initcap(lower(rarity))
where rarity is not null and rarity <> initcap(lower(rarity));

-- -----------------------------------------------------------------------------
-- 1. set_habit_status: un solo overload (uuid,date,text)->TABLE, con balance.
--    Economía preservada; tolera time_block texto (sin cast a enum).
-- -----------------------------------------------------------------------------
drop function if exists public.set_habit_status(uuid, date, text);
drop function if exists public.set_habit_status(uuid, date, public.habit_status);
drop function if exists public.set_habit_status(uuid, uuid, date, text);

create or replace function public.set_habit_status(
  p_habit_id uuid,
  p_date     date,
  p_status   text
)
returns table (balance integer, log_status text, coins_awarded integer)
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

  select h.time_block, h.frequency
    into v_time_block, v_frequency
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
              when 'MET'       then 50
              when 'SURPASSED' then 150
              else 0
            end;
  if v_is_weekly then
    v_base := v_base * 5;
  end if;

  if v_base > 0 then
    select coalesce(sum(c.multiplier_percent), 0) into v_deck_bonus
    from public.active_deck ad
    join lateral (values
      (ad.slot_1),(ad.slot_2),(ad.slot_3),(ad.slot_4),
      (ad.slot_5),(ad.slot_6),(ad.slot_7),(ad.slot_8)
    ) slots(card_id) on true
    join public.cards c on c.id = slots.card_id
    where ad.user_id = v_uid
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
    set balance = balance + v_delta, updated_at = now()
    where user_id = v_uid
    returning wallet.balance into v_balance;

  return query select v_balance, p_status, v_final;
end;
$$;

grant execute on function public.set_habit_status(uuid, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. purchase_chest: comparar rarity (text) contra la rareza sorteada en texto.
--    (Cuerpo idéntico al de prod salvo `rarity = v_rarity::text`.)
-- -----------------------------------------------------------------------------
create or replace function public.purchase_chest(p_chest_cost integer, p_chest_type text)
returns table(won_card_id uuid, new_balance integer, new_quantity integer, is_new boolean)
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

  select balance into v_balance from public.wallet where user_id = v_uid for update;

  if v_balance < v_cost then
    raise exception 'Saldo insuficiente: % < %', v_balance, v_cost using errcode = 'P0001';
  end if;

  update public.wallet set balance = balance - v_cost, updated_at = now()
  where user_id = v_uid returning balance into v_balance;

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
  where rarity = v_rarity::text          -- FIX: rarity es text; comparar en texto
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

-- -----------------------------------------------------------------------------
-- 3. handle_new_user: search_path + siembra una copia de cada carta del catálogo.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallet (user_id, balance) values (new.id, 0)
  on conflict (user_id) do nothing;

  insert into public.habits (id, user_id, name, time_block, frequency) values
    (gen_random_uuid(), new.id, 'Resolver ejercicio de LeetCode de lógica o estructuras de datos.', 'Madrugada', 'DAILY'),
    (gen_random_uuid(), new.id, 'Lectura de no ficción o literatura técnica de sistemas durante el viaje.', 'Viaje', 'DAILY'),
    (gen_random_uuid(), new.id, 'Práctica de repaso de vocabulario en japonés mediante tarjetas de memoria (Anki).', 'Viaje', 'DAILY'),
    (gen_random_uuid(), new.id, 'Práctica intensiva de resolución de ejercicios de álgebra para Entropía.', 'Tarde', 'DAILY'),
    (gen_random_uuid(), new.id, 'Resolución de problemas de física o lógica matemática orientada a ingeniería.', 'Tarde', 'DAILY'),
    (gen_random_uuid(), new.id, 'Estudio diario / práctica de japonés.', 'Tarde', 'DAILY'),
    (gen_random_uuid(), new.id, 'Sesión técnica de kanjis y gramática japonesa avanzada.', 'Noche', 'DAILY'),
    (gen_random_uuid(), new.id, 'Práctica de expresiones conversacionales o escucha activa en japonés.', 'Noche', 'DAILY'),
    (gen_random_uuid(), new.id, 'Estiramiento, movilidad articular o prevención de lesiones post-entrenamiento.', 'Noche', 'DAILY'),
    (gen_random_uuid(), new.id, 'Mantenimiento, orden u optimización del entorno de trabajo y desarrollo (setup).', 'Noche', 'DAILY'),
    (gen_random_uuid(), new.id, 'Ejercicios de respiración, control de ansiedad o meditación para enfoque.', 'Noche', 'DAILY'),
    (gen_random_uuid(), new.id, 'Bloque de desconexión digital total y descanso mental consciente antes de dormir.', 'Noche', 'DAILY'),
    (gen_random_uuid(), new.id, 'Hacer la tarea del colegio', 'Semanal', 'WEEKLY'),
    (gen_random_uuid(), new.id, 'Hacer la tarea de la facultad', 'Semanal', 'WEEKLY'),
    (gen_random_uuid(), new.id, 'Hacer las tareas / entregables de japonés', 'Semanal', 'WEEKLY');

  insert into public.user_inventory (user_id, card_id, quantity, level)
  select new.id, c.id, 1, 1 from public.cards c
  on conflict (user_id, card_id) do nothing;

  insert into public.active_deck (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.investments (user_id, fund_type, invested_amount) values
    (new.id, 'CONSERVATIVE', 0),
    (new.id, 'AGGRESSIVE', 0)
  on conflict (user_id, fund_type) do nothing;

  return new;
end;
$$;

commit;

-- =============================================================================
-- FIN Paso 16.  Verificación post-aplicación (ver el plan, Task 3):
--   select * from public.purchase_chest(500,'BASICO');
--   select distinct time_block from public.habits order by 1;   -- solo español
--   select distinct rarity from public.cards order by 1;         -- Capitalizado
--   select oid::regprocedure::text from pg_proc
--     where proname='set_habit_status' and pronamespace='public'::regnamespace;  -- 1 fila
-- =============================================================================
