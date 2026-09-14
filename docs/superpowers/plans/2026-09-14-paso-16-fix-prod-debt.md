# Paso 16 — Corrección de deudas de prod · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir 5 deudas técnicas de producción (funciones ambiguas/rotas, datos desalineados, policy redundante) mediante una única migración SQL transaccional, sin cambiar la economía del juego.

**Architecture:** Un solo archivo `supabase/16_fix_prod_debt.sql` que se corre a mano en el SQL Editor de Supabase dentro de una transacción. Idempotente. El repo lo versiona; su ejecución contra prod la hace el usuario (solo él tiene acceso a la DB). El frontend no cambia.

**Tech Stack:** PostgreSQL (Supabase), PL/pgSQL, plpgsql SECURITY DEFINER, RLS.

## Global Constraints

- No cambiar la economía: base MET=50 / SURPASSED=150; semanal ×5 (250/750); bonus del mazo = `sum(cards.multiplier_percent)` de las equipadas (por bloque o global), **sin** escalar por nivel de carta.
- Todo el archivo corre en **una transacción**; cualquier error → rollback total.
- Idempotente: `drop … if exists`, `create or replace`, `update` solo sobre filas que difieren.
- No reintroducir el constraint enum en `habits.time_block` (los semanales usan `'Semanal'`, fuera del enum de 4 bloques). Las columnas siguen `text`.
- Etiquetas canónicas en español: `Madrugada, Viaje, Tarde, Noche` (+ `Semanal` para semanales). Rarezas capitalizadas: `Common, Rare, Epic, Legendary`.
- Runner: SQL Editor de Supabase (proyecto `fwbkiziezaydsttrucns`). El agente NO tiene acceso de ejecución a la DB → los pasos de dry-run/apply/verify los ejecuta el usuario.
- `p_status` que envía el front: `'NONE' | 'MET' | 'SURPASSED'`.
- Convención de commits del repo: mensajes `fix:/docs:/feat:` en `master`, push a `origin/master`.

---

### Task 1: Autorear la migración `supabase/16_fix_prod_debt.sql` y commitearla

**Files:**
- Create: `supabase/16_fix_prod_debt.sql`
- Reference (no modificar): `supabase/15_align_prod.sql`, `docs/superpowers/specs/2026-09-14-paso-16-fix-prod-debt-design.md`

**Interfaces:**
- Consumes: esquema real de prod tras el Paso 15 (tablas `habits`, `cards`, `logs`, `wallet`, `active_deck`, `user_inventory`, `investments`; enums `time_block`, `card_rarity`, `habit_status`, `fund_type`; trigger `on_auth_user_created`).
- Produces: función `public.set_habit_status(uuid, date, text) RETURNS TABLE(balance integer, log_status text, coins_awarded integer)` (único overload de 3-args tras esta migración); `public.purchase_chest(integer, text)` con comparación de rareza en texto; `public.handle_new_user()` con `search_path` y siembra por catálogo.

- [ ] **Step 1: Crear el archivo con el envoltorio transaccional y encabezado**

Crear `supabase/16_fix_prod_debt.sql` con:

```sql
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
-- SIN cambio de economía. Correr primero como DRY-RUN (ver Task 2).
-- =============================================================================

begin;

-- (las secciones 1..5 se agregan en los pasos siguientes)

commit;
```

- [ ] **Step 2: Sección 5 — dropear la policy redundante (primero, es lo más simple)**

Insertar antes de `commit;`:

```sql
-- 5. Policy redundante en habits (duplica habits_owner).
drop policy if exists "Permitir lectura de habitos" on public.habits;
```

- [ ] **Step 3: Sección 4 — normalización de datos**

Insertar a continuación:

```sql
-- 4. Normalización de datos existentes.
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
```

- [ ] **Step 4: Sección 1 — unificar `set_habit_status`**

Insertar a continuación (drops + create único):

```sql
-- 1. set_habit_status: un solo overload (uuid,date,text)->TABLE, con balance.
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
```

- [ ] **Step 5: Sección 2 — `purchase_chest` (fix del gacha)**

Insertar a continuación (cuerpo completo; la única diferencia funcional vs prod es `rarity = v_rarity::text`):

```sql
-- 2. purchase_chest: comparar rarity (text) contra la rareza sorteada en texto.
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
```

- [ ] **Step 6: Sección 3 — `handle_new_user` (arreglo completo)**

Insertar a continuación:

```sql
-- 3. handle_new_user: search_path + siembra una copia de cada carta del catálogo.
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
```

- [ ] **Step 7: Auto-revisión de sintaxis del archivo**

Leer el archivo completo y verificar: (a) un solo `begin;` al inicio y un solo `commit;` al final, con todas las secciones en el medio; (b) cada función cierra con `$$;`; (c) sin `TODO`/placeholder; (d) orden = policy → datos → set_habit_status → purchase_chest → handle_new_user.

Run: `grep -nE "begin;|commit;|\\\$\\\$;" supabase/16_fix_prod_debt.sql`
Expected: exactamente un `begin;`, un `commit;`, y tres `$$;` (una por función).

- [ ] **Step 8: Commit del archivo al repo**

```bash
git add supabase/16_fix_prod_debt.sql
git commit -m "feat(db): Paso 16 - corregir deudas de prod (set_habit_status unificado, gacha, handle_new_user, normalizacion)"
git push origin master
```

---

### Task 2: Dry-run contra prod (lo ejecuta el usuario)

**Files:** ninguno (validación).

**Interfaces:**
- Consumes: `supabase/16_fix_prod_debt.sql` de la Task 1.
- Produces: confirmación de que el archivo ejecuta sin errores contra el esquema real.

- [ ] **Step 1: Preparar el dry-run**

El archivo ya está envuelto en `begin; … commit;`. Para el dry-run, el usuario reemplaza mentalmente el `commit;` final por `rollback;` (o pega el contenido entre `begin;` y `rollback;`) en el SQL Editor de Supabase, para NO persistir.

- [ ] **Step 2: Ejecutar el dry-run**

Run (en Supabase SQL Editor): pegar el contenido del archivo con `rollback;` en lugar de `commit;` y ejecutar.
Expected: se ejecuta sin errores y termina con "ROLLBACK" (nada persistido). Si aparece un error de sintaxis/dependencia, anotar el mensaje.

- [ ] **Step 3: Si hubo error, corregir y volver**

Si el dry-run falla: corregir `supabase/16_fix_prod_debt.sql`, recommitear (repetir Task 1 Step 8) y volver a correr el dry-run. No avanzar a Task 3 hasta que el dry-run pase limpio.

---

### Task 3: Aplicar a prod y verificar (lo ejecuta el usuario)

**Files:** ninguno (ejecución sobre prod).

**Interfaces:**
- Consumes: archivo validado en Task 2.
- Produces: prod con las 5 deudas corregidas.

- [ ] **Step 1: Aplicar la migración**

Run (Supabase SQL Editor): pegar/ejecutar el archivo tal cual (con `commit;`).
Expected: "COMMIT", sin errores.

- [ ] **Step 2: Verificar el gacha**

Run: `select * from public.purchase_chest(500, 'BASICO');`
Expected: una fila con `won_card_id` no nulo (una carta del catálogo). Repetir 2-3 veces: las rarezas deben respetar aproximadamente los pesos (mayoría Common) y NO caer siempre al fallback.

- [ ] **Step 3: Verificar normalización de datos**

Run: `select distinct time_block from public.habits order by 1;`
Expected: solo `Madrugada, Noche, Semanal, Tarde, Viaje` (sin MORNING/COMMUTE/…).

Run: `select distinct rarity from public.cards order by 1;`
Expected: solo `Common, Epic, Legendary, Rare`.

- [ ] **Step 4: Verificar overloads de set_habit_status**

Run:
```sql
select oid::regprocedure::text
from pg_proc
where proname = 'set_habit_status' and pronamespace = 'public'::regnamespace;
```
Expected: **una sola** fila → `set_habit_status(uuid,date,text)`.

- [ ] **Step 5: Verificar policy**

Run: `select policyname from pg_policies where schemaname='public' and tablename='habits' order by 1;`
Expected: `habits_owner` (y ya NO `Permitir lectura de habitos`).

---

### Task 4: Smoke test en el deploy y cierre

**Files:** ninguno (verificación end-to-end en producción).

**Interfaces:**
- Consumes: prod migrado (Task 3).
- Produces: confirmación de que el frontend sigue funcionando y el marcado suma monedas.

- [ ] **Step 1: Recargar el deploy**

Abrir `https://habits-tracker-app-ten.vercel.app/` (navegador) y esperar el auto-login. Los hábitos deben seguir en sus bloques (Madrugada/Viaje/Tarde/Noche) — ahora incluso sin depender de `normalizeTimeBlock`.

- [ ] **Step 2: Marcar un hábito diario**

Marcar un diario como "Hecho" (MET). Expected: aparece +50 (× bonus del mazo si hay) y el saldo de monedas del header se actualiza al instante (porque `set_habit_status` ahora devuelve `balance`).

- [ ] **Step 3: Marcar un hábito semanal**

Marcar un semanal como "Hecho". Expected: +250 (×5). El estado persiste al recargar (log anclado al lunes).

- [ ] **Step 4: Confirmar sin errores en consola**

Revisar la consola del navegador: sin errores de RPC (`set_habit_status`) ni PGRST203 (ambigüedad).

- [ ] **Step 5: Cierre**

Confirmar que el spec y la migración quedaron versionados en `master`. Opcional (fuera de alcance): un Paso 17 podría remover `normalizeTimeBlock` del front ahora que los datos están normalizados.

---

## Self-Review

**Spec coverage:**
- Deuda 1 (set_habit_status ambiguo/roto) → Task 1 Step 4 (unificación) + Task 3 Step 4 (verificación un solo overload). ✅
- Deuda 2 (overload 4-args muerto) → Task 1 Step 4 (`drop … (uuid,uuid,date,text)`). ✅
- Deuda 3 (handle_new_user sin search_path / cartas borradas) → Task 1 Step 6. ✅
- Deuda 4 (time_block en inglés) → Task 1 Step 3 (4a) + Task 3 Step 3. ✅
- Deuda 5 (rarity minúscula rompe gacha) → Task 1 Step 3 (4b) + Task 1 Step 5 (purchase_chest fix) + Task 3 Step 2. ✅
- Policy redundante → Task 1 Step 2 + Task 3 Step 5. ✅
- Economía preservada → constraints globales + Task 1 Step 4 (50/150, ×5, bonus sin nivel). ✅
- Transacción/idempotencia → Task 1 Step 1 (begin/commit) + dry-run Task 2. ✅

**Placeholder scan:** sin TODO/TBD; todo el SQL está completo e inline. ✅

**Type consistency:** `set_habit_status(uuid,date,text)` con retorno `TABLE(balance integer, log_status text, coins_awarded integer)` usado consistentemente entre Task 1 (Produces) y Task 3 Step 4. `purchase_chest(integer,text)` y `handle_new_user()` con firmas idénticas a prod. ✅

**Nota de ejecución:** el agente no puede correr SQL contra prod; Tasks 2-3 las ejecuta el usuario en el SQL Editor. Task 1 (autoría/commit) y Task 4 (smoke con navegador) sí las puede hacer el agente.
