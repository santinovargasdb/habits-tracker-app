"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabase, getSupabaseOrThrow } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  message?: string;
}

/**
 * Auto-login single-user: si no hay sesión, inicia sesión con la cuenta
 * dedicada de la app (credenciales en env, sólo servidor). Así no hay pantalla
 * de login. No hace nada si ya hay sesión o si faltan las env vars.
 */
export async function ensureAppSession(): Promise<{ ok: boolean }> {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return { ok: true }; // ya hay sesión

  const email = process.env.APP_AUTH_EMAIL;
  const password = process.env.APP_AUTH_PASSWORD;
  if (!email || !password) return { ok: false };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("[ensureAppSession] login error:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

// Traducción amable de los errores más comunes de Supabase Auth.
function translate(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "Email o contraseña incorrectos.";
  if (/email not confirmed/i.test(msg)) return "Tenés que confirmar tu email antes de entrar.";
  if (/user already registered/i.test(msg)) return "Ya existe una cuenta con ese email.";
  if (/password should be at least/i.test(msg)) return "La contraseña es demasiado corta.";
  return msg;
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "";
}

function parseCredentials(formData: FormData): { email: string; password: string } {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export async function login(
  _prev: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = parseCredentials(formData);
  if (!email || !password) return { error: "Ingresá tu email y contraseña." };

  const supabase = await getSupabaseOrThrow();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: translate(error.message) };

  redirect("/");
}

export async function signup(
  _prev: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = parseCredentials(formData);
  if (!email || !password) return { error: "Ingresá tu email y contraseña." };
  if (password.length < 6) {
    return { error: "La contraseña debe tener al menos 6 caracteres." };
  }

  const supabase = await getSupabaseOrThrow();

  const origin = await siteOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) return { error: translate(error.message) };

  // Con "Confirm email" activado no hay sesión hasta confirmar.
  if (data.session) redirect("/");

  return {
    message:
      "¡Listo! Te enviamos un email para confirmar tu cuenta. Revisá tu bandeja (y el spam) y volvé a iniciar sesión.",
  };
}

export async function logout(): Promise<void> {
  const supabase = await getSupabase();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}
