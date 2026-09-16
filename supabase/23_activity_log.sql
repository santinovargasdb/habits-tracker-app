-- supabase/23_activity_log.sql
-- =============================================================================
-- Dojo Ledger — Paso 23: RPC read-only de actividad (heatmap + racha)
-- Ejecutar en: Supabase Dashboard → SQL Editor. Correr TODO el archivo.
-- Requiere: schema.sql (tabla logs) y habits. Es SOLO LECTURA (no toca saldo).
-- =============================================================================

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
-- VERIFICACIÓN (aparte, desde la app con sesión): debería devolver filas del último mes.
-- FIN Paso 23.
