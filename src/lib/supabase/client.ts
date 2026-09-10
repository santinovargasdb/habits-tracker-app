"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Cliente de Supabase para el navegador (componentes cliente: la página /login).
// Devuelve null si faltan las env vars (modo demo), para que la UI pueda avisar
// en lugar de romper.
// -----------------------------------------------------------------------------

export function createSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
