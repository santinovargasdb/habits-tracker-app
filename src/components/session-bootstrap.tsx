"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ensureAppSession } from "@/actions/auth";

// -----------------------------------------------------------------------------
// Auto-login single-user (sin pantalla de login). Al montar, si no hay sesión
// en el navegador, pide al servidor iniciar sesión con la cuenta dedicada
// (credenciales en env) y refresca para que los Server Components vean la sesión.
// Falla en silencio (la app simplemente queda sin datos) si algo no está listo.
// -----------------------------------------------------------------------------
export function SessionBootstrap() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return; // ya hay sesión: nada que hacer
      const res = await ensureAppSession();
      if (res.ok) router.refresh(); // re-render con la sesión ya activa
    })();
  }, [router]);

  return null;
}
