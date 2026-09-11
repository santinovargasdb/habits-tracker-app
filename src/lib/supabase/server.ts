import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Cliente de Supabase POR-REQUEST para Server Components y Server Actions.
// Con auth multiusuario (Paso 6) usamos @supabase/ssr: el cliente lee/escribe la
// sesión del usuario desde las cookies, de modo que la RLS filtra por auth.uid().
//
// En producción las env vars siempre están presentes. `getSupabase()` devuelve
// null sólo si faltan (p. ej. un build local sin configurar); las rutas de datos
// usan `getSupabaseOrThrow()` para fallar de forma explícita en ese caso.
// -----------------------------------------------------------------------------

// Supabase renombró "anon key" → "publishable key". Aceptamos ambos nombres.
function supabaseKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function isSupabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!supabaseKey();
}

export async function getSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = supabaseKey();

  if (!url || !key) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[Dojo Ledger] Supabase no configurado: faltan NEXT_PUBLIC_SUPABASE_URL / " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY. Completá .env.local para operar contra la DB.",
      );
    }
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Invocado desde un Server Component, que no puede escribir cookies.
          // El refresh de la sesión lo hace el proxy (proxy.ts), así que acá
          // podemos ignorarlo de forma segura.
        }
      },
    },
  });
}

/**
 * Igual que getSupabase() pero exige que Supabase esté configurado: lanza un
 * error explícito si faltan las env vars. Lo usan los Server Actions y las
 * rutas de datos (en producción siempre hay backend; ya no hay modo demo).
 */
export async function getSupabaseOrThrow(): Promise<SupabaseClient> {
  const supabase = await getSupabase();
  if (!supabase) {
    throw new Error(
      "Supabase no está configurado: faltan las variables de entorno " +
        "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}
