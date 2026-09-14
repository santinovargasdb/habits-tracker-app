# Paso 16 — Corrección de deudas técnicas de producción

- **Fecha:** 2026-09-14
- **Estado:** Diseño aprobado (pendiente de plan de implementación)
- **Repo:** santinovargasdb/habits-tracker-app
- **Depende de:** `supabase/15_align_prod.sql` (que documentó el estado real de prod)

## Contexto

El Paso 15 alineó el SQL del repo con el estado real de producción (reconstruido por
introspección del catálogo el 2026-09-14) y **documentó** 5 deudas que reproduce pero
no corrige. El Paso 16 corrige esas deudas **sin cambiar la economía del juego**.

Lineage: `schema.sql` + `02…15` = prod actual (desprolijo). `+ 16` = prod limpio.
A diferencia del 15 (documental/inerte), **el 16 modifica prod y debe ejecutarse**.

### Deudas a corregir (detectadas en prod)

1. `set_habit_status` tiene **3 overloads** con economías distintas; dos de 3-args
   comparten nombres de parámetro → ambigüedad de PostgREST. El typed (`habit_status`)
   castea `time_block` texto→enum y revienta con valores no canónicos.
2. El overload de 4-args usa `ON CONFLICT (user_id, habit_id, date)`, constraint que
   no existe → error si se invoca (muerto).
3. `handle_new_user` es `SECURITY DEFINER` **sin `search_path`**, y siembra cartas
   buscando por nombre (`'Libro de Viaje'`, `'Foco en la Ecuación'`) borradas en el
   Paso 13 → usuarios nuevos **sin cartas**.
4. `habits.time_block` tiene datos en **inglés** (MORNING/COMMUTE/AFTERNOON/NIGHT);
   el front los normaliza al cargar (parche previo `normalizeTimeBlock`).
5. `cards.rarity` está en **minúscula** (`'common'`) y `purchase_chest` compara contra
   el enum capitalizado → el gacha nunca acierta la rareza pedida (cae al fallback).

## Objetivo y no-objetivos

**Objetivo:** dejar el esquema de prod internamente consistente y sin bugs latentes,
preservando la economía actual y el contrato que el frontend ya consume.

**No-objetivos:**
- No cambiar la economía (montos 50/150 diario, ×5 semanal = 250/750, + bonus del mazo).
- No reintroducir el constraint enum en `habits.time_block` (los semanales usan
  `'Semanal'`, que no es un valor del enum de 4 bloques). Las columnas siguen `text`.
- No refactors ajenos a estas 5 deudas.

## Decisiones tomadas (brainstorming 2026-09-14)

- **Modelo de recompensa:** preservar la economía actual, pero con **una sola** función
  que devuelve `{balance, log_status, coins_awarded}` y tolera `time_block` texto.
- **Datos:** normalizar ambos — `habits.time_block` (inglés→español) y `cards.rarity`
  (→ Capitalizado).
- **`handle_new_user`:** arreglo completo (`search_path` + una copia de cada carta del
  catálogo actual).
- **Policy redundante:** dropear `"Permitir lectura de habitos"`.

## Diseño

Entregable: `supabase/16_fix_prod_debt.sql`. Idempotente; pensado para correrse en una
transacción (dry-run con `BEGIN … ROLLBACK` primero).

### 1. Unificar `set_habit_status`

Se dropean los 3 overloads y se crea **uno** `(uuid, date, text) → TABLE`. Como queda
un único overload de 3-args, PostgREST resuelve sin ambigüedad. La economía es la que
corre hoy (base 50/150, ×5 semanal, bonus del mazo por `multiplier_percent` sin escalar
por nivel), pero ahora devuelve `balance` (lo que el front usa) y lee `time_block` como
texto (sin cast a enum).

```sql
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

  -- Los semanales anclan el log al lunes de la semana.
  if v_is_weekly then
    v_log_date := date_trunc('week', p_date)::date;
  end if;

  select coalesce(l.coins_awarded, 0) into v_old_reward
  from public.logs l
  where l.habit_id = p_habit_id and l.date = v_log_date and l.user_id = v_uid;
  v_old_reward := coalesce(v_old_reward, 0);

  -- Base por estado (×5 semanal). p_status esperado: 'NONE' | 'MET' | 'SURPASSED'.
  v_base := case upper(coalesce(p_status, 'NONE'))
              when 'MET'       then 50
              when 'SURPASSED' then 150
              else 0
            end;
  if v_is_weekly then
    v_base := v_base * 5;
  end if;

  -- Bonus del mazo: multiplier_percent de las cartas equipadas (por bloque o global).
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

  -- Upsert/borrado del log (NONE = desmarcar).
  if upper(coalesce(p_status, 'NONE')) = 'NONE' then
    delete from public.logs
    where habit_id = p_habit_id and date = v_log_date and user_id = v_uid;
  else
    insert into public.logs (user_id, habit_id, date, status, coins_awarded)
    values (v_uid, p_habit_id, v_log_date, p_status::public.habit_status, v_final)
    on conflict (habit_id, date) do update
      set status = excluded.status,
          coins_awarded = excluded.coins_awarded,
          updated_at = now();
  end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0)
  on conflict (user_id) do nothing;

  update public.wallet
    set balance = public.wallet.balance + v_delta, updated_at = now()
    where user_id = v_uid
    returning public.wallet.balance into v_balance;

  return query select v_balance, p_status, v_final;
end;
$$;

grant execute on function public.set_habit_status(uuid, date, text) to authenticated;
```

Notas:
- El bonus usa `sum(multiplier_percent)` **sin** `effective_multiplier` (sin escalar por
  nivel de carta), para igualar la economía que corre hoy.
- `deck_multiplier_percent(time_block)` queda **sin uso** tras dropear el overload typed;
  es inofensiva, se deja tal cual (no se dropea para no tocar más superficie).
- El frontend (`src/actions/habits.ts`) ya lee `data[0].balance` y `data[0].coins_awarded`
  → **no requiere cambios**.

### 2. `purchase_chest` — companion del gacha

Necesario para que la normalización de rareza (sección 4) sirva: la columna `rarity` es
`text`, así que la comparación contra el enum se hace explícita en texto.

```sql
-- Cambia SOLO la comparación de rareza:
--   antes:  where rarity = v_rarity
--   ahora:  where rarity = v_rarity::text
-- (resto del cuerpo idéntico al de prod / Paso 15)
```

### 3. `handle_new_user` — arreglo completo

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public          -- (1) cierra el smell de SECURITY DEFINER
as $$
begin
  insert into public.wallet (user_id, balance) values (new.id, 0)
  on conflict (user_id) do nothing;

  -- Hábitos seed (los reales actuales; time_block en español + 'Semanal').
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

  -- (2) Inventario inicial: una copia de CADA carta del catálogo actual.
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
```

El trigger `on_auth_user_created` en `auth.users` ya existe y no cambia.

### 4. Normalización de datos (idempotente)

```sql
-- time_block: inglés → español canónico (los ya-español no se tocan).
update public.habits h set time_block = m.canon
from (values
  ('MORNING','Madrugada'), ('COMMUTE','Viaje'),
  ('AFTERNOON','Tarde'),   ('NIGHT','Noche'),
  ('WEEKLY','Semanal')
) as m(raw, canon)
where upper(h.time_block) = m.raw and h.time_block <> m.canon;

-- rarity: → Capitalizado ('common' → 'Common', etc.).
update public.cards
set rarity = initcap(lower(rarity))
where rarity is not null and rarity <> initcap(lower(rarity));
```

### 5. Limpiar policy redundante

```sql
drop policy if exists "Permitir lectura de habitos" on public.habits;
```

## Seguridad, idempotencia y orden

- Todo el archivo se corre en **una transacción**; si algo falla, rollback total.
- Orden: (5) drop policy → (4) normalizar datos → (1) unificar función → (2) purchase_chest
  → (3) handle_new_user. (Las funciones se recrean con `create or replace`; los drops de
  overloads van antes del `create` nuevo por el cambio de tipo de retorno.)
- Idempotente: `drop … if exists`, `create or replace`, y los `update` sólo tocan filas
  que difieren.
- **Dry-run obligatorio** antes de aplicar: `BEGIN; <archivo>; ROLLBACK;` en el SQL Editor.

## Verificación (post-aplicación)

1. Gacha: `select * from purchase_chest(500, 'BASICO');` devuelve una carta de rareza
   coherente con los pesos (ya no siempre fallback).
2. Marcar hábito diario MET → `set_habit_status` devuelve `balance` y `coins_awarded=50`
   (× bonus si hay mazo); el saldo del front se actualiza al instante.
3. Semanal MET → `coins_awarded = 250` (×5) y el log queda anclado al lunes.
4. `select distinct time_block from habits;` → sólo español (`Madrugada/Viaje/Tarde/Noche/Semanal`).
5. `select distinct rarity from cards;` → sólo `Common/Rare/Epic/Legendary`.
6. Smoke visual en el deploy: los hábitos siguen en sus bloques (ahora incluso sin depender
   de `normalizeTimeBlock`); el marcado suma monedas.

## Impacto en el frontend

Ninguno requerido. `normalizeTimeBlock` (parche previo) queda como defensa inofensiva.
Opcional (fuera de alcance): removerla una vez confirmada la normalización de datos.

## Riesgos

- Mutación de datos en prod: mitigado por transacción + dry-run + `updates` acotados.
- Si existieran `time_block` fuera del set esperado, la normalización los deja intactos
  (caen en "Otros" en la UI, igual que hoy) — no rompe nada.
