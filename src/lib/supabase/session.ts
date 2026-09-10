import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// -----------------------------------------------------------------------------
// Helper usado por el Proxy (proxy.ts) en cada request:
//   1. Refresca la sesión de Supabase (getUser) y re-emite las cookies.
//   2. Redirige a /login a quien no esté autenticado (chequeo optimista de UX;
//      la seguridad REAL la impone la RLS en la base + auth.uid() en los RPCs).
//   3. Si ya hay sesión y estás en /login, te manda al inicio.
//
// Sin env vars (build local sin configurar) el proxy es un no-op; en producción
// las variables siempre están presentes.
// -----------------------------------------------------------------------------

function isPublicPath(path: string): boolean {
  // /login y todo lo que cuelga de /auth (callback de confirmación de email).
  return path === "/login" || path.startsWith("/auth");
}

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // No autenticado en ruta privada → a /login.
  if (!user && !isPublicPath(path)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    const redirect = NextResponse.redirect(redirectUrl);
    for (const c of supabaseResponse.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }

  // Autenticado pero en /login → al inicio.
  if (user && path === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    const redirect = NextResponse.redirect(redirectUrl);
    for (const c of supabaseResponse.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }

  return supabaseResponse;
}
