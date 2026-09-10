-- =============================================================================
-- Dojo Ledger — Seed data (hábitos base reales para testear la UI)
-- Ejecutar DESPUÉS de schema.sql.  Es idempotente (se puede correr varias veces).
-- =============================================================================

-- Billetera única en 0.
insert into public.wallet (balance) values (0)
on conflict (singleton) do nothing;

-- Hábitos base.  Usamos UUIDs fijos para que coincidan con el fallback demo
-- del frontend (src/lib/constants.ts).
insert into public.habits (id, name, time_block, sort_order) values
  ('11111111-1111-1111-1111-111111111111', 'Despertar 5:30 AM',              'Madrugada', 1),
  ('22222222-2222-2222-2222-222222222222', 'Trabajo (Mañana)',               'Madrugada', 2),
  ('33333333-3333-3333-3333-333333333333', 'Lectura en el tren',             'Viaje',     3),
  ('44444444-4444-4444-4444-444444444444', 'Repaso de Kanjis',               'Viaje',     4),
  ('55555555-5555-5555-5555-555555555555', 'Entrenar MMA (15:30 - 17:00)',   'Tarde',     5),
  ('66666666-6666-6666-6666-666666666666', 'Preparación Álgebra/Entropía',   'Tarde',     6),
  ('77777777-7777-7777-7777-777777777777', 'Colegio secundario',             'Noche',     7),
  ('88888888-8888-8888-8888-888888888888', 'Cierre a las 22:00',             'Noche',     8)
on conflict (id) do update
  set name       = excluded.name,
      time_block = excluded.time_block,
      sort_order = excluded.sort_order;
