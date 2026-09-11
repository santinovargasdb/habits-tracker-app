-- =============================================================================
-- Dojo Ledger — Paso 14: Mazo activo por `is_equipped` en user_inventory
-- Migración ADITIVA e idempotente.
-- -----------------------------------------------------------------------------
-- Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
-- Requiere:     02_cards_deck.sql (tabla user_inventory)
--
-- Qué hace:
--   1. Agrega la columna booleana user_inventory.is_equipped (default false).
--   2. Índice parcial para contar/consultar rápido las cartas equipadas.
--
-- El tope de 4 cartas equipadas lo impone el Server Action toggleEquipCard
-- (src/actions/deck.ts). Si querés una restricción DURA a nivel DB (recomendado
-- para producción), al final hay un trigger opcional comentado.
-- =============================================================================

alter table public.user_inventory
  add column if not exists is_equipped boolean not null default false;

create index if not exists user_inventory_equipped_idx
  on public.user_inventory (user_id)
  where is_equipped;

-- -----------------------------------------------------------------------------
-- (Opcional) Restricción DURA a nivel DB: no permitir más de 4 equipadas por
-- usuario. Descomentá si querés que la base rechace una 5ta equipada aunque el
-- cliente/acción fallen. Es la garantía atómica más fuerte.
-- -----------------------------------------------------------------------------
-- create or replace function public.enforce_max_equipped()
-- returns trigger
-- language plpgsql
-- as $$
-- begin
--   if new.is_equipped and (
--     select count(*) from public.user_inventory
--     where user_id = new.user_id and is_equipped and id <> new.id
--   ) >= 4 then
--     raise exception 'No se pueden equipar más de 4 cartas';
--   end if;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists trg_max_equipped on public.user_inventory;
-- create trigger trg_max_equipped
--   before insert or update of is_equipped on public.user_inventory
--   for each row execute function public.enforce_max_equipped();
