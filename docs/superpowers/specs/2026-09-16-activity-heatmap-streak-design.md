# Heatmap de días activos + racha — Diseño

**Fecha:** 2026-09-16
**Estado:** aprobado (pendiente de escribir el plan de implementación)

## Objetivo

Que el usuario vea, arriba del Tracker, su **racha de días consecutivos** y un **heatmap de días activos**. Al tocar, se abre una **hoja** (sheet) que ocupa buena parte de la pantalla con **5 heatmaps** — uno general (agregado) y uno por cada etapa horaria con el **detalle tarea × día** — más un bloque de **texto** con la info de racha y la "tarea estrella de la semana".

Es una feature **de solo visualización**: read-only, no toca la economía de monedas ni ningún RPC de saldo. Cero riesgo de farmeo.

## Contexto y estado actual

- Los datos ya existen en `public.logs`: un registro por `(habit_id, date)` con `status` (`NONE` / `MET` / `SURPASSED`), constraint único `(habit_id, date)` e índice por `date`. `logs` no tiene `user_id`; se llega al usuario vía `habit_id → habits.user_id`.
- Hábitos **semanales**: su log se ancla al **lunes** de la semana (una fila por semana). Cuentan como actividad de ese lunes.
- La app tiene 4 tabs (`tracker`, `mazo`, `mercado`, `finanzas`); esta feature vive **arriba de `TrackerView`**.
- Las 4 etapas horarias están en `TIME_BLOCK_META` (`src/lib/constants.ts`): **🌅 Madrugada · 🚄 Viaje · 🥋 Tarde · 🌙 Noche**, cada una con label/ícono/acento. El tipo `TimeBlock` = esas 4. Existe `normalizeTimeBlock` para mapear los valores de la DB (que en prod pueden venir en inglés/otras variantes) a esas 4.
- `TrackerView` ya carga la **lista de hábitos** del usuario (id, nombre, `time_block`), así que el desglose por tarea no necesita traer los nombres del RPC.
- No existe hoy ninguna lógica de racha/heatmap (grep sin resultados).

## Decisiones tomadas (con el usuario)

- **Alcance:** solo visualización (read-only). Sin recompensa por racha por ahora.
- **Ubicación:** barra compacta arriba del Tracker; al tocar abre una hoja de ~½–¾ de pantalla, scrollable.
- **5 heatmaps:** 1 **general** (tira agregada de 30 días, **sin** desglose de tareas) + 4 **por etapa** con grid **tarea × día**.
- **Ventanas:** el heatmap general usa **30 días**; los grids por tarea usan la **semana en curso (lunes→domingo)**, columnas L–D (los días futuros quedan vacíos). Se elige la semana —y no 30 días— para que entre en mobile y para que calce con "esta semana" de la tarea estrella.
- **Racha:** **global** (no por etapa). **Mejor racha = mejor de los últimos 30 días** ("del mes"), para mantener **una sola** migración. La "mejor de toda la historia" se puede sumar después barato.
- **Fecha local:** toda la lógica de racha/ventanas se calcula con la **fecha local del navegador** (no UTC del server), para evitar bugs de timezone en el límite del día.

## Diseño

### Interacción y UI

**Colapsado (arriba del Tracker) — `activity-bar.tsx`:**
- 🔥 Racha actual · mejor · y la **tira global de 30 días** (agregada).
- Afordancia de apertura (chevron / "ver detalle"). Al tocar abre la hoja.

**Hoja (sheet) — `activity-sheet.tsx`:**
- Portal (mismo patrón que `chest-reveal-modal.tsx`), sube desde abajo, ~½–¾ de alto, **scrollable**, con backdrop y botón de cierre (✕ / tap en backdrop / Escape).
- Contenido, en orden:
  1. **GENERAL (30 días):** la tira agregada por intensidad, sin lista de tareas.
  2. **Una sección por etapa** (Madrugada, Viaje, Tarde, Noche), cada una con su ícono/color y un **grid tarea × día de la semana en curso (L→D)**: filas = las tareas de ese bloque, columnas = lunes→domingo (días futuros vacíos), celda `x` = hecha / `o` = no.
  3. **Info de racha (texto):** racha actual, mejor (30 d), días activos del mes, y "⭐ Tu tarea estrella de la semana: «X» (n/7)".

Bosquejo:

```
────────  Tu actividad  ───────  ✕
GENERAL (últimos 30 días)
·▒▓·░▒▓█·▒░▓▒·█▓░▒·▓▒█·░▓▒·▓█

🥋 TARDE                 L M X J V S D
  Meditar                x x x o o x ·
  Entrenar               x o o x o x ·
  Leer                   o o o x o o ·

🚄 VIAJE / 🌅 MADRUGADA / 🌙 NOCHE   (mismos grids)
──────────────────────────────────
🔥 Racha actual: 4 días · mejor (30d): 12
📊 12 días activos (últimos 30)
⭐ Tarea estrella de la semana: «Entrenar» (6 días)
```

### Definiciones

- **Día activo:** existe ≥1 log del usuario con `status ∈ {MET, SURPASSED}` en esa fecha.
- **Intensidad** de la celda general (`· ░ ▒ ▓ █`): cantidad de tareas completadas ese día, en 5 niveles → `0, 1, 2, 3, 4+`.
- **Racha actual:** días consecutivos activos terminando **hoy** (fecha local). *Gracia del día en curso:* si hoy aún no hay actividad pero ayer sí, la racha muestra la corrida hasta **ayer** (no se rompe hasta que pase un día entero sin actividad).
- **Mejor racha (30 d):** corrida consecutiva más larga dentro de la ventana de 30 días.
- **Celda del grid por tarea:** `x` si esa tarea tuvo `MET`/`SURPASSED` ese día de la semana en curso; `o` si no; **vacío** para días futuros. (`SURPASSED` puede mostrarse distinto —ej. dorado— como mejora opcional; v1 puede ser binario.)
- **Tarea estrella de la semana:** la tarea con más completados en la **semana en curso** (empate → la primera por orden de la lista de hábitos).

### Datos — RPC read-only

Nueva migración `supabase/23_activity_log.sql` (Paso 23), aditiva:

```sql
create or replace function public.activity_log(p_from date)
returns table (habit_id uuid, log_date date, status text)
language sql security definer set search_path = public stable as $$
  select l.habit_id, l.date, l.status::text
  from public.logs l
  join public.habits h on h.id = l.habit_id
  where h.user_id = auth.uid()
    and l.date >= p_from
    and l.status in ('MET', 'SURPASSED');
$$;

grant execute on function public.activity_log(date) to authenticated;
revoke execute on function public.activity_log(date) from anon;
```

- El cliente llama con `p_from = hoy_local − 29` (cubre el heatmap general de 30 días y, como subconjunto, los grids de 7 días).
- Payload chico (solo días hechos): ~tareas × días activos en 30 días.
- La **lista de tareas por bloque** la aporta el cliente (la que ya tiene el Tracker); el RPC solo dice qué `(habit_id, fecha)` se completaron.

### Componentes (chicos y aislados)

- `src/lib/activity.ts` — **funciones puras** (sin React), testeables:
  - `summarizeActivity(rows, habits, hoyLocal)` → `{ general: { niveles30: number[], rachaActual, mejorRacha, diasActivos }, etapas: Record<TimeBlock, { tareas: { id, nombre, semana: (boolean | null)[] }[] }>, tareaEstrella: { nombre, hechos: number } | null }`. `semana` = 7 celdas lun→dom de la semana en curso (`true` hecha, `false` no, `null` día futuro).
  - Helpers internos: `bucketNivel(count)`, `computeStreak(fechasActivas, hoyLocal)`, `mejorRachaEnVentana(fechasActivas)`.
- `src/actions/activity.ts` — wrapper del RPC (`fetchActivity(pFrom)`), mismo estilo que los otros actions.
- `src/components/day-strip.tsx` — `DayStrip`: dibuja una fila de N celdas dado `niveles: number[]` (lo usa el heatmap general).
- `src/components/task-grid.tsx` — `TaskGrid`: grid tarea × día (7, semana en curso) dado `tareas` y `semana`. Encabezado L→D; días futuros vacíos.
- `src/components/activity-sheet.tsx` — la hoja (portal) que compone general + 4 `TaskGrid` + info.
- `src/components/activity-bar.tsx` — barra colapsada (racha + `DayStrip` global) que abre la hoja.
- Montaje: `activity-bar.tsx` arriba en `src/components/tracker-view.tsx`.

## Modelo de datos

- **Sin columnas ni tablas nuevas.** Solo se **agrega** la función `activity_log(date)` (read-only). No se modifica `logs`, `habits`, `wallet` ni ninguna función de economía.

## Flujo de datos

1. Se abre el Tracker → `activity-bar` llama `fetchActivity(hoy_local − 29)` → filas `(habit_id, log_date, status)`.
2. `summarizeActivity(filas, habits, hoy_local)` (puro) arma el resumen general + por etapa + tarea estrella.
3. La barra muestra racha + tira global. Al tocar, la hoja muestra los 5 heatmaps + info, usando el mismo resumen ya calculado (no re-fetch).

## Testing

- `src/lib/activity.test.ts` (vitest, como `casino.test.ts`):
  - **Racha actual:** corrida terminando hoy; **gracia** (hoy sin actividad pero ayer sí → cuenta hasta ayer); corte por día faltante; historial vacío → 0.
  - **Mejor racha (30 d):** múltiples corridas, toma la más larga; empates.
  - **Intensidad:** `bucketNivel` mapea 0/1/2/3/4+ correctamente.
  - **Por etapa:** agrupa tareas por `time_block` normalizado; una tarea sin logs aparece con `semana` todo `false` (salvo días futuros `null`); hábito semanal aparece en su lunes.
  - **Tarea estrella:** elige la de más completados en la semana en curso; empate → primera; sin datos → `null`.
- Chequeo de que `fetchActivity` mapea bien la respuesta (shape).

## No-objetivos (YAGNI)

- **Sin recompensa por racha** ni ningún cambio en la economía/monedas.
- **Sin racha por etapa** (la racha es global; las etapas muestran grid + —vía la info— nada de racha propia). Se puede sumar después.
- **Sin "mejor racha de toda la historia"** (se usa la de 30 días). Ampliable con un agregado barato.
- **Sin tab nueva** en el bottom-nav; vive arriba del Tracker.
- No se distingue `SURPASSED` de `MET` en v1 salvo que sea trivial (mejora opcional de estilo).

## Riesgos

- **Paso manual en prod:** la migración 23 (RPC) hay que correrla en Supabase (como las cartas). Es read-only (un `select`), riesgo bajo.
- **Ventana de 30 días:** tanto la racha actual como la mejor se calculan dentro de la ventana traída (30 días). Una racha en curso mayor a 30 días se vería capada — improbable en v1; ampliable subiendo `p_from` o con un agregado all-time barato.
- **Timezone:** se mitiga calculando con la fecha local del navegador y pasando `p_from` derivado de ella. `logs.date` se grabó con `current_date` del server; puede haber casos borde en el límite del día, aceptables para v1.
- **Ancho en mobile:** los grids por tarea usan 7 días justamente para entrar; nombres de tarea largos se truncan.
- **Semanales:** aparecen como una `x` en su lunes; se documenta para que no confunda (no es "no la hiciste" el resto de la semana).
- **Prod ≠ repo:** `normalizeTimeBlock` ya cubre los valores de `time_block` de prod; si aparece un bloque fuera de las 4 etapas, va solo al agregado general (no se pierde), no genera una 5ª sección.
