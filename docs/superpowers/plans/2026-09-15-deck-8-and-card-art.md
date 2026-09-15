# Mazo de 8 cartas + arte real de las cartas — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El mazo equipa hasta 8 cartas que suman su % de bonus (con nivel) a la recompensa de los hábitos, y cada carta muestra su arte real de Clash Royale servido localmente (offline).

**Architecture:** Fuente de verdad única del mazo = `user_inventory.is_equipped`. Una migración reescribe `set_habit_status` para sumar el bonus de las cartas equipadas (vía `effective_multiplier`, incluye nivel) y puebla `cards.multiplier_percent` (hoy 0). El arte se descarga del CDN de RoyaleAPI a `/public/cards/*.png` y otra migración apunta `icon_url`/`image_url` a esos paths. El service worker cachea `/cards/`.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Supabase (Postgres + PostgREST), Vitest 2, Service Worker.

## Global Constraints

- **Tests:** Vitest. Correr con `npm test` (= `vitest run`). Los tests nuevos no deben requerir red.
- **Migraciones:** aditivas e idempotentes; el usuario las corre a mano en Supabase → SQL Editor. Apuntan a **PRODUCCIÓN**, que divergió del repo (nombres en español, `multiplier_percent=0`, arte en `icon_url`).
- **Tope de equipadas:** `MAX_EQUIPPED = 8` (exacto). El servidor y el cliente leen la misma constante.
- **Valores de bonus por rareza (enteros):** `Common 5 · Rare 10 · Epic 20 · Legendary 35` (derivados de `cards.multiplier` = 1.05/1.10/1.20/1.35).
- **Multiplicador efectivo:** `effective_multiplier(base, level) = base + GREATEST(level-1,0) * 5` (ya existe en la DB y en `src/lib/constants.ts` como `effectiveMultiplier`). El bonus del mazo suma el efectivo de cada carta equipada.
- **Cartas globales:** en prod todas tienen `target_block = NULL` → toda carta equipada aplica a todo bloque. El código igual conserva el filtro por bloque para el futuro.
- **Lectura del arte en el frontend:** `icon_url ?? image_url` (prioridad a `icon_url`). La migración setea **ambas** columnas.
- **Arte local:** `/public/cards/<slug>.png`. Los 40 slugs están **validados** contra `https://cdn.royaleapi.com/static/img/cards-150/<slug>.png` (los 40 devuelven 200).
- **Commits:** un commit por tarea. Mensajes `feat(mazo): …` / `feat(cartas): …`. Trabajar en una rama feature (la crea subagent-driven).

---

## Estructura de archivos

- `src/lib/deck.ts` (nuevo) — helper puro `equippedMultiplierForBlock(inventory, block)`.
- `src/lib/deck.test.ts` (nuevo) — tests del helper.
- `src/lib/cards.ts` (nuevo) — helper puro `rowToCard(row)` (normaliza fila cruda de la DB → `Card`).
- `src/lib/cards.test.ts` (nuevo) — tests de normalización (multiplier_percent, precedencia de icono).
- `src/lib/card-art-map.ts` (nuevo) — mapa `{ id, name, slug }[]` de las 40 cartas de prod.
- `src/lib/card-art-map.test.ts` (nuevo) — chequeo de assets (archivos existen + PNG válido) y consistencia.
- `scripts/fetch-card-art.mjs` (nuevo) — descarga las 40 PNG a `public/cards/`.
- `public/cards/*.png` (nuevos, 40) — arte local.
- `public/sw.js` (modificar) — cache-first para `/cards/` + bump de versión de cache.
- `src/lib/constants.ts` (modificar) — `MAX_EQUIPPED = 8`.
- `src/lib/game-context.tsx` (modificar) — `multiplierForBlock` usa `equippedMultiplierForBlock`.
- `src/app/page.tsx` (modificar) — usa `rowToCard` para el catálogo.
- `supabase/19_deck_equipped_multiplier.sql` (nuevo) — poblar `multiplier_percent`, reescribir recompensa desde equipadas, trigger de tope 8.
- `supabase/20_card_local_art.sql` (nuevo) — `icon_url`/`image_url` → `/cards/<slug>.png`.

---

## Task 1: Cliente — tope 8, estimador del mazo por equipadas, normalización de cartas

**Files:**
- Create: `src/lib/deck.ts`
- Test: `src/lib/deck.test.ts`
- Create: `src/lib/cards.ts`
- Test: `src/lib/cards.test.ts`
- Modify: `src/lib/constants.ts:138`
- Modify: `src/lib/game-context.tsx:95-112`
- Modify: `src/app/page.tsx:80-95`

**Interfaces:**
- Consumes: `OwnedCard` (de `src/lib/types.ts`: `{ id, card: Card, quantity, level, is_equipped }`), `Card` (`{ id, name, rarity, target_block, multiplier_percent, description, image_url }`), `effectiveMultiplier(base, level)` (de `src/lib/constants.ts`), `CardRarity`, `TimeBlock`.
- Produces:
  - `equippedMultiplierForBlock(inventory: OwnedCard[], block: TimeBlock): number`
  - `rowToCard(row: Record<string, unknown>): Card`

- [ ] **Step 1: Escribir el test del helper del mazo (falla)**

Create `src/lib/deck.ts` con un stub para que compile el import:

```ts
import type { OwnedCard, TimeBlock } from "@/lib/types";

export function equippedMultiplierForBlock(
  _inventory: OwnedCard[],
  _block: TimeBlock,
): number {
  return -1; // stub: hará fallar el test
}
```

Create `src/lib/deck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { equippedMultiplierForBlock } from "./deck";
import type { Card, OwnedCard, TimeBlock } from "@/lib/types";

function card(partial: Partial<Card>): Card {
  return {
    id: partial.id ?? "c1",
    name: partial.name ?? "Carta",
    rarity: partial.rarity ?? "Common",
    target_block: partial.target_block ?? null,
    multiplier_percent: partial.multiplier_percent ?? 0,
    description: partial.description ?? "",
    image_url: partial.image_url ?? null,
  };
}
function owned(p: { id: string; is_equipped: boolean; level?: number; card: Partial<Card> }): OwnedCard {
  return { id: p.id, card: card(p.card), quantity: 1, level: p.level ?? 1, is_equipped: p.is_equipped };
}

describe("equippedMultiplierForBlock", () => {
  it("suma sólo las cartas equipadas", () => {
    const inv: OwnedCard[] = [
      owned({ id: "a", is_equipped: true, card: { multiplier_percent: 5 } }),
      owned({ id: "b", is_equipped: false, card: { multiplier_percent: 20 } }),
      owned({ id: "c", is_equipped: true, card: { multiplier_percent: 10 } }),
    ];
    expect(equippedMultiplierForBlock(inv, "Tarde" as TimeBlock)).toBe(15);
  });

  it("incluye el bonus por nivel (base + (nivel-1)*5)", () => {
    const inv: OwnedCard[] = [
      owned({ id: "a", is_equipped: true, level: 3, card: { multiplier_percent: 10 } }), // 10 + 2*5 = 20
    ];
    expect(equippedMultiplierForBlock(inv, "Tarde" as TimeBlock)).toBe(20);
  });

  it("las cartas globales (target_block null) cuentan para cualquier bloque", () => {
    const inv: OwnedCard[] = [
      owned({ id: "a", is_equipped: true, card: { target_block: null, multiplier_percent: 7 } }),
    ];
    expect(equippedMultiplierForBlock(inv, "Noche" as TimeBlock)).toBe(7);
  });

  it("una carta con target_block específico sólo cuenta para ESE bloque", () => {
    const inv: OwnedCard[] = [
      owned({ id: "a", is_equipped: true, card: { target_block: "Tarde" as TimeBlock, multiplier_percent: 8 } }),
    ];
    expect(equippedMultiplierForBlock(inv, "Tarde" as TimeBlock)).toBe(8);
    expect(equippedMultiplierForBlock(inv, "Noche" as TimeBlock)).toBe(0);
  });

  it("inventario vacío → 0", () => {
    expect(equippedMultiplierForBlock([], "Tarde" as TimeBlock)).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/lib/deck.test.ts`
Expected: FAIL (el stub devuelve -1, los `expect` no matchean).

- [ ] **Step 3: Implementar el helper del mazo**

Replace `src/lib/deck.ts`:

```ts
import { effectiveMultiplier } from "@/lib/constants";
import type { OwnedCard, TimeBlock } from "@/lib/types";

/**
 * Suma el multiplicador EFECTIVO (base + bonus de nivel) de las cartas
 * equipadas que aplican a `block` (o globales, target_block null).
 * Espeja el cálculo server-side de `set_habit_status` (migración 19).
 */
export function equippedMultiplierForBlock(
  inventory: OwnedCard[],
  block: TimeBlock,
): number {
  let total = 0;
  for (const o of inventory) {
    if (!o.is_equipped) continue;
    const tb = o.card.target_block;
    if (tb === null || tb === block) {
      total += effectiveMultiplier(o.card.multiplier_percent, o.level);
    }
  }
  return total;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/deck.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Escribir el test de normalización de cartas (falla)**

Create `src/lib/cards.ts` con stub:

```ts
import type { Card } from "@/lib/types";

export function rowToCard(_row: Record<string, unknown>): Card {
  return null as unknown as Card; // stub
}
```

Create `src/lib/cards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rowToCard } from "./cards";

describe("rowToCard", () => {
  it("usa multiplier_percent entero cuando existe (>0)", () => {
    const c = rowToCard({ id: "x", name: "Mago", rarity: "Rare", target_block: null, multiplier_percent: 10, multiplier: "1.10", icon_url: "/cards/wizard.png" });
    expect(c.multiplier_percent).toBe(10);
  });

  it("prioriza icon_url sobre image_url para el arte", () => {
    const c = rowToCard({ id: "x", name: "Mago", rarity: "Rare", icon_url: "/cards/wizard.png", image_url: "/otro.png" });
    expect(c.image_url).toBe("/cards/wizard.png");
  });

  it("cae a image_url si no hay icon_url", () => {
    const c = rowToCard({ id: "x", name: "Mago", rarity: "Rare", icon_url: null, image_url: "/cards/wizard.png" });
    expect(c.image_url).toBe("/cards/wizard.png");
  });

  it("target_block null cuando falta", () => {
    const c = rowToCard({ id: "x", name: "Mago", rarity: "Rare" });
    expect(c.target_block).toBeNull();
    expect(c.multiplier_percent).toBe(0);
  });
});
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `npm test -- src/lib/cards.test.ts`
Expected: FAIL (el stub devuelve null → lanza al leer `.multiplier_percent`).

- [ ] **Step 7: Implementar `rowToCard`**

Replace `src/lib/cards.ts`:

```ts
import type { Card, CardRarity, TimeBlock } from "@/lib/types";

/**
 * Normaliza una fila cruda de `public.cards` (que puede venir de prod con
 * columnas divergentes) a nuestro tipo `Card`.
 * - `multiplier_percent`: entero del catálogo; si viniera sólo `multiplier`
 *   (numeric, PostgREST lo manda como string tipo "1.10"), se deriva a %.
 * - arte: `icon_url ?? image_url`.
 */
export function rowToCard(row: Record<string, unknown>): Card {
  const mp = row.multiplier_percent;
  const mult = row.multiplier;
  let multiplier_percent = 0;
  if (typeof mp === "number") {
    multiplier_percent = mp;
  } else if (mult != null && !Number.isNaN(Number(mult))) {
    multiplier_percent = Math.round((Number(mult) - 1) * 100);
  }
  return {
    id: String(row.id),
    name: String(row.name ?? "Carta"),
    rarity: (row.rarity as CardRarity) ?? "Common",
    target_block: (row.target_block ?? null) as TimeBlock | null,
    multiplier_percent,
    description: String(row.description ?? ""),
    image_url: (row.icon_url ?? row.image_url ?? null) as string | null,
  };
}
```

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/cards.test.ts`
Expected: PASS (4/4).

- [ ] **Step 9: Subir el tope a 8**

Modify `src/lib/constants.ts` línea 138:

```ts
/** Tope duro de cartas equipadas (mazo activo por is_equipped). */
export const MAX_EQUIPPED = 8;
```

- [ ] **Step 10: Conectar `multiplierForBlock` a las equipadas**

Modify `src/lib/game-context.tsx`. Agregar el import (junto a los otros de `@/lib/...`):

```ts
import { equippedMultiplierForBlock } from "@/lib/deck";
```

Reemplazar el `useCallback` de `multiplierForBlock` (actual líneas ~95-112, que itera `deck`) por:

```ts
  const multiplierForBlock = useCallback(
    (block: TimeBlock) => equippedMultiplierForBlock(inventory, block),
    [inventory],
  );
```

(Se deja de usar `deck`/`cardMap`/`levelMap` en este cálculo; no borrar esas variables porque `equip`/`unequip`/`slotOf` las siguen usando.)

- [ ] **Step 11: Usar `rowToCard` en el catálogo del servidor**

Modify `src/app/page.tsx`. Agregar el import:

```ts
import { rowToCard } from "@/lib/cards";
```

Reemplazar el `.map((c) => ({ ... }))` del catálogo (actual líneas ~81-94) por:

```ts
      cards = dbCards.map(rowToCard);
```

- [ ] **Step 12: Correr toda la suite y typecheck**

Run: `npm test`
Expected: PASS (incluyendo los tests previos existentes).
Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 13: Commit**

```bash
git add src/lib/deck.ts src/lib/deck.test.ts src/lib/cards.ts src/lib/cards.test.ts src/lib/constants.ts src/lib/game-context.tsx src/app/page.tsx
git commit -m "feat(mazo): tope 8, estimador por cartas equipadas y normalizacion de cartas"
```

---

## Task 2: Migración 19 — recompensa desde equipadas + poblar `multiplier_percent` + tope duro

**Files:**
- Create: `supabase/19_deck_equipped_multiplier.sql`

**Interfaces:**
- Consumes (existen en prod): `public.effective_multiplier(integer, integer)`, tabla `public.user_inventory (user_id, card_id, level, is_equipped)`, tabla `public.cards (id, rarity, target_block, multiplier_percent)`, `auth.uid()`, `public.status_value`/valores 50/150 inline, `public.wallet (user_id, balance)`, `public.logs (user_id, habit_id, date, status, coins_awarded)`.
- Produces: `set_habit_status(uuid, date, text)` que paga usando el bonus de las equipadas; `deck_multiplier_percent(time_block)` basada en equipadas; trigger `enforce_max_equipped`.

**Contexto para el implementador:** esta migración se corre a mano en Supabase (apunta a prod). No hay pgTAP; la verificación es por queries (Step 3) y luego E2E (Task 5). El cuerpo de `set_habit_status` es una copia FIEL del que hay en prod, cambiando **sólo** el bloque que calcula `v_deck_bonus` (de `active_deck` a `user_inventory` equipado) para no alterar el resto de la lógica (semanal, delete en NONE, wallet, etc.).

- [ ] **Step 1: Crear la migración**

Create `supabase/19_deck_equipped_multiplier.sql`:

```sql
-- =============================================================================
-- Dojo Ledger — Paso 19: Recompensa del mazo desde cartas EQUIPADAS (is_equipped)
-- Migración ADITIVA e idempotente. Correr en: Supabase → SQL Editor → Run.
-- -----------------------------------------------------------------------------
-- Qué hace:
--   1. Puebla cards.multiplier_percent (hoy 0) por rareza: 5/10/20/35.
--   2. deck_multiplier_percent(block): suma el efectivo de las EQUIPADAS del user.
--   3. set_habit_status(uuid,date,text): mismo cuerpo que prod, pero el bonus del
--      mazo se calcula desde user_inventory equipado (no desde active_deck).
--   4. Trigger duro: máximo 8 cartas equipadas por usuario.
-- =============================================================================

-- 1) Poblar el % por rareza (fiel a cards.multiplier = 1.05/1.10/1.20/1.35).
update public.cards set multiplier_percent = case rarity::text
  when 'Common'    then 5
  when 'Rare'      then 10
  when 'Epic'      then 20
  when 'Legendary' then 35
  else multiplier_percent
end;

-- 2) Multiplicador del mazo por bloque = suma del efectivo de las EQUIPADAS.
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
  from public.user_inventory ui
  join public.cards c on c.id = ui.card_id
  where ui.user_id = auth.uid()
    and coalesce(ui.is_equipped, false) = true
    and (c.target_block is null or c.target_block = p_block);
$$;

-- 3) set_habit_status: copia fiel de prod, con el bonus desde equipadas.
create or replace function public.set_habit_status(p_habit_id uuid, p_date date, p_status text)
returns table(balance integer, log_status text, coins_awarded integer)
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

  select h.time_block, h.frequency into v_time_block, v_frequency
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
              when 'MET' then 50 when 'SURPASSED' then 150 else 0 end;
  if v_is_weekly then
    v_base := v_base * 5;
  end if;

  if v_base > 0 then
    -- BONUS del mazo desde las cartas EQUIPADAS del usuario (con nivel).
    select coalesce(sum(public.effective_multiplier(c.multiplier_percent, coalesce(ui.level, 1))), 0)
      into v_deck_bonus
    from public.user_inventory ui
    join public.cards c on c.id = ui.card_id
    where ui.user_id = v_uid
      and coalesce(ui.is_equipped, false) = true
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
    set balance = public.wallet.balance + v_delta, updated_at = now()
    where user_id = v_uid
    returning public.wallet.balance into v_balance;

  return query select v_balance, p_status, v_final;
end;
$$;

-- 4) Tope duro: no más de 8 cartas equipadas por usuario.
create or replace function public.enforce_max_equipped()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.is_equipped, false) and (
    select count(*) from public.user_inventory
    where user_id = new.user_id and coalesce(is_equipped, false) and id <> new.id
  ) >= 8 then
    raise exception 'No se pueden equipar más de 8 cartas' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_max_equipped on public.user_inventory;
create trigger trg_max_equipped
  before insert or update of is_equipped on public.user_inventory
  for each row execute function public.enforce_max_equipped();

grant execute on function public.deck_multiplier_percent(public.time_block) to anon, authenticated;
grant execute on function public.set_habit_status(uuid, date, text)         to anon, authenticated;
```

- [ ] **Step 2: Verificar que el archivo es SQL válido (parse local)**

No hay DB local. Verificación mínima de sintaxis: revisar que cada `create`/`update`/`create trigger` termina en `;` y que los `$$` abren/cierran parejos. (El chequeo real es correrlo en Supabase — Step 3, lo hace el controlador/usuario en integración.)

Run: `node -e "const s=require('fs').readFileSync('supabase/19_deck_equipped_multiplier.sql','utf8'); const d=(s.match(/\\$\\$/g)||[]).length; if(d%2)throw new Error('$$ desbalanceado'); console.log('dollar-quotes:',d,'OK');"`
Expected: imprime un número par y `OK`.

- [ ] **Step 3: Documentar la verificación en Supabase (para integración)**

Agregar al final del archivo, como comentario, el bloque de verificación que se corre a mano tras aplicar la migración:

```sql
-- =============================================================================
-- VERIFICACIÓN (correr aparte tras aplicar; NO es parte de la migración):
--   -- % poblado por rareza:
--   select rarity, min(multiplier_percent), max(multiplier_percent), count(*)
--   from public.cards group by rarity order by rarity;
--   -- esperado: Common 5/5, Rare 10/10, Epic 20/20, Legendary 35/35
--
--   -- El trigger existe:
--   select tgname from pg_trigger where tgrelid = 'public.user_inventory'::regclass
--     and tgname = 'trg_max_equipped';
-- =============================================================================
```

- [ ] **Step 4: Commit**

```bash
git add supabase/19_deck_equipped_multiplier.sql
git commit -m "feat(mazo): migracion 19 - recompensa desde equipadas + poblar multiplier_percent + tope 8"
```

---

## Task 3: Arte local — mapa, descarga de las 40 PNG, test de assets y service worker

**Files:**
- Create: `src/lib/card-art-map.ts`
- Create: `scripts/fetch-card-art.mjs`
- Create: `public/cards/*.png` (40, generados por el script)
- Test: `src/lib/card-art-map.test.ts`
- Modify: `public/sw.js`

**Interfaces:**
- Produces: `CARD_ART_MAP: { id: string; name: string; slug: string }[]` (40 entradas). Lo consume la migración 20 (para `id → /cards/<slug>.png`) y el test de assets.

- [ ] **Step 1: Crear el mapa de arte (40 cartas de prod, ids reales)**

Create `src/lib/card-art-map.ts`:

```ts
/**
 * Mapa de las 40 cartas de PRODUCCIÓN (id fijo) → slug del arte oficial
 * (RoyaleAPI cards-150). Los 40 slugs están validados (200 en el CDN).
 * Fuente de verdad para: descarga (scripts/fetch-card-art.mjs), test de assets
 * y la migración 20 (icon_url/image_url = /cards/<slug>.png).
 */
export interface CardArt {
  id: string;
  name: string;
  slug: string;
}

export const CARD_ART_MAP: CardArt[] = [
  // ---- Common (20)
  { id: "3eee61a2-6333-4bfd-803e-c0903b319660", name: "Arqueras", slug: "archers" },
  { id: "e282ec49-46c2-47c2-a2e3-d94cabadaa05", name: "Bárbaros", slug: "barbarians" },
  { id: "8115f544-f916-4be0-9c3a-3c5f8c5b72c6", name: "Bárbaros de Élite", slug: "elite-barbarians" },
  { id: "8af66ff0-da31-4f73-a6a5-f7454f640461", name: "Bombardero", slug: "bomber" },
  { id: "8a42fff5-e83f-4e00-a906-9dda6c1a10a2", name: "Caballero", slug: "knight" },
  { id: "6f12d462-433c-483a-8ded-82410bf5ffac", name: "Cañón", slug: "cannon" },
  { id: "980cab81-663f-4374-88c4-1412377b8ef7", name: "Descarga", slug: "zap" },
  { id: "d2166085-e2ab-4f11-adc1-16d2418690ea", name: "Duendes con Dagas", slug: "goblins" },
  { id: "69cc2c60-06c7-4239-ac89-121540503ef0", name: "Duendes con Lanza", slug: "spear-goblins" },
  { id: "54f730b1-f49e-482c-b729-6363369bd0b8", name: "Esbirros", slug: "minions" },
  { id: "5dbd8ad1-31ed-44b6-b01e-c791fec582d1", name: "Espíritu de Fuego", slug: "fire-spirit" },
  { id: "c900ea90-2c14-420c-b590-dd1377c5abbc", name: "Espíritu de Hielo", slug: "ice-spirit" },
  { id: "91861808-807b-4aad-b421-b152be86a262", name: "Espíritu Eléctrico", slug: "electro-spirit" },
  { id: "ebf7ce1c-d8e7-4fd6-8a4c-96d1f09a4b2a", name: "Esqueletos", slug: "skeletons" },
  { id: "97c80851-34f3-45ac-857a-86bb8305740a", name: "Flechas", slug: "arrows" },
  { id: "6355f11e-a5bc-4123-a057-6e65faf26f43", name: "Horda de Esbirros", slug: "minion-horde" },
  { id: "3283778c-d850-4d36-be87-7a311b6abd2d", name: "Mortero", slug: "mortar" },
  { id: "94a57b7b-1f1f-4470-a612-cd82d0b66ee7", name: "Rompemuros", slug: "wall-breakers" },
  { id: "49579585-f32f-4349-8d5b-f4fb00e8167c", name: "Tesla", slug: "tesla" },
  { id: "849fbc9d-bf0b-4b47-8ed4-ecdc790968db", name: "Torre de Bombas", slug: "bomb-tower" },
  // ---- Rare (10)
  { id: "77dc0d61-89ac-4984-90a0-cb51a8338a36", name: "Ariete de Batalla", slug: "battle-ram" },
  { id: "89d760be-f893-409b-b5cf-42020c9c7a16", name: "Bola de Fuego", slug: "fireball" },
  { id: "dc26447d-aa29-4af2-9c1e-5db30e9b2e9e", name: "Choque de Duendes", slug: "goblin-gang" },
  { id: "2efda269-8066-4ead-888a-a8df4c35304b", name: "Gigante", slug: "giant" },
  { id: "56cbd5ae-b23a-4f62-a32f-e7165b040d8e", name: "Lápida", slug: "tombstone" },
  { id: "26595ad9-8e17-42b4-8186-d044835cdb93", name: "Mago", slug: "wizard" },
  { id: "9a7ee4ae-3bd0-4e31-9bb2-bf90d257e7ac", name: "Mini P.E.K.K.A", slug: "mini-pekka" },
  { id: "eb5e34a3-8bca-4666-8a9a-b0d2a342f0e1", name: "Mosquetera", slug: "musketeer" },
  { id: "cbb97cce-a13f-45f0-b2a9-91f4fa49d426", name: "Torre Inferno", slug: "inferno-tower" },
  { id: "a6aa6694-bcd6-4ec5-b40f-ad7a2aac96ef", name: "Valquiria", slug: "valkyrie" },
  // ---- Epic (6)
  { id: "f95b0991-f192-42f1-baba-75b98d2e428f", name: "Bebé Dragón", slug: "baby-dragon" },
  { id: "baa24ef8-7d02-4614-8e6c-8f2b073c71df", name: "Ejército de Esqueletos", slug: "skeleton-army" },
  { id: "eff2648a-20b4-4879-9910-0e391fcd2e99", name: "Espejo", slug: "mirror" },
  { id: "d5aeba46-4160-4c65-8661-be3c049c164e", name: "Globo Bombástico", slug: "balloon" },
  { id: "c626de1c-bd27-465e-a600-fadaed1ad2f2", name: "Lanza Rocas", slug: "bowler" },
  { id: "c200394e-0531-4126-b81f-dbc6e9581bf6", name: "Príncipe", slug: "prince" },
  // ---- Legendary (4)
  { id: "5bc223b2-313f-4a7a-b802-e827a20de3d1", name: "Leñador", slug: "lumberjack" },
  { id: "0a65bb75-1a72-4486-97ac-89488ee465cb", name: "Mago Eléctrico", slug: "electro-wizard" },
  { id: "9794e0dc-c31c-4793-bc67-c0e1435f95f9", name: "Megacaballero", slug: "mega-knight" },
  { id: "1186e3b4-b886-49c1-8d8a-b41b62dd1818", name: "Princesa", slug: "princess" },
];
```

- [ ] **Step 2: Escribir el script de descarga**

Create `scripts/fetch-card-art.mjs`:

```js
// Descarga las 40 PNG de arte a public/cards/. Uso: node scripts/fetch-card-art.mjs
// Requiere red (CDN de RoyaleAPI). Node 20+ (fetch global).
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const OUT = join(root, "public", "cards");
const BASE = "https://cdn.royaleapi.com/static/img/cards-150/";

// Parseamos los slugs del mapa TS sin transpilar (regex sobre slug: "...").
const mapSrc = readFileSync(join(root, "src", "lib", "card-art-map.ts"), "utf8");
const slugs = [...mapSrc.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]);
if (slugs.length !== 40) throw new Error(`Esperaba 40 slugs, encontré ${slugs.length}`);

mkdirSync(OUT, { recursive: true });
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let ok = 0;
for (const slug of slugs) {
  const dest = join(OUT, `${slug}.png`);
  if (existsSync(dest)) { ok++; continue; }
  const res = await fetch(BASE + `${slug}.png`);
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) throw new Error(`${slug}: no es PNG`);
  writeFileSync(dest, buf);
  ok++;
  console.log(`✓ ${slug}.png (${buf.length} bytes)`);
}
console.log(`Listo: ${ok}/40 en public/cards/`);
```

- [ ] **Step 3: Ejecutar la descarga**

Run: `node scripts/fetch-card-art.mjs`
Expected: imprime `✓ <slug>.png` para cada carta y `Listo: 40/40 en public/cards/`.
(Si el sandbox bloquea la red, correr con acceso de red habilitado — el CDN de RoyaleAPI es un host estático confiable y los 40 slugs están validados.)

- [ ] **Step 4: Escribir el test de assets (falla si falta alguna PNG)**

Create `src/lib/card-art-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CARD_ART_MAP } from "./card-art-map";

const CARDS_DIR = join(process.cwd(), "public", "cards");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("CARD_ART_MAP", () => {
  it("tiene 40 entradas", () => {
    expect(CARD_ART_MAP).toHaveLength(40);
  });

  it("ids y slugs son únicos", () => {
    expect(new Set(CARD_ART_MAP.map((c) => c.id)).size).toBe(40);
    expect(new Set(CARD_ART_MAP.map((c) => c.slug)).size).toBe(40);
  });

  it("cada slug tiene su PNG válido en public/cards/", () => {
    for (const { slug } of CARD_ART_MAP) {
      const file = join(CARDS_DIR, `${slug}.png`);
      expect(existsSync(file), `falta ${slug}.png`).toBe(true);
      const head = readFileSync(file).subarray(0, 4);
      expect(head.equals(PNG_MAGIC), `${slug}.png no es PNG`).toBe(true);
    }
  });
});
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/card-art-map.test.ts`
Expected: PASS (3/3). Si falla "falta X.png", volver al Step 3.

- [ ] **Step 6: Cachear `/cards/` en el service worker (offline)**

Modify `public/sw.js`:

1. Cambiar la versión de cache (línea 2) para forzar refresco:

```js
const CACHE = "dojo-ledger-v3";
```

2. Agregar, dentro del handler `fetch` y **antes** de la rama de `/_next/static/` (después de la guarda `if (request.method !== "GET" ...) return;`), una rama cache-first para el arte:

```js
  // Arte de cartas (estático, local): cache-first con revalidación en segundo plano.
  if (url.pathname.startsWith("/cards/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fetched;
      }),
    );
    return;
  }
```

- [ ] **Step 7: Correr toda la suite**

Run: `npm test`
Expected: PASS (todos, incluyendo los de Task 1 y el de assets).

- [ ] **Step 8: Commit**

```bash
git add src/lib/card-art-map.ts src/lib/card-art-map.test.ts scripts/fetch-card-art.mjs public/cards public/sw.js
git commit -m "feat(cartas): arte local (40 PNG), mapa+test de assets y cache offline en el SW"
```

---

## Task 4: Migración 20 — `icon_url`/`image_url` → `/cards/<slug>.png`

**Files:**
- Create: `supabase/20_card_local_art.sql`
- Test: `src/lib/card-art-map.test.ts` (agregar un caso que cruza el SQL con el mapa)

**Interfaces:**
- Consumes: `CARD_ART_MAP` (Task 3) para los pares `id → slug`.
- Produces: `supabase/20_card_local_art.sql` que setea ambas columnas de arte para las 40 cartas.

- [ ] **Step 1: Crear la migración de paths de arte**

Create `supabase/20_card_local_art.sql` (los 40 pares `id → /cards/<slug>.png`, mismos ids que `CARD_ART_MAP`):

```sql
-- =============================================================================
-- Dojo Ledger — Paso 20: Arte local de las cartas (icon_url + image_url)
-- Migración ADITIVA e idempotente. Correr en: Supabase → SQL Editor → Run.
-- Requiere que /public/cards/<slug>.png estén desplegados (Task 3).
-- El frontend lee icon_url ?? image_url → seteamos AMBAS.
-- =============================================================================

update public.cards c
set icon_url = v.path, image_url = v.path
from (values
  ('3eee61a2-6333-4bfd-803e-c0903b319660'::uuid, '/cards/archers.png'),
  ('e282ec49-46c2-47c2-a2e3-d94cabadaa05'::uuid, '/cards/barbarians.png'),
  ('8115f544-f916-4be0-9c3a-3c5f8c5b72c6'::uuid, '/cards/elite-barbarians.png'),
  ('8af66ff0-da31-4f73-a6a5-f7454f640461'::uuid, '/cards/bomber.png'),
  ('8a42fff5-e83f-4e00-a906-9dda6c1a10a2'::uuid, '/cards/knight.png'),
  ('6f12d462-433c-483a-8ded-82410bf5ffac'::uuid, '/cards/cannon.png'),
  ('980cab81-663f-4374-88c4-1412377b8ef7'::uuid, '/cards/zap.png'),
  ('d2166085-e2ab-4f11-adc1-16d2418690ea'::uuid, '/cards/goblins.png'),
  ('69cc2c60-06c7-4239-ac89-121540503ef0'::uuid, '/cards/spear-goblins.png'),
  ('54f730b1-f49e-482c-b729-6363369bd0b8'::uuid, '/cards/minions.png'),
  ('5dbd8ad1-31ed-44b6-b01e-c791fec582d1'::uuid, '/cards/fire-spirit.png'),
  ('c900ea90-2c14-420c-b590-dd1377c5abbc'::uuid, '/cards/ice-spirit.png'),
  ('91861808-807b-4aad-b421-b152be86a262'::uuid, '/cards/electro-spirit.png'),
  ('ebf7ce1c-d8e7-4fd6-8a4c-96d1f09a4b2a'::uuid, '/cards/skeletons.png'),
  ('97c80851-34f3-45ac-857a-86bb8305740a'::uuid, '/cards/arrows.png'),
  ('6355f11e-a5bc-4123-a057-6e65faf26f43'::uuid, '/cards/minion-horde.png'),
  ('3283778c-d850-4d36-be87-7a311b6abd2d'::uuid, '/cards/mortar.png'),
  ('94a57b7b-1f1f-4470-a612-cd82d0b66ee7'::uuid, '/cards/wall-breakers.png'),
  ('49579585-f32f-4349-8d5b-f4fb00e8167c'::uuid, '/cards/tesla.png'),
  ('849fbc9d-bf0b-4b47-8ed4-ecdc790968db'::uuid, '/cards/bomb-tower.png'),
  ('77dc0d61-89ac-4984-90a0-cb51a8338a36'::uuid, '/cards/battle-ram.png'),
  ('89d760be-f893-409b-b5cf-42020c9c7a16'::uuid, '/cards/fireball.png'),
  ('dc26447d-aa29-4af2-9c1e-5db30e9b2e9e'::uuid, '/cards/goblin-gang.png'),
  ('2efda269-8066-4ead-888a-a8df4c35304b'::uuid, '/cards/giant.png'),
  ('56cbd5ae-b23a-4f62-a32f-e7165b040d8e'::uuid, '/cards/tombstone.png'),
  ('26595ad9-8e17-42b4-8186-d044835cdb93'::uuid, '/cards/wizard.png'),
  ('9a7ee4ae-3bd0-4e31-9bb2-bf90d257e7ac'::uuid, '/cards/mini-pekka.png'),
  ('eb5e34a3-8bca-4666-8a9a-b0d2a342f0e1'::uuid, '/cards/musketeer.png'),
  ('cbb97cce-a13f-45f0-b2a9-91f4fa49d426'::uuid, '/cards/inferno-tower.png'),
  ('a6aa6694-bcd6-4ec5-b40f-ad7a2aac96ef'::uuid, '/cards/valkyrie.png'),
  ('f95b0991-f192-42f1-baba-75b98d2e428f'::uuid, '/cards/baby-dragon.png'),
  ('baa24ef8-7d02-4614-8e6c-8f2b073c71df'::uuid, '/cards/skeleton-army.png'),
  ('eff2648a-20b4-4879-9910-0e391fcd2e99'::uuid, '/cards/mirror.png'),
  ('d5aeba46-4160-4c65-8661-be3c049c164e'::uuid, '/cards/balloon.png'),
  ('c626de1c-bd27-465e-a600-fadaed1ad2f2'::uuid, '/cards/bowler.png'),
  ('c200394e-0531-4126-b81f-dbc6e9581bf6'::uuid, '/cards/prince.png'),
  ('5bc223b2-313f-4a7a-b802-e827a20de3d1'::uuid, '/cards/lumberjack.png'),
  ('0a65bb75-1a72-4486-97ac-89488ee465cb'::uuid, '/cards/electro-wizard.png'),
  ('9794e0dc-c31c-4793-bc67-c0e1435f95f9'::uuid, '/cards/mega-knight.png'),
  ('1186e3b4-b886-49c1-8d8a-b41b62dd1818'::uuid, '/cards/princess.png')
) as v(id, path)
where c.id = v.id;

-- VERIFICACIÓN (aparte): select count(*) from public.cards where image_url like '/cards/%';
-- esperado: 40
```

- [ ] **Step 2: Escribir el test de consistencia SQL ↔ mapa (falla si faltara un id/slug)**

Agregar este `describe` al final de `src/lib/card-art-map.test.ts`:

```ts
import { readFileSync as _read } from "node:fs";
import { join as _join } from "node:path";

describe("migración 20 cubre todo el mapa", () => {
  const sql = _read(_join(process.cwd(), "supabase", "20_card_local_art.sql"), "utf8");
  it("cada carta del mapa aparece con su id y su path en el SQL", () => {
    for (const { id, slug } of CARD_ART_MAP) {
      expect(sql, `falta id ${id}`).toContain(id);
      expect(sql, `falta path de ${slug}`).toContain(`/cards/${slug}.png`);
    }
  });
});
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/card-art-map.test.ts`
Expected: PASS. Si falla, alinear el SQL con `CARD_ART_MAP`.

- [ ] **Step 4: Commit**

```bash
git add supabase/20_card_local_art.sql src/lib/card-art-map.test.ts
git commit -m "feat(cartas): migracion 20 - icon_url/image_url a arte local + test de consistencia"
```

---

## Task 5: Verificación end-to-end en el deploy

**Contexto:** esta tarea la ejecuta el **controlador** (no un subagente), porque requiere: (a) que el usuario aplique las migraciones 19 y 20 en Supabase, (b) que Vercel redepliegue con las PNG y el código nuevos. Sin esos dos pasos, no hay nada que verificar en vivo.

- [ ] **Step 1: Pedir al usuario que aplique las migraciones y confirme el deploy**

Mensaje al usuario: correr en Supabase, en orden, `supabase/19_deck_equipped_multiplier.sql` y luego `supabase/20_card_local_art.sql`; y confirmar que Vercel terminó el deploy de la rama mergeada.

- [ ] **Step 2: Verificar las imágenes reales (Playwright)**

En `https://habits-tracker-app-ten.vercel.app/`, ir al Mazo/Colección y comprobar, vía el DOM, que los `<img>` de las cartas cargan (`naturalWidth > 0`) y su `src` empieza con `/cards/`. Expected: 0 imágenes rotas.

- [ ] **Step 3: Verificar el % y el pago del mazo**

Equipar 8 cartas (contador `8/8`, la 9ª rechazada). Marcar un hábito diario `Hecho` y verificar que las monedas suben por `round(50 * (100 + bonus)/100)` con `bonus` = suma de los % efectivos de las 8 equipadas (visible en las cartas). Desmarcar para restaurar. Expected: el delta coincide con el bonus mostrado (ya no +0%).

- [ ] **Step 4: Reportar resultados**

Resumir: imágenes OK, tope 8 OK, pago del mazo OK; y cualquier estado residual (hábitos marcados durante la prueba).

---

## Notas de ejecución

- **Orden de migraciones:** 19 antes que 20 (no es estricto, pero es el orden lógico). Ambas después de desplegar el código de Task 1 y las PNG de Task 3.
- **`active_deck` queda en desuso** (no se borra). Ninguna función de pago lo lee ya tras la migración 19.
- **Valores de bonus (5/10/20/35)** son ajustables: si el usuario los quiere distintos, se cambia el `case` de la migración 19 y se re-aplica (es idempotente).
