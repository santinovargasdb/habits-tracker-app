import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

// -----------------------------------------------------------------------------
// Proxy (Next.js 16: reemplaza a middleware.ts).  Corre en el runtime Node.js.
// Refresca la sesión de Supabase y protege las rutas privadas de la PWA.
// Ver la lógica en src/lib/supabase/session.ts.
// -----------------------------------------------------------------------------
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Corre en todas las rutas EXCEPTO:
     * - _next/static, _next/image (bundles y optimización de imágenes)
     * - favicon.ico, sw.js, manifest.webmanifest (PWA / metadata)
     * - archivos con extensión de imagen (íconos, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
