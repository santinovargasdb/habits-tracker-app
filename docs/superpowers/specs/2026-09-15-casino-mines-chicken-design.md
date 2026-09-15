# Casino: Minas + Pollito — Diseño

- **Fecha:** 2026-09-15
- **Estado:** Diseño aprobado (pendiente de plan de implementación)
- **Repo:** santinovargasdb/habits-tracker-app

## Contexto

El casino actual (`casino-view.tsx`, dentro de `FinancesView`) tiene Ruleta y Blackjack. El
patrón establecido para juegos de apuesta:
- **Estado en curso** en una tabla server-only (`blackjack_games`): RLS habilitada, `revoke all`
  a `anon`/`authenticated`, acceso **sólo vía RPC** (el cliente jamás ve el mazo / la carta tapada).
- **RPCs** `SECURITY DEFINER` con `auth.uid()` (ej. `bj_deal`, `spin_roulette`) que descuentan/
  acreditan la `wallet` y devuelven una vista **saneada** (`bj_render` oculta lo que no corresponde).
- **Wrappers** en `src/actions/finances.ts` (`bjDeal`, `bjHit`, `bjStand`, `spinRoulette`) que llaman
  `supabase.rpc(...)`.
- **Vistas** cliente (`blackjack-view.tsx`, `roulette-view.tsx`) que usan las actions + `useWallet`.

Este diseño agrega **dos juegos** siguiendo ese patrón: **Minas** y **Pollito** (Chicken Road).

## Objetivo y no-objetivos

**Objetivo:** dos juegos de apuesta nuevos, integrados como tabs del casino, con lógica y RNG
**server-authoritative** (imposible hacer trampa desde el cliente), apuestas con las monedas del
wallet, y multiplicadores con **~3% de ventaja de la casa**.

**No-objetivos:**
- Sin modo offline (el casino ya es online-only; las vistas muestran el aviso cuando `!online`).
- Sin dificultad elegible en el Pollito (dificultad **fija**). Minas sí permite elegir la cantidad (1–24).
- No cambia la economía de hábitos ni los otros juegos.
- Sin "provably fair" con seed público (RNG server-side simple, `random()` de Postgres — igual que
  el resto del casino actual).

## Decisiones (brainstorming 2026-09-15)

1. **Minas:** cuadrícula 5×5 (25 casillas); cantidad de minas **elegible libremente de 1 a 24** (selector). Cuantas más minas, más paga (el multiplicador sube con la cantidad de minas). Máx 24 (deja ≥1 casilla segura).
2. **Pollito:** dificultad **fija**, **25% de morir por carril** (supervivencia 0.75), **tope 20 carriles**.
3. **House edge ~3%** en ambos: `multiplicador = 0.97 / P(sobrevivir)`.
4. Apuesta con monedas del wallet; mín 1; el server valida saldo, descuenta al empezar y acredita al cobrar.

## Matemática (fuente de verdad, espejada en cliente y server)

Se implementa en TS (`src/lib/casino.ts`, testeable) **y** en los RPCs (autoritativo para el pago).
Ambos deben coincidir. Constante de casa: `EDGE = 0.97`.

### Minas
- 25 casillas, `M` minas, `safe = 25 - M`.
- Tras `k` casillas seguras: `P(k) = Π_{i=0}^{k-1} (safe - i) / (25 - i)`.
- `minesMultiplier(M, k) = k === 0 ? 1 : round(EDGE / P(k), 2)`. Válido para `M` de 1 a 24.
- Valores de referencia (muestras para tests; M cualquiera 1–24):

| Minas | k=1 | k=2 | k=3 |
|---|---|---|---|
| 3  | 1.10 | 1.26 | 1.45 |
| 5  | 1.21 | 1.53 | 1.96 |
| 10 | 1.62 | 2.77 | 4.90 |

- `k = 0` → `1.00`. Máx `k = safe = 25 - M` (todas las seguras destapadas → gana al tope).
  A más minas, menos casillas seguras pero mayor multiplicador por casilla.

### Pollito
- `s = 0.75` (supervivencia por carril), muerte `= 0.25`.
- `chickenMultiplier(n) = n === 0 ? 1 : round(EDGE / s^n, 2)`.
- Valores de referencia (para tests):

| Carril n | 1 | 2 | 3 | 5 | 8 | 12 | 20 |
|---|---|---|---|---|---|---|---|
| Mult | 1.29 | 1.72 | 2.30 | 4.09 | 9.69 | 30.62 | 305.88 |

- `n = 0` → `1.00`. Máx `n = 20` (en el carril 20 sólo se puede cobrar).

### Pago
- `payout = round(bet × multiplicador_actual)` (monedas enteras). `bet` entero, multiplicador numérico.

## Arquitectura / componentes

### 1. Migraciones SQL (las corre el usuario en Supabase)

**`supabase/17_casino_mines.sql`:**
- Tabla `public.mines_games` (una partida activa por usuario):
  ```
  id uuid pk default gen_random_uuid()
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid()
  bet integer not null
  mines_count integer not null            -- 1..24 (elegido por el jugador)
  mine_positions integer[] not null       -- OCULTO (0..24)
  picks integer[] not null default '{}'   -- casillas seguras destapadas
  status text not null default 'PLAYING'  -- PLAYING | DONE
  result text                             -- CASHED | BUSTED | null
  multiplier numeric not null default 1
  payout integer
  created_at/updated_at timestamptz default now()
  constraint mines_user_unique unique (user_id)
  ```
  RLS `enable`; `revoke all on public.mines_games from anon, authenticated;` (acceso RPC-only).
- Función pura `mines_multiplier(p_mines int, p_picks int) returns numeric` (immutable) con la fórmula de arriba.
- Vista saneada `mines_render(g public.mines_games, p_balance integer)` → devuelve
  `status, result, bet, mines_count, picks, multiplier, next_multiplier, payout, revealed_mines, new_balance`.
  `revealed_mines = null` mientras `status='PLAYING'`; `= g.mine_positions` cuando `status='DONE'`.
  `next_multiplier = mines_multiplier(mines_count, array_length(picks)+1)` (hint para la UI).
- RPCs (SECURITY DEFINER, `auth.uid()`, `set search_path = public`):
  - `mines_start(p_bet integer, p_mines integer)`:
    valida `p_mines between 1 and 24`, `p_bet > 0`, saldo suficiente; descuenta `p_bet`;
    sortea `p_mines` posiciones distintas 0..24; upsert en `mines_games` (`on conflict (user_id) do update`,
    reiniciando picks/status — abandonar una partida previa PLAYING pierde su apuesta ya descontada);
    devuelve `mines_render` (multiplier=1, picks={}, revealed_mines=null).
  - `mines_pick(p_cell integer)`:
    requiere partida `PLAYING` del usuario y `p_cell` 0..24 no repetida;
    si `p_cell = any(mine_positions)` → `status='DONE', result='BUSTED', payout=0` (revela tablero);
    si no → agrega a `picks`, `multiplier = mines_multiplier(mines_count, len(picks))`; si `len(picks)=safe`
    → auto-cashout al tope; devuelve `mines_render`.
  - `mines_cashout()`:
    requiere `PLAYING` con `array_length(picks) >= 1`; `payout = round(bet × multiplier)`;
    acredita wallet; `status='DONE', result='CASHED'`; devuelve `mines_render`.
- Grants: `execute` a `authenticated` en los RPCs; `revoke ... from anon`. NO grant de `mines_render` a anon.

**`supabase/18_casino_chicken.sql`:**
- Tabla `public.chicken_games` (una partida activa por usuario):
  ```
  id, user_id (= auth.uid() default), bet integer, lane integer default 0,
  status text default 'PLAYING', result text (CASHED|DEAD|null),
  multiplier numeric default 1, payout integer, created_at/updated_at,
  constraint chicken_user_unique unique (user_id)
  ```
  RLS `enable`; `revoke all from anon, authenticated`.
- Función `chicken_multiplier(p_lane int) returns numeric` (immutable): `p_lane<=0 ? 1 : round(0.97 / power(0.75, p_lane), 2)`.
- Vista `chicken_render(g, p_balance)` → `status, result, bet, lane, multiplier, next_multiplier, payout, new_balance`
  (`next_multiplier = lane>=20 ? null : chicken_multiplier(lane+1)`).
- RPCs:
  - `chicken_start(p_bet integer)`: valida bet/saldo; descuenta; upsert (lane=0, status PLAYING); devuelve render.
  - `chicken_step()`: requiere `PLAYING`, `lane < 20`; `if random() < 0.25` → `status='DONE', result='DEAD', payout=0`;
    si no → `lane = lane + 1`, `multiplier = chicken_multiplier(lane)`; devuelve render.
  - `chicken_cashout()`: requiere `PLAYING`, `lane >= 1`; `payout = round(bet × multiplier)`; acredita; `DONE/CASHED`.
- Grants como Minas.

### 2. Math en TS — `src/lib/casino.ts`
```ts
export const CASINO_EDGE = 0.97;
export function minesMultiplier(mines: number, picks: number): number  // fórmula P(k); picks 0 → 1
export function chickenMultiplier(lane: number): number                // 0.97/0.75^lane; lane 0 → 1
```
Redondeo a 2 decimales. Se usan en las vistas para hints; los RPCs son autoritativos para el pago.

### 3. Server actions — `src/actions/finances.ts` (mismo archivo que blackjack/roulette)
Wrappers que llaman `supabase.rpc` y devuelven `{ ...renderRow, new_balance }` (o `{ error }`):
- `minesStart(bet, mines)`, `minesPick(cell)`, `minesCashout()`
- `chickenStart(bet)`, `chickenStep()`, `chickenCashout()`
Cada uno hace `supabase.rpc('mines_start', { p_bet, p_mines })` etc. y devuelve `data[0]`.

### 4. Vistas — `src/components/mines-view.tsx`, `src/components/chicken-view.tsx`
Estilo `blackjack-view` (Button, `useWallet`, saldo autoritativo del RPC).
- **Mines:** input de apuesta + selector de minas **1–24** (input numérico o slider, con el multiplicador
  de la 1ª casilla mostrado como referencia según la cantidad elegida); al iniciar, grid 5×5 de botones; cada click llama
  `minesPick`; casilla segura muestra ✓ (o el multiplicador acumulado); al perder, se revelan las minas
  (💣) desde `revealed_mines`; botón **"Retirar x{multiplier} = {payout}"** cuando hay ≥1 pick. Estado
  de la partida en curso se mantiene montado (como blackjack).
- **Chicken:** input de apuesta; visualización de carriles (el pollito en `lane`); botón
  **"Avanzar (próx. x{next_multiplier})"** y **"Retirar x{multiplier} = {payout}"**; animación/mensaje al morir.

### 5. Integración — `src/components/casino-view.tsx`
`CasinoTab` pasa a `"ruleta" | "blackjack" | "minas" | "pollito"`; `TABS` agrega
`["minas","Minas"]` y `["pollito","Pollito"]`; el grid de tabs pasa a 4 columnas (o 2×2). Las 4 vistas
montadas con `hidden` (preserva partida en curso al alternar). El guard offline ya existe en `casino-view`.

### 6. Tipos — `src/lib/types.ts`
Agregar interfaces para las filas saneadas (`MinesView`, `ChickenView`) espejando el retorno de los
RPCs, análogas a `BlackjackView`.

## Wallet / apuestas
- Descuento al `*_start`, acreditación al `*_cashout` (o pérdida al bust/muerte). El RPC devuelve
  `new_balance`; la vista hace `setBalance(new_balance)` (via `useWallet`). Igual que blackjack.
- Mín apuesta 1; el server rechaza saldo insuficiente (`raise ... errcode 'P0001'`), como blackjack.
- Una partida activa por usuario por juego (constraint unique). Empezar otra sobrescribe la anterior
  (se pierde la apuesta ya descontada de la abandonada) — mismo comportamiento que `bj_deal`.

## Anti-trampa (crítico)
- `mine_positions` **nunca** viaja al cliente mientras `status='PLAYING'` (`mines_render` lo oculta;
  la tabla es RPC-only). Sólo se revela en `status='DONE'`.
- La muerte del Pollito se decide **por paso en el server** (`random()` en `chicken_step`), no
  predecible desde el cliente.
- Los pagos los calcula el server (RPC), nunca el cliente.

## Testing
- **Unit (Vitest):** `src/lib/casino.test.ts` cubre `minesMultiplier` (los 9 valores de la tabla + k=0 +
  k=safe) y `chickenMultiplier` (la tabla + lane 0 + lane 20).
- **E2E (deploy):** iniciar cada juego con una apuesta, verificar descuento; en Minas destapar seguras
  (multiplicador sube) y retirar (acredita `bet×mult`); pegar una mina → pierde y revela; en Pollito
  avanzar/retirar y morir. Confirmar que el saldo del server manda y que `mine_positions` no aparece en
  la respuesta mientras se juega.
- La lógica de los RPCs (RNG, anti-trampa) no se unit-testea (SQL); se cubre por E2E.

## Riesgos
- Divergencia math TS vs RPC: mitigado con la tabla de referencia compartida y los unit tests; el RPC
  es la autoridad del pago.
- `random()` de Postgres no es criptográficamente seguro, pero es suficiente para este casino personal
  (mismo estándar que Ruleta/Blackjack ya existentes).
- Redondeo: `round(bet × multiplier)` a entero puede introducir ±0.5 de sesgo; despreciable.
