import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Cliente de Supabase para el servidor (Server Components + Server Actions).
// El MVP no tiene auth todavía: usamos la ANON KEY con RLS permisivo.
// Si las variables de entorno no están, devolvemos null y la app entra en
// "modo demo" (UI totalmente explorable, sin persistencia).
// -----------------------------------------------------------------------------

let cached: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[Dojo Ledger] Supabase no configurado — corriendo en modo demo. " +
          "Completá .env.local para persistir datos.",
      );
    }
    cached = null;
    return null;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
