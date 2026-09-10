import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Cliente de Supabase POR-REQUEST para Server Components y Server Actions.
// Con auth multiusuario (Paso 6) usamos @supabase/ssr: el cliente lee/escribe la
// sesión del usuario desde las cookies, de modo que la RLS filtra por auth.uid().
//
// Si faltan las variables de entorno devolvemos null y la app entra en "modo
// demo" (UI totalmente explorable, sin persistencia ni auth).
// -----------------------------------------------------------------------------

export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function getSupabase(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[Dojo Ledger] Supabase no configurado — corriendo en modo demo. " +
          "Completá .env.local para persistir datos.",
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
