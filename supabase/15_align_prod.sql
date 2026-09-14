-- =============================================================================
-- Dojo Ledger — Paso 15: Alineación del repo con PRODUCCIÓN
-- Migración correctiva, ADITIVA, IDEMPOTENTE y GUARDADA.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere haber corrido antes:  schema.sql · seed.sql · 02..14
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--   El esquema real de producción divergió de los archivos 01..14 del repo
--   (cambios hechos a mano en el dashboard que nunca se versionaron). Este paso
--   captura EXACTAMENTE esas diferencias, de modo que correr `01..14` + `15`
--   reproduce el estado actual de prod. Fue reconstruido por introspección del
--   catálogo real (pg_type / information_schema / pg_get_functiondef) el
--   2026-09-14.
--
-- SEGURIDAD DE EJECUCIÓN
--   Cada paso chequea el estado actual antes de actuar, así que es un no-op si se
--   corre contra una base que YA está alineada (incluida la propia prod).
--
-- ⚠️  DEUDA DETECTADA EN PROD (este archivo la REPRODUCE tal cual para ser fiel;
--     NO la corrige). Ver el bloque "NOTAS / DEUDA" al final. Si querés, hacemos
--     un Paso 16 que limpie esto.
-- =============================================================================


-- =============================================================================
-- A. COLUMNAS: cambios de tipo/forma respecto de lo que crean 02/08.
--    Prod aflojó dos columnas de enum a `text` y agregó columnas nuevas.
-- =============================================================================

-- A1. habits.time_block: enum public.time_block  →  text.
--     (Permite valores fuera de los 4 bloques canónicos, p. ej. 'Semanal' o los
--      valores en inglés MORNING/COMMUTE/… que hay en los datos reales.)
do $$
begin
  if (select udt_name from information_schema.columns
       where table_schema='public' and table_name='habits' and column_name='time_block') <> 'text'
  then
    alter table public.habits alter column time_block type text using time_block::text;
  end if;
end $$;

-- A2. habits.frequency: enum public.habit_frequency (NOT NULL)  →  text (nullable, default 'DAILY').
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='habits'
      and column_name='frequency' and udt_name <> 'text'
  ) then
    alter table public.habits alter column frequency drop default;          -- default 'DAILY'::habit_frequency
    alter table public.habits alter column frequency type text using frequency::text;
    alter table public.habits alter column frequency set default 'DAILY';
    alter table public.habits alter column frequency drop not null;
  end if;
end $$;

-- A3. habits.multiplier: NUEVA en prod (numeric, default 1.0). El ×5 semanal se
--     modela por-hábito con esta columna (ya NO con frequency_reward_factor).
alter table public.habits
  add column if not exists multiplier numeric default 1.0;

-- A4. cards.rarity: enum public.card_rarity  →  text.
do $$
begin
  if (select udt_name from information_schema.columns
       where table_schema='public' and table_name='cards' and column_name='rarity') <> 'text'
  then
    alter table public.cards alter column rarity type text using rarity::text;
  end if;
end $$;

-- A5. cards.multiplier: NUEVA en prod (numeric, default 1.05). Multiplicador
--     decimal por carta (el frontend lee `multiplier ?? multiplier_percent`).
alter table public.cards
  add column if not exists multiplier numeric default 1.05;

-- A6. cards.icon_url: NUEVA en prod (text). El frontend lee `icon_url ?? image_url`.
alter table public.cards
  add column if not exists icon_url text;

-- A7. user_inventory.is_equipped: en prod es NULLABLE (el repo lo crea NOT NULL).
alter table public.user_inventory
  alter column is_equipped drop not null;


-- =============================================================================
-- B. OBJETOS DEL REPO QUE NO EXISTEN EN PROD.
--    Prod abandonó el diseño "enum de cadencia + factor ×5" del Paso 8.
-- =============================================================================

-- B1. function frequency_reward_factor(habit_frequency): no existe en prod.
drop function if exists public.frequency_reward_factor(public.habit_frequency);

-- B2. type habit_frequency: no existe en prod (ya nada lo usa tras A2/B1).
drop type if exists public.habit_frequency;


-- =============================================================================
-- C. FUNCIONES cuyo cuerpo en prod difiere del repo. Reproducidas VERBATIM del
--    catálogo de prod. `create or replace` → no-op si ya son idénticas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- C1. set_habit_status(uuid, date, habit_status)
--     Prod tiene la versión del Paso 6 (SIN frequency_reward_factor). El Paso 8
--     la había reescrito para multiplicar por el factor de cadencia; en prod esa
--     reescritura no está. La revertimos a la forma de prod.
--     ⚠️  Declara v_block public.time_block y hace `select h.time_block into v_block`;
--         como A1 dejó habits.time_block en TEXT, el cast falla en runtime para
--         valores que no sean labels válidos del enum (p. ej. 'MORNING'/'Semanal').
--         Se reproduce igual: es el estado real de prod. Ver NOTAS.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- C2. set_habit_status(uuid, date, text)  →  json      [AD-HOC, sólo en prod]
--     Este es el overload que TOLERA time_block/status en texto y hardcodea el
--     ×5 semanal (250/750). Ancla los logs semanales al lunes (date_trunc).
--     Devuelve json {success, coins_awarded, diff} (NO trae `balance`).
--     ⚠️  Convive con C1 con los MISMOS nombres de parámetro → PostgREST puede
--         no poder desambiguar la llamada del frontend. Ver NOTAS.
-- -----------------------------------------------------------------------------
create or replace function public.set_habit_status(
  p_habit_id uuid,
  p_date     date,
  p_status   text
)
returns json
language plpgsql
security definer
as $$
DECLARE
    v_user_id uuid := auth.uid();
    v_base_reward int;
    v_deck_bonus int := 0;
    v_final_reward int := 0;
    v_old_status text;
    v_old_reward int := 0;
    v_diff int;
    v_time_block text;
    v_frequency text;
    v_log_identifier date := p_date;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    SELECT time_block, frequency INTO v_time_block, v_frequency
    FROM habits WHERE id = p_habit_id AND user_id = v_user_id;

    IF v_time_block IS NULL THEN
        RAISE EXCEPTION 'Hábito no encontrado';
    END IF;

    IF v_frequency = 'WEEKLY' THEN
        v_log_identifier := date_trunc('week', p_date)::date;
    END IF;

    SELECT status, coins_awarded INTO v_old_status, v_old_reward
    FROM logs WHERE habit_id = p_habit_id AND date = v_log_identifier AND user_id = v_user_id;

    IF p_status = 'MET' THEN
        v_base_reward := CASE WHEN v_frequency = 'WEEKLY' THEN 250 ELSE 50 END;
    ELSIF p_status = 'SURPASSED' THEN
        v_base_reward := CASE WHEN v_frequency = 'WEEKLY' THEN 750 ELSE 150 END;
    ELSE
        v_base_reward := 0;
    END IF;

    IF v_base_reward > 0 THEN
        SELECT COALESCE(SUM(c.multiplier_percent), 0) INTO v_deck_bonus
        FROM active_deck ad
        JOIN lateral (
            VALUES (ad.slot_1), (ad.slot_2), (ad.slot_3), (ad.slot_4),
                   (ad.slot_5), (ad.slot_6), (ad.slot_7), (ad.slot_8)
        ) slots(card_id) ON true
        JOIN cards c ON c.id = slots.card_id
        JOIN user_inventory ui ON ui.card_id = c.id AND ui.user_id = ad.user_id
        WHERE ad.user_id = v_user_id
          AND (c.target_block IS NULL OR c.target_block = v_time_block);

        v_final_reward := ROUND(v_base_reward * (100.0 + v_deck_bonus) / 100.0);
    ELSE
        v_final_reward := 0;
    END IF;

    v_diff := v_final_reward - COALESCE(v_old_reward, 0);

    IF v_old_status IS NOT NULL THEN
        IF p_status = 'NONE' THEN
            DELETE FROM logs WHERE habit_id = p_habit_id AND date = v_log_identifier AND user_id = v_user_id;
        ELSE
            UPDATE logs SET status = p_status, coins_awarded = v_final_reward
            WHERE habit_id = p_habit_id AND date = v_log_identifier AND user_id = v_user_id;
        END IF;
    ELSE
        IF p_status <> 'NONE' THEN
            INSERT INTO logs (user_id, habit_id, date, status, coins_awarded)
            VALUES (v_user_id, p_habit_id, v_log_identifier, p_status, v_final_reward);
        END IF;
    END IF;

    UPDATE wallet SET balance = balance + v_diff WHERE user_id = v_user_id;

    RETURN json_build_object('success', true, 'coins_awarded', v_final_reward, 'diff', v_diff);
END;
$$;

-- -----------------------------------------------------------------------------
-- C3. set_habit_status(uuid, uuid, date, text)  →  numeric   [AD-HOC, sólo en prod]
--     Modelo de recompensa TOTALMENTE distinto (base 10, multiplicadores
--     decimales, estados 'completed'/'overachieved', usa habits.multiplier y
--     cards.multiplier + is_equipped). No lo llama el frontend actual.
--     ⚠️  Su upsert usa ON CONFLICT (user_id, habit_id, date), constraint que NO
--         existe (logs es UNIQUE(habit_id, date)) → fallaría si se invocara.
--         Se reproduce igual por fidelidad. Ver NOTAS.
-- -----------------------------------------------------------------------------
create or replace function public.set_habit_status(
  p_user_id  uuid,
  p_habit_id uuid,
  p_date     date,
  p_status   text
)
returns numeric
language plpgsql
security definer
as $$
DECLARE
  v_base_reward NUMERIC := 10;
  v_habit_multiplier NUMERIC;
  v_deck_multiplier NUMERIC := 1.0;
  v_reward NUMERIC := 0;
  v_new_balance NUMERIC;
BEGIN
  SELECT multiplier INTO v_habit_multiplier FROM public.habits WHERE id = p_habit_id;
  IF v_habit_multiplier IS NULL THEN
    v_habit_multiplier := 1.0;
  END IF;

  SELECT COALESCE(SUM(c.multiplier - 1.0), 0) + 1.0
  INTO v_deck_multiplier
  FROM public.user_inventory ui
  JOIN public.cards c ON ui.card_id = c.id
  WHERE ui.user_id = p_user_id AND ui.is_equipped = true;

  IF p_status = 'completed' THEN
    v_reward := v_base_reward * v_habit_multiplier * v_deck_multiplier;
  ELSIF p_status = 'overachieved' THEN
    v_reward := (v_base_reward * 1.5) * v_habit_multiplier * v_deck_multiplier;
  END IF;

  INSERT INTO public.logs (user_id, habit_id, date, status)
  VALUES (p_user_id, p_habit_id, p_date, p_status)
  ON CONFLICT (user_id, habit_id, date)
  DO UPDATE SET status = p_status;

  UPDATE public.wallet
  SET balance = balance + v_reward
  WHERE user_id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    INSERT INTO public.wallet (user_id, balance)
    VALUES (p_user_id, v_reward)
    RETURNING balance INTO v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

-- -----------------------------------------------------------------------------
-- C4. handle_new_user(): en prod siembra OTROS hábitos (los reales del usuario),
--     usa frequency TEXT ('DAILY'/'WEEKLY') y time_block 'Madrugada/Viaje/Tarde/
--     Noche' + 'Semanal'. NO setea habits.multiplier. Reproducción verbatim.
--     ⚠️  (a) No tiene `set search_path` (smell de SECURITY DEFINER).
--         (b) Busca cartas por nombre 'Libro de Viaje'/'Foco en la Ecuación' que
--             el Paso 13 ELIMINÓ → los usuarios nuevos no reciben cartas.
--         Se reproduce igual por fidelidad. Ver NOTAS.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
DECLARE
    v_card_1 uuid;
    v_card_2 uuid;
BEGIN
    INSERT INTO public.wallet (user_id, balance) VALUES (NEW.id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.habits (id, user_id, name, time_block, frequency) VALUES
        (gen_random_uuid(), NEW.id, 'Resolver ejercicio de LeetCode de lógica o estructuras de datos.', 'Madrugada', 'DAILY');

    INSERT INTO public.habits (id, user_id, name, time_block, frequency) VALUES
        (gen_random_uuid(), NEW.id, 'Lectura de no ficción o literatura técnica de sistemas durante el viaje.', 'Viaje', 'DAILY'),
        (gen_random_uuid(), NEW.id, 'Práctica de repaso de vocabulario en japonés mediante tarjetas de memoria (Anki).', 'Viaje', 'DAILY');

    INSERT INTO public.habits (id, user_id, name, time_block, frequency) VALUES
        (gen_random_uuid(), NEW.id, 'Práctica intensiva de resolución de ejercicios de álgebra para Entropía.', 'Tarde', 'DAILY'),
        (gen_random_uuid(), NEW.id, 'Resolución de problemas de física o lógica matemática orientada a ingeniería.', 'Tarde', 'DAILY'),
        (gen_random_uuid(), NEW.id, 'Estudio diario / práctica de japonés.', 'Tarde', 'DAILY');

    INSERT INTO public.habits (id, user_id, name, time_block, frequency) VALUES
        (gen_random_uuid(), NEW.id, 'Sesión técnica de kanjis y gramática japonesa avanzada.', 'Noche', 'DAILY'),
        (gen_random_uuid(), NEW.id, 'Práctica de expresiones conversacionales o escucha activa en japonés.', 'Noche', 'DAILY'),
        (gen_random_uuid(), NEW.id, 'Estiramiento, movilidad articular o prevención de lesiones post-entrenamiento.', 'Noche', 'DAILY'),
        (gen_random_uuid(), NEW.id, 'Mantenimiento, orden u optimización del entorno de trabajo y desarrollo (setup).', 'Noche', 'DAILY'),
        (gen_random_uuid(), NEW.id, 'Ejercicios de respiración, control de ansiedad o meditación para enfoque.', 'Noche', 'DAILY'),
        (gen_random_uuid(), NEW.id, 'Bloque de desconexión digital total y descanso mental consciente antes de dormir.', 'Noche', 'DAILY');

    INSERT INTO public.habits (id, user_id, name, time_block, frequency) VALUES
        (gen_random_uuid(), NEW.id, 'Hacer la tarea del colegio', 'Semanal', 'WEEKLY'),
        (gen_random_uuid(), NEW.id, 'Hacer la tarea de la facultad', 'Semanal', 'WEEKLY'),
        (gen_random_uuid(), NEW.id, 'Hacer las tareas / entregables de japonés', 'Semanal', 'WEEKLY');

    SELECT id INTO v_card_1 FROM public.cards WHERE name = 'Libro de Viaje' LIMIT 1;
    SELECT id INTO v_card_2 FROM public.cards WHERE name = 'Foco en la Ecuación' LIMIT 1;

    IF v_card_1 IS NOT NULL THEN
        INSERT INTO public.user_inventory (user_id, card_id, quantity, level)
        VALUES (NEW.id, v_card_1, 1, 1) ON CONFLICT (user_id, card_id) DO NOTHING;
    END IF;
    IF v_card_2 IS NOT NULL THEN
        INSERT INTO public.user_inventory (user_id, card_id, quantity, level)
        VALUES (NEW.id, v_card_2, 1, 1) ON CONFLICT (user_id, card_id) DO NOTHING;
    END IF;

    INSERT INTO public.active_deck (user_id, slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8)
    VALUES (NEW.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.investments (user_id, fund_type, invested_amount) VALUES
        (NEW.id, 'CONSERVATIVE', 0),
        (NEW.id, 'AGGRESSIVE', 0)
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

-- Grants de los overloads de set_habit_status presentes en prod.
grant execute on function public.set_habit_status(uuid, date, text)        to authenticated;
grant execute on function public.set_habit_status(uuid, uuid, date, text)  to authenticated;


-- =============================================================================
-- D. POLÍTICAS: prod tiene una policy extra en habits (además de habits_owner).
--    SELECT para el rol `public` con la misma condición de dueño.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='habits'
      and policyname='Permitir lectura de habitos'
  ) then
    create policy "Permitir lectura de habitos" on public.habits
      for select to public
      using (auth.uid() = user_id);
  end if;
end $$;


-- =============================================================================
-- NOTAS / DEUDA TÉCNICA detectada en producción (reproducida arriba, NO corregida)
-- -----------------------------------------------------------------------------
-- 1. Overloads ambiguos de set_habit_status: C1 (…, habit_status) y C2 (…, text)
--    comparten los nombres (p_habit_id, p_date, p_status). El frontend llama con
--    p_status string → PostgREST puede fallar por ambigüedad, o resolver a C2
--    (json, sin `balance`). C1 además castea time_block text→enum y revienta con
--    valores no canónicos ('MORNING'/'Semanal').  → Recomendado: dejar UNA sola.
-- 2. set_habit_status(uuid,uuid,date,text) (C3) hace ON CONFLICT (user_id,
--    habit_id, date) que no matchea ninguna unique de logs → error si se invoca.
-- 3. handle_new_user (C4): SECURITY DEFINER sin search_path; y siembra cartas por
--    nombre borradas en el Paso 13 → usuarios nuevos sin cartas. Además usa
--    time_block 'Semanal' y no setea habits.multiplier (los semanales quedan en
--    multiplier=1.0; el ×5 sólo lo aplica C2 por frequency).
-- 4. Datos: los hábitos reales del usuario tienen time_block en INGLÉS
--    (MORNING/COMMUTE/AFTERNOON/NIGHT); el frontend los normaliza al cargar
--    (Paso previo, normalizeTimeBlock en src/lib/constants.ts).
-- 5. cards.rarity en prod trae valores en minúscula ('common'), pero purchase_chest
--    compara contra el enum capitalizado ('Common') → cae siempre al fallback
--    aleatorio de carta.
--
-- Si querés, un Paso 16 puede: unificar set_habit_status en una sola versión,
-- corregir handle_new_user (search_path + cartas del lootpool actual), y
-- normalizar los datos (time_block/rarity). No se hace acá para no cambiar el
-- comportamiento de prod sin tu OK.
-- =============================================================================
-- FIN Paso 15.
-- =============================================================================
