import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// -----------------------------------------------------------------------------
// Helper usado por el Proxy (proxy.ts) en cada request: refresca la sesión de
// Supabase (getUser) y re-emite las cookies para mantenerla viva.
//
// App single-user con auto-login (ver SessionBootstrap + ensureAppSession): ya
// NO hay gate de /login; si no hay sesión, el cliente la crea sola con la cuenta
// dedicada. Sin env vars (build local) el proxy es un no-op.
// -----------------------------------------------------------------------------

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sin backend configurado: el proxy es un no-op.
  if (!url || !key) return supabaseResponse;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANTE: no metas lógica entre createServerClient y getUser().
  // Refresca/renueva la sesión (y sus cookies) si existe. Sin gate de login.
  await supabase.auth.getUser();

  return supabaseResponse;
}
