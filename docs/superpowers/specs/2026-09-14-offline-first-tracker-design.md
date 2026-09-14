# Tracker offline-first con sincronización — Diseño

- **Fecha:** 2026-09-14
- **Estado:** Diseño aprobado (pendiente de plan de implementación)
- **Repo:** santinovargasdb/habits-tracker-app
- **Enfoque elegido:** A — Tracker client-first con store local + sync en background

## Contexto y problema

Hoy la app es SSR + Server Actions:
- `layout.tsx` (`getSessionChrome` → `auth.getUser()` + wallet) y `page.tsx` (hábitos por RLS) se
  renderizan en el servidor y **necesitan una sesión ahí**. El auto-login es del lado del
  cliente (`SessionBootstrap` → `ensureAppSession` → `router.refresh()`), así que hasta que ese
  round-trip termina se ve `0/0` sin saldo (no hay estado de "cargando"). Bajo latencia/rate-limit
  de auth eso dura minutos.
- El service worker (`public/sw.js`) hace cache-first del shell `"/"` (una foto del SSR).
- **No hay almacenamiento local, ni cola de cambios, ni sync.** Offline no se puede marcar (los
  Server Actions y Supabase fallan) y el marcado no persiste.

Objetivo del proyecto (declarado por el usuario): poder **usar el Tracker sin internet** (ej. en el
colectivo), guardar los cambios localmente y **sincronizarlos al reconectar**.

## Objetivo y no-objetivos

**Objetivo:** el **Tracker** funciona offline (ver hábitos del día/semana, marcar Nada/Hecho/Superé,
progreso y monedas optimistas) y sincroniza con Supabase al reconectar. Como efecto colateral,
**se elimina el parpadeo `0/0`** (la UI renderiza del store local al instante).

**No-objetivos:**
- Casino, Mercado (gacha) y Finanzas **quedan online-only** (usan RNG/economía autoritativa del
  server). Offline muestran un estado "necesitás internet".
- No IndexedDB (usamos `localStorage` detrás de un módulo intercambiable; los datos son chicos).
- No Background Sync API del service worker (sincronizamos en el evento `online` desde la página).
- No UI de resolución de conflictos (single-user; last-write-wins por `(hábito, fecha)`).
- No cambia la economía ni los RPCs del server (`set_habit_status` sigue siendo la verdad final).

## Decisiones tomadas (brainstorming 2026-09-14)

1. **Alcance offline:** solo el Tracker. Resto online-only.
2. **Monedas offline:** optimistas (fórmula espejada en el cliente) + reconciliación al reconectar
   (replay de `set_habit_status`; el balance del server pisa al local).
3. **Enfoque:** A — Tracker client-first con store local + sync en background.
4. **Storage:** `localStorage` detrás de un módulo (`src/lib/offline/store.ts`).
5. **Conflictos:** last-write-wins por `(hábito, fecha)` con timestamp.
6. **Sesión offline:** las ops locales no requieren token; al reconectar se asegura sesión y recién
   ahí se sincroniza. El primer uso requiere internet.

## Arquitectura

```
        ┌──────────────────────────── Cliente (navegador) ───────────────────────────┐
        │                                                                             │
  UI (TrackerView) ◄──lee/inicializa── store local (localStorage) ◄──actualiza── sync.ts
        │                                     ▲                                   │
        │  mark(habit,status)                 │ optimista + outbox                │ online?
        ▼                                     │                                   ▼
   use-tracker-data ──enqueue──► outbox (coalescido por habito+fecha) ──flush──► set_habit_status
        │                                                                    (Server Action → RPC)
        └─ pull fresco (Supabase client) ◄──────────────────────────────────────────┘
```

- **Lectura:** UI ← store local (instantáneo, offline). Background si hay red: Supabase → store → UI.
- **Escritura:** UI → store local (optimista) + outbox. Si hay red → flush → balance del server → store → UI.
- **Sync triggers:** montaje (si online), evento `online`, y post-marca (si online, con debounce).

## Módulos (file structure)

Todos nuevos bajo `src/lib/offline/`, cada uno con una responsabilidad:

### `store.ts` — persistencia local
Wrapper tipado sobre `localStorage`. Namespacing con prefijo `dojo:`. Serializa/parsea JSON y
tolera storage no disponible (modo privado) devolviendo defaults.

Estado guardado (snapshot del Tracker + outbox + metadata):
```ts
interface TrackerSnapshot {
  date: string;                 // día del snapshot (YYYY-MM-DD)
  habits: Habit[];              // lista de hábitos
  logs: LogMap;                 // habitId -> HabitStatus (día + semana)
  awards: AwardMap;             // habitId -> monedas acreditadas
  balance: number;              // saldo conocido
}
interface OutboxEntry {
  habitId: string;
  logDate: string;              // fecha del log (hoy, o lunes si semanal)
  status: HabitStatus;
  updatedAt: number;            // epoch ms (para LWW)
}
```
API: `readSnapshot(): TrackerSnapshot | null`, `writeSnapshot(s)`, `readOutbox(): OutboxEntry[]`,
`writeOutbox(entries)`, `readBalance()/writeBalance()`, `readLastSync()/writeLastSync()`.

### `outbox.ts` — cola de cambios pendientes
Sobre `store.ts`. Coalesce por clave `${habitId}:${logDate}` (gana `updatedAt` mayor).
- `enqueue(entry: OutboxEntry): void`
- `all(): OutboxEntry[]`
- `remove(habitId, logDate): void`
- `clear(): void`

### `reward.ts` — cálculo optimista de monedas (espeja el server)
```ts
// base: MET=50, SURPASSED=150, NONE=0. Semanal ×5. Bonus del mazo = suma de
// multiplier_percent de cartas equipadas (por bloque o global). MVP: mazo vacío → 0.
function optimisticReward(params: {
  status: HabitStatus;
  frequency: HabitFrequency;
  timeBlock: string;
  deckBonusPercent: number;     // 0 si no hay mazo equipado
}): number
```
Reglas idénticas a `set_habit_status` para minimizar divergencia; el server reconcilia igual.

### `use-online.ts` — conectividad
```ts
function useOnline(): boolean   // navigator.onLine + listeners 'online'/'offline'
```

### `sync.ts` — motor de sincronización
```ts
async function syncNow(opts?: { onUpdate?: (s: TrackerSnapshot) => void }): Promise<
  { ok: true; snapshot: TrackerSnapshot } | { ok: false; reason: string }
>
```
Pasos:
1. Si `!navigator.onLine` → `{ok:false, reason:'offline'}`.
2. **Asegurar sesión** (reusa `ensureAppSession`; si falla → `{ok:false, reason:'auth'}`, sin tocar el store).
3. **Flush outbox:** por cada entry (orden por `updatedAt`), llamar el server action `setHabitStatus`.
   - Éxito → si devuelve `balance`, guardarlo; `outbox.remove(...)`.
   - Falla → dejar en outbox, cortar el flush (reintenta luego), devolver `{ok:false}`.
4. **Pull fresco:** consultar Supabase (cliente) por hábitos + logs (hoy y lunes de la semana) +
   wallet. Construir snapshot. **No** pisar claves que sigan en el outbox.
5. Escribir snapshot + `lastSync`, invocar `onUpdate`, devolver `{ok:true, snapshot}`.

Concurrencia: un mutex simple (flag `syncing`) para no solapar syncs.

### `use-tracker-data.ts` — estado del Tracker (fuente para la UI)
```ts
function useTrackerData(seed: TrackerSnapshot | null): {
  date: string; habits: Habit[]; logs: LogMap; awards: AwardMap;
  balance: number; online: boolean; pendingCount: number;
  mark: (habit: Habit, status: HabitStatus) => void;
}
```
- Inicializa estado **sincrónicamente** desde `store.readSnapshot()` (o `seed` si no hay store).
- En `mount`: si online → `syncNow({onUpdate})` en background.
- En evento `online`: `syncNow`.
- `mark(habit, status)`:
  1. Calcular `logDate` (hoy o lunes si semanal) y `reward = optimisticReward(...)`.
  2. Update optimista: `logs[habit.id]=status`, `awards[habit.id]=reward`, `balance += reward - prevReward`.
  3. Persistir snapshot; `outbox.enqueue({habitId, logDate, status, updatedAt: Date.now()})`.
  4. Si online → `syncNow` (debounced ~500ms) para reconciliar.

## Rewire del render

### `page.tsx`
- Deja de ser la fuente de verdad. Renderiza `AppShell` pasando los datos SSR como **`seed`**
  (cuando hay sesión) o vacío. Mantiene `export const dynamic = "force-dynamic"` (sirve para sembrar
  online), pero la UI ya no depende de que el seed tenga datos.

### `AppShell` / `TrackerView`
- `TrackerView` pasa a consumir `useTrackerData(seed)` en vez de recibir `habits/logs/awards` fijos por props.
  Renderiza desde el store local apenas hidrata (sin round-trip → sin `0/0`).
- El `mark` interno de `TrackerView` se reemplaza por el `mark` de `useTrackerData` (que ya hace
  optimista + outbox + sync). Se elimina la llamada directa a `setHabitStatus` desde el componente.

### Header / saldo (`layout.tsx`, `client-wallet-provider.tsx`, `header.tsx`)
- Hoy `layout` muestra el header solo si `authed` (SSR) y pasa `initialBalance` del server.
- Cambio: el **header se renderiza siempre** (client-first) y el saldo sale del store local
  (`ClientWalletProvider` inicializa de `store.readBalance()` con el SSR como fallback). Así el saldo
  se ve offline y sin parpadeo. El email/estado de sesión se resuelve en cliente (o se oculta offline).

### Indicadores
- Chip de estado **Offline** (cuando `!online`) y **"N pendientes"** (cuando `pendingCount>0`) en el
  header o el hero del Tracker. Toast breve si un `syncNow` devuelve `{ok:false}` con `reason!=='offline'`.

## Service worker (`public/sw.js`)
- Extender el precache/runtime-cache al **shell + assets estáticos** para que la app cargue offline
  tras la primera visita: `"/"`, `/_next/static/*` (JS/CSS con hash → runtime cache stale-while-revalidate),
  íconos y `manifest.webmanifest`.
- Mantener el passthrough de POST (Server Actions) y de `*.supabase.co` (offline fallan; la app lo maneja).
- Como el Tracker ahora hidrata del store local, la foto SSR cacheada de `"/"` alcanza como shell.

## Sesión / auth offline
- Ops locales (leer store, marcar, encolar) **no requieren token**.
- `syncNow` asegura sesión antes de tocar la red (reusa `ensureAppSession`; ante rate-limit reintenta
  con backoff en el próximo trigger). Los datos locales nunca se pierden por fallo de auth.
- **Primer uso requiere internet** (sembrar hábitos + sesión). Si se abre offline sin store previo,
  el Tracker muestra un aviso "Conectate una vez para cargar tus hábitos".

## Manejo de errores
- Marca offline → queda en outbox; UI muestra "pendiente". Nunca se pierde.
- Flush con error de server → entry permanece; reintento en el próximo trigger; toast discreto.
- `ensureAppSession` falla al reconectar → no se sincroniza, se reintenta; store intacto.
- `localStorage` no disponible (modo privado) → la app degrada a "solo online" (sin persistencia),
  sin romperse.

## Testing
- **Unit (nuevo, con runner de tests — ver Nota):**
  - `reward.optimisticReward`: 50/150 diario, 250/750 semanal, +bonus del mazo; casos borde.
  - `outbox`: coalescing por `(habitId, logDate)`, LWW por `updatedAt`.
  - `store`: round-trip de snapshot/outbox; tolerancia a storage ausente.
  - `sync.syncNow`: con server action y Supabase mockeados — flush ok/err, no pisar pendientes, mutex.
- **E2E manual (Playwright, en verificación):** DevTools offline → marcar diario y semanal → recargar
  (persiste) → volver online → confirmar que el server recibió (saldo/logs) y el pendiente se limpió.
- **Nota:** el repo hoy no tiene runner de tests. El plan agrega uno mínimo (Vitest) para los unit
  de la lógica pura (`reward`, `outbox`, `store`, `sync`).

## Riesgos
- Divergencia optimista vs server (ej. bonus del mazo): mitigado porque el server reconcilia y su
  balance pisa al local en cada sync.
- Assets con hash de Next en el SW: usar runtime cache (no precache de rutas fijas frágiles).
- `force-dynamic` + SW cache de `"/"`: aceptable porque la UI hidrata del store local; el HTML SSR es
  solo un shell.
