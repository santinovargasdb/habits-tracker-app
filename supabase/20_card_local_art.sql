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
