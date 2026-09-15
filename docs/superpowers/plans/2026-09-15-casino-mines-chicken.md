# Casino: Minas + Pollito — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar dos juegos de apuesta al casino — Minas (5×5, minas elegibles 1–24) y Pollito (Chicken Road, 25% muerte/carril, tope 20) — con lógica y RNG server-authoritative.

**Architecture:** Mismo patrón que Blackjack: tablas de estado server-only (RPC-only), RPCs `SECURITY DEFINER` que descuentan/acreditan la wallet y devuelven una vista saneada, wrappers en `src/actions/finances.ts`, y vistas cliente integradas como tabs en `casino-view.tsx`. La matemática de multiplicadores vive en TS (`src/lib/casino.ts`, testeada) y espejada en los RPCs.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (PL/pgSQL, RLS), Vitest.

## Global Constraints

- Multiplicadores con house edge `EDGE = 0.97`: `multiplicador = round(0.97 / P(sobrevivir), 2)`.
- Minas: 25 casillas, `M` minas elegibles **1–24**; `P(k) = Π_{i=0}^{k-1} (25-M-i)/(25-i)`; `k=0 → 1`.
- Pollito: supervivencia `s=0.75` (25% muerte), `multiplicador(n) = round(0.97/0.75^n, 2)`; `n=0 → 1`; tope `n=20`.
- Pago = `round(bet × multiplicador)` en monedas enteras. Apuesta mín 1; el server valida saldo.
- Server-authoritative: `mine_positions` NUNCA viaja al cliente mientras `status='PLAYING'`; la muerte del pollito la tira el server por paso. Los pagos los calcula el server.
- Las tablas de estado son RPC-only (RLS + `revoke all from anon, authenticated`).
- Migraciones nuevas `supabase/17_casino_mines.sql` y `18_casino_chicken.sql` — las corre el usuario en Supabase (no las aplica el agente).
- No romper el build: `npx tsc --noEmit` y `npm run build` pasan; `npm test` verde.
- `numeric` de Postgres puede volver como string vía PostgREST → coercer con `Number(...)` en las actions.
- Alias `@/` → `src/`. Casino ya es online-only (guard en `casino-view.tsx`).

---

### Task 1: Math pura — `src/lib/casino.ts` + tests

**Files:**
- Create: `src/lib/casino.ts`
- Test: `src/lib/casino.test.ts`

**Interfaces:**
- Produces: `CASINO_EDGE = 0.97`, `minesMultiplier(mines: number, picks: number): number`, `chickenMultiplier(lane: number): number`.

- [ ] **Step 1: Escribir el test que falla (`src/lib/casino.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { minesMultiplier, chickenMultiplier } from "./casino";

describe("minesMultiplier", () => {
  it("k=0 siempre da 1", () => {
    expect(minesMultiplier(3, 0)).toBe(1);
    expect(minesMultiplier(10, 0)).toBe(1);
  });
  it("valores de referencia (3/5/10 minas)", () => {
    expect(minesMultiplier(3, 1)).toBe(1.1);
    expect(minesMultiplier(3, 2)).toBe(1.26);
    expect(minesMultiplier(3, 3)).toBe(1.45);
    expect(minesMultiplier(5, 1)).toBe(1.21);
    expect(minesMultiplier(5, 2)).toBe(1.53);
    expect(minesMultiplier(5, 3)).toBe(1.96);
    expect(minesMultiplier(10, 1)).toBe(1.62);
    expect(minesMultiplier(10, 2)).toBe(2.77);
    expect(minesMultiplier(10, 3)).toBe(4.9);
  });
  it("más minas paga más en la misma casilla", () => {
    expect(minesMultiplier(10, 1)).toBeGreaterThan(minesMultiplier(3, 1));
  });
});

describe("chickenMultiplier", () => {
  it("lane 0 da 1", () => {
    expect(chickenMultiplier(0)).toBe(1);
  });
  it("valores de referencia", () => {
    expect(chickenMultiplier(1)).toBe(1.29);
    expect(chickenMultiplier(2)).toBe(1.72);
    expect(chickenMultiplier(3)).toBe(2.3);
    expect(chickenMultiplier(5)).toBe(4.09);
    expect(chickenMultiplier(8)).toBe(9.69);
    expect(chickenMultiplier(20)).toBe(305.88);
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npm test -- casino`
Expected: FAIL (no existe `./casino`).

- [ ] **Step 3: Implementar `src/lib/casino.ts`**

```ts
// Matemática de los juegos de casino con multiplicador (Minas, Pollito).
// Espeja los RPCs de Supabase (17_casino_mines.sql / 18_casino_chicken.sql):
// ambos usan el mismo house edge y las mismas fórmulas. El RPC es la autoridad
// del pago; esto se usa para los hints de la UI y para testear la fórmula.

export const CASINO_EDGE = 0.97;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Multiplicador de Minas tras `picks` casillas seguras con `mines` minas (25 casillas). */
export function minesMultiplier(mines: number, picks: number): number {
  if (picks <= 0) return 1;
  const safe = 25 - mines;
  let p = 1;
  for (let i = 0; i < picks; i++) {
    p *= (safe - i) / (25 - i);
  }
  return round2(CASINO_EDGE / p);
}

/** Multiplicador del Pollito en el carril `lane` (supervivencia 0.75 por carril). */
export function chickenMultiplier(lane: number): number {
  if (lane <= 0) return 1;
  return round2(CASINO_EDGE / Math.pow(0.75, lane));
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npm test -- casino`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/casino.ts src/lib/casino.test.ts
git commit -m "feat(casino): math de Minas y Pollito (multiplicadores) + tests"
```

---

### Task 2: Migración `supabase/17_casino_mines.sql`

**Files:**
- Create: `supabase/17_casino_mines.sql`

**Interfaces:**
- Produces (RPCs que consumen las actions): `mines_start(p_bet integer, p_mines integer)`, `mines_pick(p_cell integer)`, `mines_cashout()` — todos devuelven `table(status text, result text, bet integer, mines_count integer, picks integer[], multiplier numeric, next_multiplier numeric, payout integer, revealed_mines integer[], new_balance integer)`.

- [ ] **Step 1: Crear el archivo con la tabla + funciones + RPCs**

```sql
-- =============================================================================
-- Dojo Ledger — Paso 17: Casino "Minas" (server-authoritative)
-- Ejecutar en: Supabase Dashboard → SQL Editor. Correr TODO el archivo.
-- Requiere: schema.sql · 02..08 (wallet, casino) y 15/16 aplicados.
-- =============================================================================

-- Tabla de estado (una partida activa por usuario). RPC-only.
create table if not exists public.mines_games (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  bet            integer not null,
  mines_count    integer not null,            -- 1..24
  mine_positions integer[] not null,          -- OCULTO (0..24)
  picks          integer[] not null default '{}',
  status         text not null default 'PLAYING',   -- PLAYING | DONE
  result         text,                              -- CASHED | BUSTED | null
  multiplier     numeric not null default 1,
  payout         integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint mines_user_unique unique (user_id)
);

alter table public.mines_games enable row level security;
revoke all on public.mines_games from anon;
revoke all on public.mines_games from authenticated;

-- Multiplicador puro (espeja src/lib/casino.ts minesMultiplier).
create or replace function public.mines_multiplier(p_mines integer, p_picks integer)
returns numeric language plpgsql immutable as $$
declare
  v_p    numeric := 1;
  v_safe integer := 25 - p_mines;
  i      integer;
begin
  if p_picks <= 0 then return 1; end if;
  for i in 0..(p_picks - 1) loop
    v_p := v_p * ((v_safe - i)::numeric / (25 - i));
  end loop;
  return round(0.97 / v_p, 2);
end $$;

-- Vista saneada: nunca expone mine_positions mientras se juega.
create or replace function public.mines_render(g public.mines_games, p_balance integer)
returns table (
  status text, result text, bet integer, mines_count integer,
  picks integer[], multiplier numeric, next_multiplier numeric,
  payout integer, revealed_mines integer[], new_balance integer
) language plpgsql stable as $$
begin
  return query select
    g.status, g.result, g.bet, g.mines_count, g.picks, g.multiplier,
    case when g.status = 'PLAYING'
      then public.mines_multiplier(g.mines_count, coalesce(array_length(g.picks, 1), 0) + 1)
      else null end,
    g.payout,
    case when g.status = 'DONE' then g.mine_positions else null end,
    p_balance;
end $$;

-- Iniciar partida: valida, descuenta la apuesta, sortea las minas.
create or replace function public.mines_start(p_bet integer, p_mines integer)
returns table (status text, result text, bet integer, mines_count integer, picks integer[], multiplier numeric, next_multiplier numeric, payout integer, revealed_mines integer[], new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_balance   integer;
  v_positions integer[];
  v_game      public.mines_games%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  if p_mines is null or p_mines < 1 or p_mines > 24 then raise exception 'Cantidad de minas inválida: %', p_mines; end if;
  if p_bet is null or p_bet <= 0 then raise exception 'Apuesta inválida: %', p_bet; end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0) on conflict (user_id) do nothing;
  select balance into v_balance from public.wallet where user_id = v_uid for update;
  if v_balance < p_bet then raise exception 'Saldo insuficiente: % < %', v_balance, p_bet using errcode = 'P0001'; end if;

  update public.wallet set balance = balance - p_bet, updated_at = now()
    where user_id = v_uid returning balance into v_balance;

  select array_agg(pos) into v_positions
  from (select generate_series(0, 24) as pos order by random() limit p_mines) s;

  insert into public.mines_games (user_id, bet, mines_count, mine_positions, picks, status, result, multiplier, payout, updated_at)
  values (v_uid, p_bet, p_mines, v_positions, '{}', 'PLAYING', null, 1, null, now())
  on conflict (user_id) do update set
    bet = excluded.bet, mines_count = excluded.mines_count, mine_positions = excluded.mine_positions,
    picks = '{}', status = 'PLAYING', result = null, multiplier = 1, payout = null, updated_at = now()
  returning * into v_game;

  return query select * from public.mines_render(v_game, v_balance);
end $$;

-- Destapar una casilla.
create or replace function public.mines_pick(p_cell integer)
returns table (status text, result text, bet integer, mines_count integer, picks integer[], multiplier numeric, next_multiplier numeric, payout integer, revealed_mines integer[], new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_game    public.mines_games%rowtype;
  v_balance integer;
  v_safe    integer;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  if p_cell is null or p_cell < 0 or p_cell > 24 then raise exception 'Casilla inválida: %', p_cell; end if;

  select * into v_game from public.mines_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYING' then raise exception 'No hay una partida en curso' using errcode = 'P0001'; end if;
  if p_cell = any(v_game.picks) then raise exception 'Casilla ya destapada'; end if;

  select balance into v_balance from public.wallet where user_id = v_uid;

  if p_cell = any(v_game.mine_positions) then
    update public.mines_games set status = 'DONE', result = 'BUSTED', payout = 0, updated_at = now()
      where user_id = v_uid returning * into v_game;
    return query select * from public.mines_render(v_game, v_balance);
    return;
  end if;

  v_game.picks := v_game.picks || p_cell;
  v_game.multiplier := public.mines_multiplier(v_game.mines_count, coalesce(array_length(v_game.picks, 1), 0));
  v_safe := 25 - v_game.mines_count;

  if coalesce(array_length(v_game.picks, 1), 0) >= v_safe then
    v_game.status := 'DONE'; v_game.result := 'CASHED';
    v_game.payout := round(v_game.bet * v_game.multiplier)::integer;
    update public.wallet set balance = balance + v_game.payout, updated_at = now()
      where user_id = v_uid returning balance into v_balance;
  end if;

  update public.mines_games set
    picks = v_game.picks, multiplier = v_game.multiplier,
    status = v_game.status, result = v_game.result, payout = v_game.payout, updated_at = now()
    where user_id = v_uid returning * into v_game;

  return query select * from public.mines_render(v_game, v_balance);
end $$;

-- Retirarse (cobrar).
create or replace function public.mines_cashout()
returns table (status text, result text, bet integer, mines_count integer, picks integer[], multiplier numeric, next_multiplier numeric, payout integer, revealed_mines integer[], new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_game    public.mines_games%rowtype;
  v_balance integer;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  select * into v_game from public.mines_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYING' then raise exception 'No hay una partida en curso' using errcode = 'P0001'; end if;
  if coalesce(array_length(v_game.picks, 1), 0) < 1 then raise exception 'Destapá al menos una casilla antes de retirar'; end if;

  v_game.payout := round(v_game.bet * v_game.multiplier)::integer;
  update public.wallet set balance = balance + v_game.payout, updated_at = now()
    where user_id = v_uid returning balance into v_balance;
  update public.mines_games set status = 'DONE', result = 'CASHED', payout = v_game.payout, updated_at = now()
    where user_id = v_uid returning * into v_game;

  return query select * from public.mines_render(v_game, v_balance);
end $$;

grant execute on function public.mines_start(integer, integer) to authenticated;
grant execute on function public.mines_pick(integer)           to authenticated;
grant execute on function public.mines_cashout()               to authenticated;
revoke execute on function public.mines_render(public.mines_games, integer) from anon;
-- FIN Paso 17.
```

- [ ] **Step 2: Chequeo de balanceo de delimitadores**

Run: `grep -c '\$\$' supabase/17_casino_mines.sql`
Expected: `10` (5 funciones × 2 delimitadores `$$` cada una).

- [ ] **Step 3: Commit**

```bash
git add supabase/17_casino_mines.sql
git commit -m "feat(casino): migracion Minas (tabla RPC-only + start/pick/cashout)"
```

---

### Task 3: Migración `supabase/18_casino_chicken.sql`

**Files:**
- Create: `supabase/18_casino_chicken.sql`

**Interfaces:**
- Produces: `chicken_start(p_bet integer)`, `chicken_step()`, `chicken_cashout()` — devuelven `table(status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)`.

- [ ] **Step 1: Crear el archivo**

```sql
-- =============================================================================
-- Dojo Ledger — Paso 18: Casino "Pollito" (Chicken Road, server-authoritative)
-- Ejecutar en: Supabase Dashboard → SQL Editor. Correr TODO el archivo.
-- Requiere: schema.sql · 02..08 · 15/16 aplicados.
-- Dificultad fija: 25% de morir por carril (supervivencia 0.75); tope 20 carriles.
-- =============================================================================

create table if not exists public.chicken_games (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  bet        integer not null,
  lane       integer not null default 0,
  status     text not null default 'PLAYING',   -- PLAYING | DONE
  result     text,                              -- CASHED | DEAD | null
  multiplier numeric not null default 1,
  payout     integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chicken_user_unique unique (user_id)
);

alter table public.chicken_games enable row level security;
revoke all on public.chicken_games from anon;
revoke all on public.chicken_games from authenticated;

-- Multiplicador puro (espeja src/lib/casino.ts chickenMultiplier).
create or replace function public.chicken_multiplier(p_lane integer)
returns numeric language sql immutable as $$
  select case when p_lane <= 0 then 1::numeric
              else round((0.97 / power(0.75, p_lane))::numeric, 2) end;
$$;

create or replace function public.chicken_render(g public.chicken_games, p_balance integer)
returns table (status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)
language plpgsql stable as $$
begin
  return query select
    g.status, g.result, g.bet, g.lane, g.multiplier,
    case when g.status = 'PLAYING' and g.lane < 20 then public.chicken_multiplier(g.lane + 1) else null end,
    g.payout, p_balance;
end $$;

create or replace function public.chicken_start(p_bet integer)
returns table (status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_balance integer;
  v_game    public.chicken_games%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  if p_bet is null or p_bet <= 0 then raise exception 'Apuesta inválida: %', p_bet; end if;

  insert into public.wallet (user_id, balance) values (v_uid, 0) on conflict (user_id) do nothing;
  select balance into v_balance from public.wallet where user_id = v_uid for update;
  if v_balance < p_bet then raise exception 'Saldo insuficiente: % < %', v_balance, p_bet using errcode = 'P0001'; end if;

  update public.wallet set balance = balance - p_bet, updated_at = now()
    where user_id = v_uid returning balance into v_balance;

  insert into public.chicken_games (user_id, bet, lane, status, result, multiplier, payout, updated_at)
  values (v_uid, p_bet, 0, 'PLAYING', null, 1, null, now())
  on conflict (user_id) do update set
    bet = excluded.bet, lane = 0, status = 'PLAYING', result = null, multiplier = 1, payout = null, updated_at = now()
  returning * into v_game;

  return query select * from public.chicken_render(v_game, v_balance);
end $$;

-- Avanzar un carril: tira la muerte (25%).
create or replace function public.chicken_step()
returns table (status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_game    public.chicken_games%rowtype;
  v_balance integer;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  select * into v_game from public.chicken_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYING' then raise exception 'No hay una partida en curso' using errcode = 'P0001'; end if;
  if v_game.lane >= 20 then raise exception 'Llegaste al tope; retirate'; end if;

  select balance into v_balance from public.wallet where user_id = v_uid;

  if random() < 0.25 then
    update public.chicken_games set status = 'DONE', result = 'DEAD', payout = 0, updated_at = now()
      where user_id = v_uid returning * into v_game;
    return query select * from public.chicken_render(v_game, v_balance);
    return;
  end if;

  v_game.lane := v_game.lane + 1;
  v_game.multiplier := public.chicken_multiplier(v_game.lane);
  update public.chicken_games set lane = v_game.lane, multiplier = v_game.multiplier, updated_at = now()
    where user_id = v_uid returning * into v_game;

  return query select * from public.chicken_render(v_game, v_balance);
end $$;

create or replace function public.chicken_cashout()
returns table (status text, result text, bet integer, lane integer, multiplier numeric, next_multiplier numeric, payout integer, new_balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_game    public.chicken_games%rowtype;
  v_balance integer;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = 'P0001'; end if;
  select * into v_game from public.chicken_games where user_id = v_uid for update;
  if not found or v_game.status <> 'PLAYING' then raise exception 'No hay una partida en curso' using errcode = 'P0001'; end if;
  if v_game.lane < 1 then raise exception 'Avanzá al menos un carril antes de retirar'; end if;

  v_game.payout := round(v_game.bet * v_game.multiplier)::integer;
  update public.wallet set balance = balance + v_game.payout, updated_at = now()
    where user_id = v_uid returning balance into v_balance;
  update public.chicken_games set status = 'DONE', result = 'CASHED', payout = v_game.payout, updated_at = now()
    where user_id = v_uid returning * into v_game;

  return query select * from public.chicken_render(v_game, v_balance);
end $$;

grant execute on function public.chicken_start(integer) to authenticated;
grant execute on function public.chicken_step()         to authenticated;
grant execute on function public.chicken_cashout()      to authenticated;
revoke execute on function public.chicken_render(public.chicken_games, integer) from anon;
-- FIN Paso 18.
```

- [ ] **Step 2: Chequeo de delimitadores**

Run: `grep -c '\$\$' supabase/18_casino_chicken.sql`
Expected: `10` (5 funciones — `chicken_multiplier`, `chicken_render`, `chicken_start`, `chicken_step`, `chicken_cashout` — cada una con su par de `$$`).

- [ ] **Step 3: Commit**

```bash
git add supabase/18_casino_chicken.sql
git commit -m "feat(casino): migracion Pollito (tabla RPC-only + start/step/cashout)"
```

---

### Task 4: Tipos + actions — `src/lib/types.ts` y `src/actions/finances.ts`

**Files:**
- Modify: `src/lib/types.ts` (agregar `MinesView`, `ChickenView`)
- Modify: `src/actions/finances.ts` (agregar wrappers)

**Interfaces:**
- Consumes: RPCs de Tasks 2 y 3.
- Produces: `MinesView`, `ChickenView`; actions `minesStart/minesPick/minesCashout` → `MinesActionResult`, `chickenStart/chickenStep/chickenCashout` → `ChickenActionResult`.

- [ ] **Step 1: Agregar los tipos a `src/lib/types.ts`** (al final del archivo)

```ts
// -----------------------------------------------------------------------------
// Casino: Minas y Pollito (vistas saneadas que devuelven los RPCs)
// -----------------------------------------------------------------------------
export interface MinesView {
  status: "PLAYING" | "DONE";
  result: "CASHED" | "BUSTED" | null;
  bet: number;
  minesCount: number;
  picks: number[];
  multiplier: number;
  nextMultiplier: number | null;
  payout: number | null;
  revealedMines: number[] | null;
  newBalance: number;
}

export interface ChickenView {
  status: "PLAYING" | "DONE";
  result: "CASHED" | "DEAD" | null;
  bet: number;
  lane: number;
  multiplier: number;
  nextMultiplier: number | null;
  payout: number | null;
  newBalance: number;
}
```

- [ ] **Step 2: Agregar los wrappers a `src/actions/finances.ts`** (al final, y `MinesView`/`ChickenView` al import de `@/lib/types`)

```ts
// -----------------------------------------------------------------------------
// Casino: Minas y Pollito — estado en servidor; el cliente sólo ve la saneada.
// -----------------------------------------------------------------------------
export interface MinesActionResult {
  ok: boolean;
  view: MinesView | null;
  insufficient?: boolean;
  error?: string;
}

function rowToMines(r: Record<string, unknown>): MinesView {
  return {
    status: r.status as MinesView["status"],
    result: (r.result ?? null) as MinesView["result"],
    bet: Number(r.bet),
    minesCount: Number(r.mines_count),
    picks: (r.picks ?? []) as number[],
    multiplier: Number(r.multiplier),
    nextMultiplier: r.next_multiplier == null ? null : Number(r.next_multiplier),
    payout: r.payout == null ? null : Number(r.payout),
    revealedMines: (r.revealed_mines ?? null) as number[] | null,
    newBalance: Number(r.new_balance),
  };
}

async function callMines(
  rpc: "mines_start" | "mines_pick" | "mines_cashout",
  args: Record<string, unknown>,
  tag: string,
): Promise<MinesActionResult> {
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error(`[${tag}] RPC error:`, error.message);
    return { ok: false, view: null, insufficient, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, view: null, error: "Respuesta vacía del servidor" };
  return { ok: true, view: rowToMines(row as Record<string, unknown>) };
}

export async function minesStart(bet: number, mines: number): Promise<MinesActionResult> {
  return callMines("mines_start", { p_bet: bet, p_mines: mines }, "minesStart");
}
export async function minesPick(cell: number): Promise<MinesActionResult> {
  return callMines("mines_pick", { p_cell: cell }, "minesPick");
}
export async function minesCashout(): Promise<MinesActionResult> {
  return callMines("mines_cashout", {}, "minesCashout");
}

export interface ChickenActionResult {
  ok: boolean;
  view: ChickenView | null;
  insufficient?: boolean;
  error?: string;
}

function rowToChicken(r: Record<string, unknown>): ChickenView {
  return {
    status: r.status as ChickenView["status"],
    result: (r.result ?? null) as ChickenView["result"],
    bet: Number(r.bet),
    lane: Number(r.lane),
    multiplier: Number(r.multiplier),
    nextMultiplier: r.next_multiplier == null ? null : Number(r.next_multiplier),
    payout: r.payout == null ? null : Number(r.payout),
    newBalance: Number(r.new_balance),
  };
}

async function callChicken(
  rpc: "chicken_start" | "chicken_step" | "chicken_cashout",
  args: Record<string, unknown>,
  tag: string,
): Promise<ChickenActionResult> {
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error(`[${tag}] RPC error:`, error.message);
    return { ok: false, view: null, insufficient, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, view: null, error: "Respuesta vacía del servidor" };
  return { ok: true, view: rowToChicken(row as Record<string, unknown>) };
}

export async function chickenStart(bet: number): Promise<ChickenActionResult> {
  return callChicken("chicken_start", { p_bet: bet }, "chickenStart");
}
export async function chickenStep(): Promise<ChickenActionResult> {
  return callChicken("chicken_step", {}, "chickenStep");
}
export async function chickenCashout(): Promise<ChickenActionResult> {
  return callChicken("chicken_cashout", {}, "chickenCashout");
}
```
Y en el `import type { ... } from "@/lib/types";` del tope del archivo, agregar `MinesView, ChickenView`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/actions/finances.ts
git commit -m "feat(casino): tipos MinesView/ChickenView + actions (wrappers de RPC)"
```

---

### Task 5: Vista `src/components/mines-view.tsx`

**Files:**
- Create: `src/components/mines-view.tsx`

**Interfaces:**
- Consumes: `minesStart/minesPick/minesCashout` (`@/actions/finances`), `MinesView` (`@/lib/types`), `minesMultiplier` (`@/lib/casino`), `useWallet`, `Button`.

- [ ] **Step 1: Implementar la vista**

```tsx
"use client";

import { useState } from "react";
import { Bomb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { minesStart, minesPick, minesCashout } from "@/actions/finances";
import { minesMultiplier } from "@/lib/casino";
import { useWallet } from "@/lib/wallet-context";
import type { MinesView as MinesGame } from "@/lib/types";
import { cn } from "@/lib/utils";

function parseAmount(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function parseMines(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Math.min(24, Math.max(1, Number.isFinite(n) ? n : 1));
}

export default function MinesView() {
  const { setBalance } = useWallet();
  const [betRaw, setBetRaw] = useState("100");
  const [minesRaw, setMinesRaw] = useState("3");
  const [game, setGame] = useState<MinesGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const bet = parseAmount(betRaw);
  const mines = parseMines(minesRaw);
  const playing = game?.status === "PLAYING";

  async function start() {
    if (busy || bet <= 0) return;
    setBusy(true); setMsg(null);
    const res = await minesStart(bet, mines);
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "No se pudo iniciar"); return; }
    setGame(res.view); setBalance(res.view.newBalance);
  }

  async function pick(cell: number) {
    if (busy || !playing || game.picks.includes(cell)) return;
    setBusy(true);
    const res = await minesPick(cell);
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "Error"); return; }
    setGame(res.view);
    if (res.view.status === "DONE") setBalance(res.view.newBalance);
  }

  async function cashout() {
    if (busy || !playing || game.picks.length < 1) return;
    setBusy(true);
    const res = await minesCashout();
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "Error"); return; }
    setGame(res.view); setBalance(res.view.newBalance);
  }

  const revealed = new Set(game?.picks ?? []);
  const mineSet = new Set(game?.revealedMines ?? []);

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Controles previos / resultado */}
      {!playing && (
        <div className="mb-3 space-y-2 rounded-2xl border border-line bg-surface/70 p-4">
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-muted">
              Apuesta
              <input value={betRaw} onChange={(e) => setBetRaw(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-2 py-1.5 font-mono text-fg" />
            </label>
            <label className="w-24 text-xs text-muted">
              Minas (1–24)
              <input value={minesRaw} onChange={(e) => setMinesRaw(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-2 py-1.5 font-mono text-fg" />
            </label>
          </div>
          <p className="font-mono text-[11px] text-muted">
            Primera casilla paga <span className="text-gold">x{minesMultiplier(mines, 1).toFixed(2)}</span>
          </p>
          {game?.status === "DONE" && (
            <p className={cn("font-mono text-sm", game.result === "CASHED" ? "text-gold" : "text-danger")}>
              {game.result === "CASHED" ? `Cobraste +${game.payout} 🪙` : "💥 Tocaste una mina — perdiste la apuesta"}
            </p>
          )}
          {msg && <p className="font-mono text-xs text-danger">{msg}</p>}
          <Button onClick={start} disabled={busy || bet <= 0} className="w-full">Jugar</Button>
        </div>
      )}

      {/* Grid 5x5 */}
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 25 }, (_, i) => {
          const isRevealed = revealed.has(i);
          const isMine = (game?.status === "DONE") && mineSet.has(i);
          return (
            <button key={i} type="button" onClick={() => pick(i)}
              disabled={!playing || busy || isRevealed}
              className={cn(
                "aspect-square rounded-lg border text-lg grid place-items-center transition",
                isMine ? "border-danger/60 bg-danger/15"
                  : isRevealed ? "border-gold/50 bg-gold/12 text-gold"
                  : "border-line bg-ink-2 hover:bg-surface",
              )}>
              {isMine ? "💣" : isRevealed ? "✦" : ""}
            </button>
          );
        })}
      </div>

      {/* Cash out */}
      {playing && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="font-mono text-sm text-muted">
            x<span className="text-gold">{game.multiplier.toFixed(2)}</span>
            {game.nextMultiplier != null && <span className="text-muted"> · próx. x{game.nextMultiplier.toFixed(2)}</span>}
          </p>
          <Button onClick={cashout} disabled={busy || game.picks.length < 1}>
            <Bomb className="mr-1 h-4 w-4" /> Retirar {Math.round(game.bet * game.multiplier)} 🪙
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/mines-view.tsx
git commit -m "feat(casino): vista Minas (grid 5x5, apuesta, cashout, reveal)"
```

---

### Task 6: Vista `src/components/chicken-view.tsx`

**Files:**
- Create: `src/components/chicken-view.tsx`

**Interfaces:**
- Consumes: `chickenStart/chickenStep/chickenCashout`, `ChickenView`, `useWallet`, `Button`.

- [ ] **Step 1: Implementar la vista**

```tsx
"use client";

import { useState } from "react";
import { Egg } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chickenStart, chickenStep, chickenCashout } from "@/actions/finances";
import { useWallet } from "@/lib/wallet-context";
import type { ChickenView as ChickenGame } from "@/lib/types";
import { cn } from "@/lib/utils";

function parseAmount(raw: string): number {
  const n = Math.floor(Number(raw.replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const LANES = 20;

export default function ChickenView() {
  const { setBalance } = useWallet();
  const [betRaw, setBetRaw] = useState("100");
  const [game, setGame] = useState<ChickenGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const bet = parseAmount(betRaw);
  const playing = game?.status === "PLAYING";

  async function start() {
    if (busy || bet <= 0) return;
    setBusy(true); setMsg(null);
    const res = await chickenStart(bet);
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "No se pudo iniciar"); return; }
    setGame(res.view); setBalance(res.view.newBalance);
  }

  async function step() {
    if (busy || !playing) return;
    setBusy(true);
    const res = await chickenStep();
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "Error"); return; }
    setGame(res.view);
    if (res.view.status === "DONE") setBalance(res.view.newBalance);
  }

  async function cashout() {
    if (busy || !playing || game.lane < 1) return;
    setBusy(true);
    const res = await chickenCashout();
    setBusy(false);
    if (!res.ok || !res.view) { setMsg(res.error ?? "Error"); return; }
    setGame(res.view); setBalance(res.view.newBalance);
  }

  const lane = game?.lane ?? 0;

  return (
    <div className="mx-auto w-full max-w-md">
      {!playing && (
        <div className="mb-3 space-y-2 rounded-2xl border border-line bg-surface/70 p-4">
          <label className="block text-xs text-muted">
            Apuesta
            <input value={betRaw} onChange={(e) => setBetRaw(e.target.value)} inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-2 py-1.5 font-mono text-fg" />
          </label>
          {game?.status === "DONE" && (
            <p className={cn("font-mono text-sm", game.result === "CASHED" ? "text-gold" : "text-danger")}>
              {game.result === "CASHED" ? `Cobraste +${game.payout} 🪙 (x${game.multiplier.toFixed(2)})` : "🚗 El pollito no lo logró — perdiste la apuesta"}
            </p>
          )}
          {msg && <p className="font-mono text-xs text-danger">{msg}</p>}
          <Button onClick={start} disabled={busy || bet <= 0} className="w-full">Jugar</Button>
        </div>
      )}

      {/* Carriles */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-ink-2 p-2">
        {Array.from({ length: LANES + 1 }, (_, i) => (
          <div key={i}
            className={cn(
              "grid h-14 min-w-11 shrink-0 place-items-center rounded-lg border text-xs font-mono",
              i === lane ? "border-gold bg-gold/15 text-gold" : "border-line bg-surface/60 text-muted",
            )}>
            {i === lane ? (game?.status === "DEAD" ? "💥" : "🐤") : i === 0 ? "🏁" : `x${chickenMultiplierLabel(i)}`}
          </div>
        ))}
      </div>

      {playing && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="font-mono text-sm text-muted">
            x<span className="text-gold">{game.multiplier.toFixed(2)}</span>
          </p>
          <div className="flex gap-2">
            <Button onClick={cashout} variant="secondary" disabled={busy || game.lane < 1}>
              Retirar {Math.round(game.bet * game.multiplier)} 🪙
            </Button>
            <Button onClick={step} disabled={busy}>
              <Egg className="mr-1 h-4 w-4" /> Avanzar{game.nextMultiplier != null ? ` (x${game.nextMultiplier.toFixed(2)})` : ""}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Etiqueta de multiplicador por carril para la pista (usa la math compartida).
function chickenMultiplierLabel(lane: number): string {
  return chickenMultiplier(lane).toFixed(2);
}
```
Agregar el import: `import { chickenMultiplier } from "@/lib/casino";` (arriba, junto a los otros imports). NOTA: la función local `chickenMultiplierLabel` usa `chickenMultiplier` importado — asegurá el import; no dejar `chickenMultiplier` sin importar.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/chicken-view.tsx
git commit -m "feat(casino): vista Pollito (carriles, avanzar/retirar)"
```

---

### Task 7: Integrar las tabs en `src/components/casino-view.tsx`

**Files:**
- Modify: `src/components/casino-view.tsx`

**Interfaces:**
- Consumes: `MinesView` y `ChickenView` (componentes de Tasks 5 y 6).

- [ ] **Step 1: Agregar imports, tabs y montaje**

En `casino-view.tsx`:
- Imports nuevos:
```tsx
import MinesView from "@/components/mines-view";
import ChickenView from "@/components/chicken-view";
```
- Cambiar el tipo y la lista de tabs:
```tsx
type CasinoTab = "ruleta" | "blackjack" | "minas" | "pollito";

const TABS: [CasinoTab, string][] = [
  ["ruleta", "Ruleta"],
  ["blackjack", "Blackjack"],
  ["minas", "Minas"],
  ["pollito", "Pollito"],
];
```
- El contenedor de tabs pasa a 4 columnas: cambiar `grid-cols-2` por `grid-cols-4` en el `div role="tablist"`.
- Agregar las dos vistas montadas junto a las existentes:
```tsx
      <div hidden={tab !== "minas"}>
        <MinesView />
      </div>
      <div hidden={tab !== "pollito"}>
        <ChickenView />
      </div>
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/casino-view.tsx
git commit -m "feat(casino): agregar tabs Minas y Pollito"
```

---

### Task 8: Aplicar migraciones + verificación E2E

**Files:** ninguno (ejecución + verificación).

- [ ] **Step 1: Correr toda la suite de unit**

Run: `npm test`
Expected: PASS (incluye `casino.test.ts`).

- [ ] **Step 2: El usuario aplica las migraciones en Supabase**

En el SQL Editor de Supabase, correr `supabase/17_casino_mines.sql` y `supabase/18_casino_chicken.sql` (cada archivo entero, en orden). Deben decir Success.

- [ ] **Step 3: Push (deploy)**

```bash
git push origin master
```
Expected: Vercel redeploya.

- [ ] **Step 4: E2E en el deploy (navegador)**

Guion:
1. Ir a Finanzas → Casino → tab **Minas**. Apostar (ej. 50) con 3 minas → el saldo baja 50. Destapar casillas: el multiplicador sube; **Retirar** acredita `round(50 × mult)` y el saldo del header sube. Reiniciar y pegar una mina → pierde y se revelan las 💣.
2. Tab **Pollito**. Apostar → saldo baja. **Avanzar** varias veces (el multiplicador sube); **Retirar** acredita. Reiniciar y avanzar hasta que muera (💥) → pierde.
3. Confirmar en DevTools (Network) que la respuesta del RPC **no** contiene `mine_positions`/`revealed_mines` mientras `status='PLAYING'` (sólo aparece al terminar).
4. Consola sin errores.

- [ ] **Step 5: Verificación SQL de anti-trampa (opcional, en Supabase)**

Run:
```sql
select has_table_privilege('authenticated', 'public.mines_games', 'SELECT') as anon_can_read_mines,
       has_table_privilege('authenticated', 'public.chicken_games', 'SELECT') as anon_can_read_chicken;
```
Expected: ambos `false` (las tablas son RPC-only).

---

## Self-Review

**Spec coverage:**
- Math (fórmulas + tablas de referencia) → Task 1 (`casino.ts` + tests). ✅
- Tabla + RPCs Minas (start/pick/cashout), anti-trampa `mine_positions` oculto → Task 2. ✅
- Tabla + RPCs Pollito (start/step/cashout), muerte 25% server-side → Task 3. ✅
- Tipos saneados + wrappers de actions → Task 4. ✅
- Vistas Minas y Pollito → Tasks 5 y 6. ✅
- Integración de tabs → Task 7. ✅
- Apuesta con wallet (descuento/acredita, saldo del server) → Tasks 2/3 (RPCs) + vistas (`setBalance(newBalance)`). ✅
- Testing unit (math) + E2E → Tasks 1 y 8. ✅
- Migraciones las corre el usuario → Task 8 Step 2. ✅

**Placeholder scan:** sin TODO/TBD. El único texto a cuidar es en Task 6: la función `chickenMultiplierLabel` requiere el import de `chickenMultiplier` — el paso lo indica explícitamente.

**Type consistency:** `MinesView`/`ChickenView` (camelCase) definidos en Task 4 y usados igual en Tasks 5/6. `MinesActionResult`/`ChickenActionResult` con `{ ok, view, insufficient?, error? }` consistente con el patrón `BlackjackActionResult` existente. Los RPCs devuelven las columnas snake_case que `rowToMines`/`rowToChicken` mapean. Nombres de RPC (`mines_start`, etc.) consistentes entre Tasks 2/3 y 4.

**Nota de ejecución:** Tasks 1–7 las hace el agente (código + tests + build + commit). Task 8: el push y las migraciones/E2E requieren deploy y la DB del usuario; el agente puede conducir el E2E con navegador tras el deploy.
