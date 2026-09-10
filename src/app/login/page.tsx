"use client";

import { useActionState, useState } from "react";
import { login, signup, type AuthState } from "@/actions/auth";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

const inputClass =
  "w-full rounded-xl border border-line bg-ink-2 px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-muted/60 focus:border-gold/60 focus:ring-2 focus:ring-gold/20";
const labelClass =
  "block font-mono text-[10px] uppercase tracking-[0.22em] text-muted";

function AuthForm({ mode }: { mode: Mode }) {
  const action = mode === "login" ? login : signup;
  const [state, formAction, pending] = useActionState<
    AuthState | undefined,
    FormData
  >(action, undefined);

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="vos@ejemplo.com"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className={labelClass}>
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder="••••••••"
          className={inputClass}
        />
      </div>

      {state?.error && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {state.error}
        </p>
      )}
      {state?.message && (
        <p className="rounded-lg border border-met/30 bg-met/10 px-3 py-2 text-xs text-met">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-gold to-gold-deep px-4 py-2.5 font-display text-sm font-extrabold text-ink transition",
          "shadow-[0_10px_30px_-10px_rgba(246,196,69,0.7)] hover:brightness-105 active:scale-[0.99]",
          pending && "cursor-not-allowed opacity-60",
        )}
      >
        {pending
          ? "Procesando…"
          : mode === "login"
            ? "Entrar"
            : "Crear cuenta"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");

  return (
    <div className="relative z-10 flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm animate-rise">
        {/* Marca */}
        <div className="flex flex-col items-center text-center">
          <span
            className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-gold to-gold-deep text-ink shadow-[0_10px_30px_-8px_rgba(246,196,69,0.7)]"
            aria-hidden
          >
            <span className="font-display text-2xl font-extrabold leading-none">
              道
            </span>
          </span>
          <h1 className="mt-4 font-display text-xl font-extrabold tracking-tight text-fg">
            DOJO<span className="text-gold"> LEDGER</span>
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {mode === "login" ? "Iniciá sesión" : "Creá tu cuenta"}
          </p>
        </div>

        {/* Card */}
        <div className="mt-7 rounded-2xl border border-line bg-surface/80 p-5 backdrop-blur-xl">
          {/* Toggle login / signup */}
          <div
            className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-ink-2 p-1"
            role="tablist"
          >
            {(["login", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-lg px-3 py-2 font-display text-xs font-bold transition",
                  mode === m
                    ? "bg-gradient-to-br from-gold to-gold-deep text-ink"
                    : "text-muted hover:text-fg",
                )}
              >
                {m === "login" ? "Entrar" : "Crear cuenta"}
              </button>
            ))}
          </div>

          {/* key={mode}: remonta el form al cambiar de modo (resetea estado/errores). */}
          <AuthForm key={mode} mode={mode} />
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted">
          Trackeá tus hábitos, ganá monedas y subí de nivel tu mazo. Tu progreso
          queda guardado en tu cuenta.
        </p>
      </div>
    </div>
  );
}
