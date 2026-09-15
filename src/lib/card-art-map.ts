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
