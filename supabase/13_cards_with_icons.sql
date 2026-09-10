-- =============================================================================
-- Dojo Ledger — Paso 13: Lootpool de 40 cartas de Clash Royale (con iconos)
-- Migración ADITIVA e idempotente sobre los Pasos 1..9.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere:     02_cards_deck.sql (tabla cards) y 09_card_images.sql (image_url)
--
-- Qué hace:
--   1. Reemplaza el catálogo de 4 cartas temáticas por 40 cartas de Clash Royale
--      balanceadas: 20 Comunes, 10 Especiales (Rare), 6 Épicas, 4 Legendarias
--      (incluyendo el Megacaballero / Mega Knight).
--   2. Cada carta trae su icono oficial (image_url → CDN de RoyaleAPI) y su
--      target_block + multiplier_percent balanceado por rareza.
--
-- Notas:
--   • Las nuevas cartas usan UUIDs fijos c0000000-…-0000000000NN (NN = 01..40).
--   • image_url apunta al CDN de RoyaleAPI; si una URL fallara/estuviera offline,
--     la UI cae al arte emoji de fallback (por rareza).
--   • Los usuarios nuevos reciben una copia de cada carta vía el trigger
--     handle_new_user() (que siembra select … from public.cards). El gacha sigue
--     siendo la vía para conseguir duplicados y subir de nivel.
-- =============================================================================

-- 1) Quitamos las 4 cartas temáticas del MVP (FKs: inventory→cascade, deck→set null).
delete from public.cards where id in (
  'aaaa1111-1111-1111-1111-111111111111',
  'bbbb2222-2222-2222-2222-222222222222',
  'cccc3333-3333-3333-3333-333333333333',
  'dddd4444-4444-4444-4444-444444444444'
);

-- 2) Lootpool de 40 cartas de Clash Royale.
insert into public.cards (id, name, rarity, target_block, multiplier_percent, description, image_url) values
  -- ---------------------------------------------------------------- 20 COMUNES
  ('c0000000-0000-4000-8000-000000000001', 'Caballero',           'Common', 'Tarde',     8,  '+8% de monedas en el bloque Tarde.',      'https://cdn.royaleapi.com/static/img/cards-150/knight.png'),
  ('c0000000-0000-4000-8000-000000000002', 'Arqueras',            'Common', 'Viaje',     6,  '+6% de monedas en el bloque Viaje.',      'https://cdn.royaleapi.com/static/img/cards-150/archers.png'),
  ('c0000000-0000-4000-8000-000000000003', 'Bombardero',          'Common', 'Noche',     6,  '+6% de monedas en el bloque Noche.',      'https://cdn.royaleapi.com/static/img/cards-150/bomber.png'),
  ('c0000000-0000-4000-8000-000000000004', 'Esqueletos',          'Common', 'Madrugada', 5,  '+5% de monedas en el bloque Madrugada.',  'https://cdn.royaleapi.com/static/img/cards-150/skeletons.png'),
  ('c0000000-0000-4000-8000-000000000005', 'Súbditos',            'Common', 'Viaje',     6,  '+6% de monedas en el bloque Viaje.',      'https://cdn.royaleapi.com/static/img/cards-150/minions.png'),
  ('c0000000-0000-4000-8000-000000000006', 'Bárbaros',            'Common', 'Tarde',     8,  '+8% de monedas en el bloque Tarde.',      'https://cdn.royaleapi.com/static/img/cards-150/barbarians.png'),
  ('c0000000-0000-4000-8000-000000000007', 'Goblins con Lanza',   'Common', 'Viaje',     5,  '+5% de monedas en el bloque Viaje.',      'https://cdn.royaleapi.com/static/img/cards-150/spear-goblins.png'),
  ('c0000000-0000-4000-8000-000000000008', 'Goblins',             'Common', 'Tarde',     6,  '+6% de monedas en el bloque Tarde.',      'https://cdn.royaleapi.com/static/img/cards-150/goblins.png'),
  ('c0000000-0000-4000-8000-000000000009', 'Horda de Súbditos',   'Common', 'Noche',     7,  '+7% de monedas en el bloque Noche.',      'https://cdn.royaleapi.com/static/img/cards-150/minion-horde.png'),
  ('c0000000-0000-4000-8000-00000000000a', 'Flechas',             'Common', null,        5,  '+5% de monedas en todos los bloques.',    'https://cdn.royaleapi.com/static/img/cards-150/arrows.png'),
  ('c0000000-0000-4000-8000-00000000000b', 'Cañón',               'Common', 'Madrugada', 6,  '+6% de monedas en el bloque Madrugada.',  'https://cdn.royaleapi.com/static/img/cards-150/cannon.png'),
  ('c0000000-0000-4000-8000-00000000000c', 'Mortero',             'Common', 'Noche',     7,  '+7% de monedas en el bloque Noche.',      'https://cdn.royaleapi.com/static/img/cards-150/mortar.png'),
  ('c0000000-0000-4000-8000-00000000000d', 'Gigante Real',        'Common', 'Tarde',     9,  '+9% de monedas en el bloque Tarde.',      'https://cdn.royaleapi.com/static/img/cards-150/royal-giant.png'),
  ('c0000000-0000-4000-8000-00000000000e', 'Petardera',           'Common', 'Viaje',     7,  '+7% de monedas en el bloque Viaje.',      'https://cdn.royaleapi.com/static/img/cards-150/firecracker.png'),
  ('c0000000-0000-4000-8000-00000000000f', 'Bárbaros de Élite',   'Common', 'Tarde',     10, '+10% de monedas en el bloque Tarde.',     'https://cdn.royaleapi.com/static/img/cards-150/elite-barbarians.png'),
  ('c0000000-0000-4000-8000-000000000010', 'Reclutas Reales',     'Common', 'Madrugada', 8,  '+8% de monedas en el bloque Madrugada.',  'https://cdn.royaleapi.com/static/img/cards-150/royal-recruits.png'),
  ('c0000000-0000-4000-8000-000000000011', 'Murciélagos',         'Common', 'Noche',     5,  '+5% de monedas en el bloque Noche.',      'https://cdn.royaleapi.com/static/img/cards-150/bats.png'),
  ('c0000000-0000-4000-8000-000000000012', 'Descarga',            'Common', null,        5,  '+5% de monedas en todos los bloques.',    'https://cdn.royaleapi.com/static/img/cards-150/zap.png'),
  ('c0000000-0000-4000-8000-000000000013', 'Espíritu de Hielo',   'Common', 'Madrugada', 6,  '+6% de monedas en el bloque Madrugada.',  'https://cdn.royaleapi.com/static/img/cards-150/ice-spirit.png'),
  ('c0000000-0000-4000-8000-000000000014', 'Barril de Esqueletos','Common', 'Noche',     7,  '+7% de monedas en el bloque Noche.',      'https://cdn.royaleapi.com/static/img/cards-150/skeleton-barrel.png'),
  -- ------------------------------------------------------------- 10 ESPECIALES
  ('c0000000-0000-4000-8000-000000000015', 'Gigante',             'Rare',   'Madrugada', 15, '+15% de monedas en el bloque Madrugada.', 'https://cdn.royaleapi.com/static/img/cards-150/giant.png'),
  ('c0000000-0000-4000-8000-000000000016', 'Mosquetera',          'Rare',   'Viaje',     14, '+14% de monedas en el bloque Viaje.',     'https://cdn.royaleapi.com/static/img/cards-150/musketeer.png'),
  ('c0000000-0000-4000-8000-000000000017', 'Mini P.E.K.K.A',      'Rare',   'Tarde',     15, '+15% de monedas en el bloque Tarde.',     'https://cdn.royaleapi.com/static/img/cards-150/mini-pekka.png'),
  ('c0000000-0000-4000-8000-000000000018', 'Valquiria',           'Rare',   'Tarde',     14, '+14% de monedas en el bloque Tarde.',     'https://cdn.royaleapi.com/static/img/cards-150/valkyrie.png'),
  ('c0000000-0000-4000-8000-000000000019', 'Montapuercos',        'Rare',   'Madrugada', 16, '+16% de monedas en el bloque Madrugada.', 'https://cdn.royaleapi.com/static/img/cards-150/hog-rider.png'),
  ('c0000000-0000-4000-8000-00000000001a', 'Mago',                'Rare',   'Noche',     15, '+15% de monedas en el bloque Noche.',     'https://cdn.royaleapi.com/static/img/cards-150/wizard.png'),
  ('c0000000-0000-4000-8000-00000000001b', 'Bola de Fuego',       'Rare',   null,        13, '+13% de monedas en todos los bloques.',   'https://cdn.royaleapi.com/static/img/cards-150/fireball.png'),
  ('c0000000-0000-4000-8000-00000000001c', 'Ariete de Batalla',   'Rare',   'Viaje',     14, '+14% de monedas en el bloque Viaje.',     'https://cdn.royaleapi.com/static/img/cards-150/battle-ram.png'),
  ('c0000000-0000-4000-8000-00000000001d', 'Tres Mosqueteras',    'Rare',   'Viaje',     18, '+18% de monedas en el bloque Viaje.',     'https://cdn.royaleapi.com/static/img/cards-150/three-musketeers.png'),
  ('c0000000-0000-4000-8000-00000000001e', 'Cohete',              'Rare',   null,        13, '+13% de monedas en todos los bloques.',   'https://cdn.royaleapi.com/static/img/cards-150/rocket.png'),
  -- ----------------------------------------------------------------- 6 ÉPICAS
  ('c0000000-0000-4000-8000-00000000001f', 'P.E.K.K.A',           'Epic',   'Tarde',     25, '+25% de monedas en el bloque Tarde.',     'https://cdn.royaleapi.com/static/img/cards-150/pekka.png'),
  ('c0000000-0000-4000-8000-000000000020', 'Príncipe',            'Epic',   'Madrugada', 22, '+22% de monedas en el bloque Madrugada.', 'https://cdn.royaleapi.com/static/img/cards-150/prince.png'),
  ('c0000000-0000-4000-8000-000000000021', 'Dragón Bebé',         'Epic',   'Viaje',     20, '+20% de monedas en el bloque Viaje.',     'https://cdn.royaleapi.com/static/img/cards-150/baby-dragon.png'),
  ('c0000000-0000-4000-8000-000000000022', 'Bruja',               'Epic',   'Noche',     22, '+22% de monedas en el bloque Noche.',     'https://cdn.royaleapi.com/static/img/cards-150/witch.png'),
  ('c0000000-0000-4000-8000-000000000023', 'Gólem',               'Epic',   'Madrugada', 24, '+24% de monedas en el bloque Madrugada.', 'https://cdn.royaleapi.com/static/img/cards-150/golem.png'),
  ('c0000000-0000-4000-8000-000000000024', 'Globo',               'Epic',   'Noche',     26, '+26% de monedas en el bloque Noche.',     'https://cdn.royaleapi.com/static/img/cards-150/balloon.png'),
  -- ------------------------------------------------------------- 4 LEGENDARIAS
  ('c0000000-0000-4000-8000-000000000025', 'Megacaballero',       'Legendary', 'Tarde',     40, '+40% de monedas en el bloque Tarde. El rey del lootpool.', 'https://cdn.royaleapi.com/static/img/cards-150/mega-knight.png'),
  ('c0000000-0000-4000-8000-000000000026', 'Chispitas',           'Legendary', 'Noche',     34, '+34% de monedas en el bloque Noche.',     'https://cdn.royaleapi.com/static/img/cards-150/sparky.png'),
  ('c0000000-0000-4000-8000-000000000027', 'Mago Eléctrico',      'Legendary', 'Viaje',     32, '+32% de monedas en el bloque Viaje.',     'https://cdn.royaleapi.com/static/img/cards-150/electro-wizard.png'),
  ('c0000000-0000-4000-8000-000000000028', 'Princesa',            'Legendary', 'Madrugada', 30, '+30% de monedas en el bloque Madrugada.', 'https://cdn.royaleapi.com/static/img/cards-150/princess.png')
on conflict (id) do update
  set name               = excluded.name,
      rarity             = excluded.rarity,
      target_block       = excluded.target_block,
      multiplier_percent = excluded.multiplier_percent,
      description        = excluded.description,
      image_url          = excluded.image_url;
