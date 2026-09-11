"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Cliente de Supabase para el navegador (componentes cliente: la página /login).
// Devuelve null sólo si faltan las env vars (p. ej. un build local sin
// configurar); en producción siempre están presentes.
// -----------------------------------------------------------------------------

export function createSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Supabase renombró "anon key" → "publishable key". Aceptamos ambos nombres.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
