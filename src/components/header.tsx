"use client";

import { useEffect, useRef, useState } from "react";
import { Coins, LogOut } from "lucide-react";
import { useWallet } from "@/lib/wallet-context";
import { useCountUp } from "@/lib/use-count-up";
import { logout } from "@/actions/auth";
import { cn } from "@/lib/utils";

export default function Header({ userEmail }: { userEmail?: string | null }) {
  const { balance } = useWallet();
  const display = useCountUp(balance);

  // Pulso dorado del chip cada vez que cambia el balance.
  const [pulse, setPulse] = useState(false);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 500);
    return () => clearTimeout(t);
  }, [balance]);

  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-ink/72 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 w-full max-w-md items-center justify-between px-4">
        {/* Marca */}
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-gold to-gold-deep text-ink shadow-[0_6px_18px_-6px_rgba(246,196,69,0.7)]"
            aria-hidden
          >
            <span className="font-display text-lg font-extrabold leading-none">
              道
            </span>
          </span>
          <div className="leading-none">
            <p className="font-display text-[15px] font-extrabold tracking-tight text-fg">
              DOJO<span className="text-gold"> LEDGER</span>
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Hábitos
            </p>
          </div>
        </div>

        {/* Billetera + sesión */}
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border border-gold/25 bg-gold/10 py-1.5 pl-2.5 pr-3.5",
              "shadow-[0_0_0_1px_rgba(246,196,69,0.06),0_8px_24px_-12px_rgba(246,196,69,0.5)]",
              pulse && "animate-pulse-gold",
            )}
            aria-live="polite"
            aria-label={`Balance: ${balance} monedas`}
          >
            <Coins className="h-4 w-4 text-gold" strokeWidth={2.5} />
            <span className="font-mono text-base font-bold tabular-nums text-gold">
              {display.toLocaleString("es-AR")}
            </span>
          </div>

          {userEmail && (
            <form action={logout}>
              <button
                type="submit"
                title={`Cerrar sesión — ${userEmail}`}
                aria-label={`Cerrar sesión de ${userEmail}`}
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted transition hover:border-danger/40 hover:text-danger active:scale-95"
              >
                <LogOut className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
