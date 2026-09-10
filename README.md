# 道 Dojo Ledger — Tracking de Hábitos + Economía Gamificada

MVP · **Paso 1: Motor de Tracking y Economía Base**

PWA mobile-first para trackear hábitos con una economía de monedas integrada.
Registrás cada hábito con un control de 3 estados a un solo toque y ganás (o perdés)
monedas al instante.

- **Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · shadcn/ui · Supabase (PostgreSQL)
- **UX:** actualizaciones optimistas (la UI no espera a la red) · sticky header con balance en vivo · PWA instalable

> **Modo demo:** la app funciona apenas la corrés, sin configurar nada. Muestra los
> hábitos base y podés tocar los estados (sin persistir). Al configurar Supabase,
> todo se guarda y el balance se vuelve autoritativo.

---

## 1. Correr en local

```bash
npm install
npm run dev      # http://localhost:3000  (arranca en modo demo)
```

## 2. Configurar Supabase (persistencia)

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, y ejecutá en este orden:
   - `supabase/schema.sql` → tablas, tipos, RPC de economía y RLS (Paso 1).
   - `supabase/seed.sql` → billetera en 0 + los 8 hábitos base (Paso 1).
   - `supabase/02_cards_deck.sql` → cartas, inventario, mazo, multiplicador y seed de cartas (Paso 2).
   - `supabase/03_store_chests.sql` → RPC `purchase_chest` (tienda de cofres / gacha) (Paso 3).
   - `supabase/04_finances.sql` → `investments` + RPCs `manage_investment`, `calculate_daily_interest`, `spin_roulette` (Paso 4).
   - `supabase/05_card_levels.sql` → `effective_multiplier`, `deck_multiplier_percent` (con nivel) + RPC `upgrade_card` (Paso 5).
   - `supabase/06_auth_rls.sql` → **auth multiusuario**: `user_id` en todas las tablas, trigger de seed por usuario, RLS estricta (`auth.uid()`) y cierre del acceso anónimo (Paso 6). Ver §6b.
   - `supabase/07_casino_blackjack.sql` → **casino**: ruleta europea por color (`spin_roulette(bet, choice)`) + Blackjack con estado en servidor (`blackjack_games` + `bj_deal`/`bj_hit`/`bj_stand`) (Paso 7). Ver §4f.
3. **Project Settings → API**: copiá la _Project URL_ y la _anon public key_.
4. Copiá el ejemplo de env y completalo:
   ```bash
   cp .env.local.example .env.local
   ```
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
   ```
5. Reiniciá `npm run dev`. El banner de "modo demo" desaparece y los cambios persisten.

---

## 3. Modelo de datos

| Tabla    | Descripción                                                        |
| -------- | ------------------------------------------------------------------ |
| `wallet` | Billetera única del usuario. `balance` (integer, default 0).       |
| `habits` | `id`, `name`, `time_block` (`Madrugada`\|`Viaje`\|`Tarde`\|`Noche`). |
| `logs`   | `id`, `habit_id`, `date`, `status` (`NONE`\|`MET`\|`SURPASSED`). Único por (habit, día). |

## 4. Economía y multiplicador de cartas

Pago base por estado: `NONE` = 0 · `MET` = +50 · `SURPASSED` = +150.

**Multiplicador (Paso 2):** al registrar un hábito, el backend lee el `active_deck`
y suma el `multiplier_percent` de las cartas equipadas cuyo `target_block` coincide
con el bloque del hábito (o es global). El pago final es:

```
pago = round(pago_base × (100 + multiplicador%) / 100)
```

Ej.: `Voluntad de Acero` (+25% Madrugada) equipada → "Despertar 5:30 AM" en MET paga
`round(50 × 1.25) = 63`.

Cada `log` guarda las monedas realmente acreditadas (`coins_awarded`), así el balance
**siempre** se ajusta por la _diferencia_ `pago_nuevo − pago_previo`. Esto hace que
cualquier cambio de estado sume/reste lo justo **con el multiplicador correcto**, aun
si el mazo cambió entre medio:

- `NONE → MET` = **+pago(MET)** · `MET → NONE` = **−pago(MET)** _(corrección)_
- `MET → SURPASSED`, `SURPASSED → MET`, etc. → siempre la diferencia exacta.

Todo vive en el RPC atómico `set_habit_status(habit_id, date, status)` (usa
`deck_multiplier_percent(block)`), invocado desde la Server Action
`src/actions/habits.ts`. El frontend aplica el cambio de forma optimista (con el mismo
cálculo de multiplicador en `computeAward`) y luego reconcilia con el valor de la DB.

## 4b. Cartas y mazo (Paso 2)

- **Navegación:** bottom-nav fija alterna entre **Tracker** y **Mazo** (estado
  client-side; ambas vistas quedan montadas para preservar scroll/estado).
- **DeckView:** grid de 8 slots (mazo activo) arriba + inventario abajo. Tocar una
  carta abre un **Drawer** inferior con su diseño, rareza y botones **Equipar** /
  **Quitar**. La deduplicación (una carta no puede estar en dos slots) la resuelve el
  RPC `set_deck_slot`.
- **Cartas seed:** Libro de Viaje (Common, +10% Viaje), Foco en la Ecuación (Rare,
  +15% Tarde), Cinturón Naranja (Epic, +20% Tarde), Voluntad de Acero (Legendary,
  +25% Madrugada). Dos cartas del mismo bloque **acumulan** su porcentaje.

## 4c. Tienda de cofres / gacha (Paso 3)

- **Navegación:** se agrega el tab **Mercado** a la bottom-nav.
- **Cofres:** Básico (500 · 80/18/2/0), Oro (2000 · 20/65/14/1), Mágico
  (5000 · 0/30/60/10) — orden de odds: Común/Rara/Épica/Legendaria.
- **Compra segura:** el RPC `purchase_chest(chest_cost, chest_type)` es **autoritativo**
  — define costo y probabilidades en el servidor, valida saldo (con lock del wallet),
  descuenta, corre el **RNG dentro de Postgres**, hace UPSERT en `user_inventory`
  (`quantity + 1`) y devuelve la carta ganada + nuevo balance. El `chest_cost` del
  cliente sólo se valida por coherencia (anti-tampering).
- **Gacha reveal:** al comprar se abre un modal centrado con animación de apertura
  (chest shake + glow) y luego la revelación de la carta (reutiliza el diseño del mazo,
  brillo según rareza). Botones deshabilitados si no alcanza el saldo (muestran cuánto falta).
- **Sync:** al cerrar el modal, el `balance` del Header y el inventario del Mazo ya
  reflejan la compra (estado global vía `WalletContext` + `GameContext.applyCardWin`).
- **Modo demo:** sin Supabase, el gacha se simula en el cliente con las mismas odds
  (`rollRarity` / `pickRandomCardOfRarity`, que espejan el RPC).

## 4d. Finanzas: interés compuesto y ruleta (Paso 4)

- **Navegación:** cuarto tab **Finanzas**.
- **Inversión (`investments`):** dos fondos singleton — Conservador "Bono Entropía"
  (**+1% diario fijo**) y "Alto Riesgo" (**RNG: 70% +5% / 30% −3%** por día).
  Cada tarjeta permite **Depositar** / **Retirar** vía el RPC transaccional
  `manage_investment(action, fund, amount)` (valida saldo de wallet o del fondo, con lock).
- **Interés compuesto:** `calculate_daily_interest()` se llama silenciosamente al montar
  la vista. Calcula los **días enteros** transcurridos desde `last_compounded_at`, aplica el
  interés (compuesto para Conservador; RNG por día para Agresivo) y **avanza el timestamp
  por días enteros** (preserva el remanente sub-día → idempotente dentro del mismo día;
  tope de 365 días como salvaguarda anti-loops).
- **Ruleta:** la versión original (slot con pesos ×0…×50) fue **reemplazada en el Paso 7**
  por una ruleta europea por color. Ver §4f.
- **Modo demo:** depositar/retirar se simulan en el cliente. El interés no corre en demo
  (no hay tiempo transcurrido persistido).

## 4e. Subida de nivel de cartas (Paso 5)

- **Modelo:** `cards.multiplier_percent` es la **base del catálogo**; el bonus por nivel se
  **deriva** (`base + (level−1)×5`) usando `user_inventory.level`. Así el progreso del usuario
  no contamina el catálogo global (clave para multiusuario con auth). La función SQL
  `effective_multiplier(base, level)` es la fuente de verdad, y `deck_multiplier_percent`
  ahora la usa (join con `user_inventory`) para que el mazo considere el nivel.
- **Requisitos L → L+1:** duplicados = `L+1` · costo = `L×500` 🪙 · nivel máximo 10.
  > Nota: el ejemplo del brief usaba 1000 🪙; lo ajusté a **500×nivel** para que sea
  > alcanzable con la economía actual (un cofre de duplicado cuesta 500). Es un solo
  > constante (`UPGRADE_COST_STEP` en `constants.ts` y `* 500` en el SQL).
- **RPC `upgrade_card(p_card_id)`:** valida duplicados y saldo (con lock de la fila de
  inventario y del wallet), descuenta monedas, resta los duplicados, sube `level` y devuelve
  nuevo nivel, multiplicador efectivo, quantity y balance.
- **UI (DeckView drawer):** al tocar cualquier carta (equipada o en inventario) se abre el
  drawer con **Actual Nivel N (+X%) → Siguiente Nivel N+1 (+Y%)**, progreso de duplicados
  (`q/req`) y costo. El botón "Mejorar carta" se deshabilita mostrando qué falta
  ("Faltan N duplicados" / "Faltan X 🪙"). Al mejorar: **flash dorado**, badge `NvN` en la
  carta y contadores en vivo. Sincroniza wallet (global) e inventario (`applyUpgrade`).
- **Modo demo:** la mejora se simula en el cliente con los mismos requisitos/fórmula.

## 4f. Casino: Ruleta V2 + Blackjack (Paso 7)

Dentro del tab **Finanzas**, la sección **Casino** tiene un selector de pestañas
**Ruleta / Blackjack** (`casino-view.tsx`).

- **Ruleta europea (`spin_roulette(bet, choice)`):** apostás a un **color**. RNG de una
  casilla **0–36** con el mapa de color **auténtico** (18 rojos / 18 negros / 1 verde;
  los colores alternan como en una mesa real). Pagos totales sobre la apuesta:
  **Verde ×14 · Rojo/Negro ×2**. La UI muestra 3 botones con los colores exactos, cicla
  números al girar y revela el número ganador con su color + delta de monedas.
- **Blackjack (estado en servidor):** tabla `blackjack_games` (una partida activa por
  usuario) con el **mazo barajado y la carta tapada del crupier en el servidor**. RPCs
  `bj_deal` / `bj_hit` / `bj_stand`. El crupier **roba al azar** y **puede sacar blackjack
  natural**; en su turno se planta en 17. Pagos: **normal 1:1, blackjack 3:2, empate push**.
  > **Seguridad:** `blackjack_games` **no se expone al cliente** (RLS + `revoke` directo);
  > se opera sólo vía los RPCs `security definer`, que devuelven una vista saneada (la carta
  > tapada no viaja hasta el reveal). Ver `supabase/07_casino_blackjack.sql`.
- **Modo demo:** ambos juegos corren client-side con `lib/blackjack.ts` y los helpers de
  ruleta en `constants.ts`, espejando las reglas del servidor.

---

## 5. Estructura

```
supabase/
  schema.sql          # (P1) tablas + tipos + status_value() + set_habit_status() + RLS
  seed.sql            # (P1) wallet en 0 + 8 hábitos base (UUIDs fijos)
  02_cards_deck.sql   # (P2) cards/user_inventory/active_deck + multiplicador + set_deck_slot + seed
  03_store_chests.sql # (P3) RPC purchase_chest (RNG + upsert inventario, transaccional)
  04_finances.sql     # (P4) investments + manage_investment / calculate_daily_interest / spin_roulette
  05_card_levels.sql  # (P5) effective_multiplier + deck_multiplier_percent (con nivel) + upgrade_card
  06_auth_rls.sql     # (P6) user_id + trigger de seed por usuario + RLS estricta (auth.uid) + cierre anon
  07_casino_blackjack.sql # (P7) ruleta por color (spin_roulette) + blackjack (blackjack_games, bj_deal/hit/stand)
src/
  proxy.ts            # (P6) Proxy Next 16 (ex-middleware): refresca sesión + protege rutas privadas
  app/
    layout.tsx        # fuentes, metadata/PWA; chrome (Header+Wallet) sólo con sesión (o en demo)
    page.tsx          # server: fetch hábitos+logs+cartas+inventario+mazo → AppShell
    manifest.ts       # PWA manifest (/manifest.webmanifest)
    globals.css       # sistema de diseño (tokens, atmósfera, animaciones)
    login/page.tsx    # (P6) login/signup email+password (client component)
    auth/confirm/route.ts  # (P6) verifica el link de confirmación de email (verifyOtp)
  actions/
    habits.ts         # (P1) Server Action → RPC set_habit_status (reconcilia balance + coins)
    deck.ts           # (P2) Server Action → RPC set_deck_slot (equipar/quitar)
    store.ts          # (P3) Server Action → RPC purchase_chest (compra de cofre)
    finances.ts       # (P4) Server Actions → manage_investment / calculate_daily_interest / spin_roulette
    cards.ts          # (P5) Server Action → upgrade_card (subida de nivel)
    auth.ts           # (P6) Server Actions → login / signup / logout
  components/
    app-shell.tsx               # tabs Tracker/Mazo/Mercado + GameProvider
    bottom-nav.tsx              # navegación inferior fija (3 tabs)
    header.tsx                  # sticky, balance con count-up + pulso
    tracker-view.tsx            # agrupa por bloque + multiplicador; estado/pago optimista
    habit-card.tsx              # control de 3 estados + delta flotante (multiplicado)
    deck-view.tsx               # (P2) 8 slots + inventario + drawer equipar/quitar
    game-card.tsx               # (P2) carta visual (marco por rareza, brillo legendario)
    store-view.tsx              # (P3) 3 cofres + odds + compra
    chest-reveal-modal.tsx      # (P3) animación de apertura + revelación de carta (gacha)
    finances-view.tsx           # (P4/P7) fondos de inversión + <CasinoView/>
    casino-view.tsx             # (P7) selector de pestañas Ruleta / Blackjack
    roulette-view.tsx           # (P7) ruleta europea por color (Verde/Rojo/Negro)
    blackjack-view.tsx          # (P7) mesa de blackjack: manos, scores, Deal/Hit/Stand
    service-worker-registrar.tsx
    ui/button.tsx · ui/drawer.tsx · ui/badge.tsx  # primitivos estilo shadcn (drawer/modal vía portal)
  lib/
    types.ts · constants.ts · utils.ts · blackjack.ts (P7: motor compartido demo+UI)
    supabase/server.ts          # (P6) cliente server por-request con cookies (@supabase/ssr; null → demo)
    supabase/client.ts          # (P6) cliente browser (login)
    supabase/session.ts         # (P6) refresh de sesión + gate de rutas (usado por proxy.ts)
    wallet-context.tsx · game-context.tsx · use-count-up.ts
public/
  sw.js · icon.svg · icon-maskable.svg
```

## 6b. Autenticación y RLS multiusuario (Paso 6)

La app pasó de "single-user MVP" a **multiusuario con Supabase Auth**:

- **Email/Password** con confirmación de email. Página `/login` (login + signup) y
  logout desde el header.
- **`proxy.ts`** (Next 16 renombró `middleware` → `proxy`) refresca la sesión y
  redirige a `/login` a quien no esté autenticado. Es un chequeo optimista de UX:
  la seguridad **real** la impone la RLS en la base.
- **RLS estricta:** cada tabla de datos tiene `user_id` y una política
  `user_id = auth.uid()`. Los RPCs (`set_habit_status`, `purchase_chest`, …) se
  reescribieron para operar con `auth.uid()`; el acceso `anon` quedó revocado.
- **Alta de usuario:** un trigger en `auth.users` siembra por cada usuario nuevo su
  wallet, los 8 hábitos, los 2 fondos, un mazo vacío y una copia de cada carta.
- **Fresh start:** los datos creados antes del Paso 6 quedan con `user_id` NULL e
  invisibles bajo RLS (no se borran, pero ya no se ven).

**Configuración en el dashboard de Supabase:**

1. **Authentication → Providers → Email:** habilitado, con **"Confirm email"** ON.
2. **Authentication → URL Configuration:** seteá el _Site URL_ (ej. `http://localhost:3000`)
   y agregá `…/auth/confirm` a los _Redirect URLs_.
3. **Authentication → Email Templates → Confirm signup:** que el link apunte a
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.

> **Modo demo intacto:** sin variables de entorno de Supabase, el `proxy` es un
> no-op y la app sigue siendo explorable sin login.

## 6. Notas del MVP

- **PWA:** el service worker se registra solo en producción (`npm run build && npm start`)
  para no cachear el bundle en desarrollo.
