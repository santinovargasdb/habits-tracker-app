-- =============================================================================
-- Dojo Ledger — Paso 9: Iconos oficiales de las cartas (image_url)
-- Migración ADITIVA e idempotente sobre los Pasos 1..8.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere haber corrido antes:  02_cards_deck.sql (tabla cards + seed)
--
-- Qué hace:
--   1. Añade la columna cards.image_url (URL del icono oficial de la carta).
--   2. Backfill de los 4 iconos del catálogo (assets servidos por la app en
--      /public/cards/*.svg). Reemplazá estas URLs por las de tus iconos
--      oficiales (Storage/CDN) cuando los subas.
--
-- Nota: `cards` es un catálogo GLOBAL de solo lectura; no lleva user_id.
-- =============================================================================

alter table public.cards
  add column if not exists image_url text;

update public.cards set image_url = '/cards/libro-de-viaje.svg'
  where id = 'aaaa1111-1111-1111-1111-111111111111';
update public.cards set image_url = '/cards/foco-en-la-ecuacion.svg'
  where id = 'bbbb2222-2222-2222-2222-222222222222';
update public.cards set image_url = '/cards/cinturon-naranja.svg'
  where id = 'cccc3333-3333-3333-3333-333333333333';
update public.cards set image_url = '/cards/voluntad-de-acero.svg'
  where id = 'dddd4444-4444-4444-4444-444444444444';
