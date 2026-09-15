# Mazo de 8 cartas + arte real de las cartas — Diseño

**Fecha:** 2026-09-15
**Estado:** aprobado (a la espera del catálogo de prod para el plan)

## Objetivo

Que el mazo activo pueda **equipar hasta 8 cartas** (como una baraja de Clash Royale) y que esas cartas **de verdad** aumenten la recompensa de los hábitos. Además, que cada carta muestre su **arte real de Clash Royale**, servido **localmente** para que funcione offline.

## Contexto y estado actual

El sistema de cartas ya existe (cofres/gacha, niveles, inventario, mazo). Al explorar el código y la app desplegada encontramos dos problemas concretos:

1. **Dos sistemas de "equipado" desconectados.**
   - La UI (`src/components/deck-view.tsx` vía `src/lib/game-context.tsx` → `toggleEquipCard`) togglea el flag `user_inventory.is_equipped`, con tope `MAX_EQUIPPED = 4`.
   - Pero la recompensa que calcula el servidor (`set_habit_status` → `deck_multiplier_percent`, ver `supabase/02_cards_deck.sql` y `supabase/16_fix_prod_debt.sql`) suma las cartas de la tabla **`active_deck`** (8 slots `slot_1..slot_8`), que la UI **no** modifica.
   - **Consecuencia:** equipar/desequipar cartas en la UI actual **no cambia la recompensa**. El mazo es hoy prácticamente cosmético.

2. **Imágenes rotas.** En la app desplegada, `cards.image_url` apunta a URLs falsas tipo
   `https://api-assets.clashroyale.com/cards/300/FSDF89234jkdfhs89234_sdfksdfj89324.png`
   que devuelven error (no cargan; `naturalWidth = 0`). Se ve el fallback de emoji, no el arte real.

3. **Prod divergió del repo.** El catálogo de prod tiene sus propios nombres (p. ej. **"Duendes con Lanza"**, mientras el repo en `supabase/13_cards_with_icons.sql` lo llama "Goblins con Lanza") y sus propias URLs (rotas). El repo referencia el CDN de RoyaleAPI (`cdn.royaleapi.com/static/img/cards-150/<slug>.png`), que sí existe y del que podemos **descargar** el arte.

## Decisiones tomadas (con el usuario)

- **Imágenes:** se sirven **localmente** desde `/public/cards/` (descargadas del arte oficial). Funciona offline; no depende de ningún CDN externo. (Descartado: hotlink a CDN — se rompe offline y ante cambios del CDN, que es justo lo que pasó.)
- **Mazo:** se **arregla el bug** y se sube a **8**. Fuente de verdad única = **`is_equipped`**. Las 8 cartas equipadas suman su % a la recompensa, **incluyendo el bonus de nivel** (para coincidir con lo que muestra la carta).

## Diseño

### Parte A — Mazo de 8 con fuente de verdad única (`is_equipped`)

**Servidor (nueva migración `supabase/19_deck_equipped_multiplier.sql`, aditiva e idempotente):**

- Redefinir el multiplicador del mazo para que lea las cartas **equipadas del usuario**:
  suma sobre `user_inventory ui JOIN cards c ON c.id = ui.card_id` con `ui.is_equipped = true`
  y `(c.target_block IS NULL OR c.target_block = <bloque>)`, del **multiplicador efectivo**
  `c.multiplier_percent + GREATEST(ui.level - 1, 0) * 5` (constante `LEVEL_MULTIPLIER_STEP = 5`,
  espeja `effectiveMultiplier` de `src/lib/constants.ts` y el RPC `upgrade_card`).
  La función es **por usuario** (recibe el `user_id` o usa el dueño del hábito), no global.
- Conectar el `set_habit_status` que **efectivamente llama el frontend** (la firma
  `(uuid, date, text)` / `(uuid, date, habit_status)`) a esta nueva función, reemplazando el
  uso de `active_deck`. La forma exacta depende de la definición viva de la función en prod, que
  se obtiene al escribir el plan (ver "Insumos pendientes"). El delta de recompensa se sigue
  calculando igual (`nuevo_pago − logs.coins_awarded`), sólo cambia de dónde sale el multiplicador.
- (Opcional pero recomendado) **Trigger duro** en `user_inventory` que rechace una **9ª** carta
  equipada por usuario — garantía atómica además del chequeo en el Server Action.

**Cliente / Server Action:**

- `src/lib/constants.ts`: `MAX_EQUIPPED = 8` (era 4). `DECK_SIZE` ya es 8.
- `src/actions/deck.ts` (`toggleEquipCard`): el tope duro pasa de `MAX_EQUIPPED` (4) a **8** — como
  ya lee la constante, el cambio de la constante lo cubre; se agrega/ajusta el test.
- `src/lib/game-context.tsx`: `toggleEquip` ya usa `MAX_EQUIPPED`, queda en 8 automáticamente.
  Alinear el estimador del cliente `multiplierForBlock` para que lea las **equipadas**
  (`inventory.filter(is_equipped)`) en vez del array `deck`/`active_deck`, así el número que
  muestre la UI coincide con lo que paga el servidor.
- `src/components/deck-view.tsx`: la grilla de equipadas ya se dibuja con `maxEquipped`
  (`Array.from({ length: maxEquipped })`) y el contador ya es `x/maxEquipped` → pasan a 8 solos.
  Ajuste visual menor: la grilla `grid-cols-4` muestra 8 en 2 filas (aceptable) o se revisa el layout.

**`active_deck` / `set_deck_slot`:** quedan **en desuso** (no se borran para no romper migraciones ni
datos históricos). Dejan de alimentar la recompensa. `game-context` puede conservar `equip/unequip`
sin uso o marcarse como deprecados; no es objetivo de este trabajo eliminarlos.

### Parte B — Arte real de las cartas, local y offline

- Obtener el **catálogo real de prod** (`id`, `name`, `rarity`, `target_block`, `image_url`).
- Para cada carta, **mapear su nombre → el slug oficial** del arte de Clash Royale
  (assets `cards-150` de RoyaleAPI; el repo ya tiene la mayoría de estos slugs en
  `supabase/13_cards_with_icons.sql`). El mapeo nombre(ES)→slug(EN) se arma con el catálogo exacto.
- **Descargar** cada PNG a `public/cards/<slug>.png` (quedan versionados en el repo).
- En la migración 19, `UPDATE public.cards SET image_url = '/cards/<slug>.png'` para **todas** las
  cartas del catálogo (alinea prod y repo). Si prod usa además una columna `icon_url`
  (agregada en `supabase/15_align_prod.sql`), se documenta y se alinea a `image_url` (que es la que
  lee `GameCard`); no se cambia el componente.
- **Service worker** (`public/sw.js` o equivalente en `src/lib/offline/`): precachear / cachear en
  runtime `/cards/*.png` para que el arte cargue sin internet.
- `src/components/game-card.tsx`: **sin cambios** — ya renderiza `card.image_url` con fallback a
  emoji si la imagen falla.

## Modelo de datos

- Sin columnas nuevas. Se **reescriben valores** de `cards.image_url` y se **redefinen funciones**
  (`deck_multiplier_percent` y su uso en `set_habit_status`). Opcional: trigger de tope 8.
- `user_inventory.is_equipped` (ya existe, `supabase/14_inventory_is_equipped.sql`) pasa a ser la
  única fuente de verdad del mazo activo.

## Flujo de datos (después)

1. Usuario equipa/desequipa carta → `toggleEquipCard` (tope 8, escribe `is_equipped`).
2. Usuario marca hábito → `set_habit_status` → nuevo multiplicador = suma de equipadas (con nivel)
   que aplican al bloque → monedas acreditadas = `round(base × (100 + mult)/100)` menos lo ya pagado.
3. Cada carta renderiza `/cards/<slug>.png` (local), con fallback a emoji.

## Testing

- **SQL del multiplicador:** verificar que suma sólo las equipadas del usuario, respeta el filtro por
  bloque (incluye globales `target_block IS NULL`), y aplica el bonus de nivel. Caso: 8 equipadas,
  algunas de otro bloque, una global, niveles mixtos → total esperado.
- **Tope de 8:** `toggleEquipCard` rechaza la 9ª equipada (y, si se agrega, el trigger también).
- **Imágenes:** test/asset-check de que **todo** `cards.image_url` del catálogo apunta a un archivo
  existente en `public/cards/` (cero 404) y que el mapeo cubre las 4 rarezas.
- **Cliente:** `effectiveMultiplier` ya tiene tests; agregar que `multiplierForBlock` lea equipadas.
- **E2E:** equipar 8 cartas, marcar un hábito, verificar que las monedas suben por el % sumado; y que
  las cartas muestran arte real (no el emoji de fallback).

## Datos de producción (resueltos 2026-09-15)

Se consultó prod. Hallazgos que refinan el plan:

- **40 cartas**, todas con `target_block = NULL` (**globales**) → no hay filtrado por bloque; las 8
  equipadas siempre aplican. Reparto: 20 Common, 10 Rare, 6 Epic, 4 Legendary.
- **`multiplier_percent = 0` en TODAS las cartas.** El bonus vive en otra columna, `cards.multiplier`
  (numeric: **1.05 / 1.10 / 1.20 / 1.35** por rareza Common/Rare/Epic/Legendary). Además
  `set_habit_status` suma `multiplier_percent` (=0) → **el mazo hoy paga +0% siempre**.
  → El plan **puebla `multiplier_percent`** con enteros derivados de `multiplier`:
  `round((multiplier − 1) × 100)` = **Common 5, Rare 10, Epic 20, Legendary 35**. (El usuario puede
  ajustar estos números; son fieles a los valores que ya tenía prod.) El servidor pasa a sumar
  `effective_multiplier(multiplier_percent, nivel)` sobre las **equipadas**.
- **Arte en `icon_url` (roto), `image_url` = NULL.** El frontend lee `icon_url ?? image_url`
  (`src/app/page.tsx:93`, `src/actions/gacha.ts:131`), así que **`icon_url` tiene prioridad**. → La
  migración setea **ambas** columnas (`icon_url` **e** `image_url`) al path local `/cards/<slug>.png`.
- **Normalización rota en el cliente** (`src/app/page.tsx:86-91`): como PostgREST devuelve `multiplier`
  como **string**, el `typeof === "number"` da falso y cae a `multiplier_percent = 0` → todas muestran
  "+0%". Al poblar `multiplier_percent` (entero) el display queda correcto; igual se limpia esa
  normalización para que prefiera `multiplier_percent` y no dependa del tipo de `multiplier`.
- **`set_habit_status(uuid, date, text)`** es la función viva que llama el frontend. Suma el bonus
  inline desde `active_deck` (líneas con `join lateral (values (ad.slot_1)...)`). El plan **reescribe
  ese bloque** para sumar desde `user_inventory` equipado (misma comparación de bloque por texto), y de
  paso redefine `deck_multiplier_percent` para leer equipadas (higiene: que ninguna función residual
  pague desde `active_deck`). Reusa `public.effective_multiplier(multiplier_percent, level)` (ya existe
  en prod).

### Mapeo nombre → arte (slug RoyaleAPI `cards-150`)

40 cartas → slug oficial. Los marcados con «?» se verifican al descargar (404 → ajustar):

`Arqueras→archers`, `Bárbaros→barbarians`, `Bárbaros de Élite→elite-barbarians`, `Bombardero→bomber`,
`Caballero→knight`, `Cañón→cannon`, `Descarga→zap`, `Duendes con Dagas→goblins`,
`Duendes con Lanza→spear-goblins`, `Esbirros→minions`, `Espíritu de Fuego→fire-spirits (?)`,
`Espíritu de Hielo→ice-spirit`, `Espíritu Eléctrico→electro-spirit`, `Esqueletos→skeletons`,
`Flechas→arrows`, `Horda de Esbirros→minion-horde`, `Mortero→mortar`, `Rompemuros→wall-breakers`,
`Tesla→tesla`, `Torre de Bombas→bomb-tower`, `Bebé Dragón→baby-dragon`,
`Ejército de Esqueletos→skeleton-army`, `Espejo→mirror`, `Globo Bombástico→balloon`,
`Lanza Rocas→bowler`, `Príncipe→prince`, `Leñador→lumberjack`, `Mago Eléctrico→electro-wizard`,
`Megacaballero→mega-knight`, `Princesa→princess`, `Ariete de Batalla→battle-ram`,
`Bola de Fuego→fireball`, `Choque de Duendes→goblin-gang (?)`, `Gigante→giant`, `Lápida→tombstone`,
`Mago→wizard`, `Mini P.E.K.K.A→mini-pekka`, `Mosquetera→musketeer`, `Torre Inferno→inferno-tower`,
`Valquiria→valkyrie`.

## No-objetivos (YAGNI)

- No se elimina `active_deck` / `set_deck_slot` ni se migran datos históricos.
- No se rediseña la UI del mazo más allá de soportar 8 slots.
- No se agregan cartas nuevas ni se toca el gacha. (Sí se **puebla** `multiplier_percent` con los
  valores derivados de `multiplier` — es lo que hace que el mazo pague; no es un rebalanceo nuevo.)
- No se cambia el `GameCard` ni el sistema de niveles/mejoras.

## Riesgos

- **Prod ≠ repo:** el catálogo de prod manda para el `UPDATE` de imágenes; el repo se alinea. Hay que
  usar los datos vivos, no asumir las 40 cartas del repo.
- **Recompensa duplicada:** debe quedar **una** ruta de multiplicador (equipadas). Verificar que
  ninguna función residual siga leyendo `active_deck` para pagar.
- **Peso del repo:** ~40 PNGs `cards-150` (chicos) — aceptable.
- **Licencia/arte:** uso del arte oficial de Clash Royale en un proyecto personal/educativo.
