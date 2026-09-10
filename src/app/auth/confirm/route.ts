import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/server";

// -----------------------------------------------------------------------------
// Route handler para el link de confirmación de email de Supabase.
// Requiere que la plantilla de email apunte a:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
// Verifica el token (verifyOtp) → deja la sesión en cookies → redirige.
// -----------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (token_hash && type) {
    const supabase = await getSupabase();
    if (supabase) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash });
      if (!error) {
        return NextResponse.redirect(new URL(next, request.url));
      }
    }
  }

  return NextResponse.redirect(
    new URL("/login?error=confirmacion", request.url),
  );
}
