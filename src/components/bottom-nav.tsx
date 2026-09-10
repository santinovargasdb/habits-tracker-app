"use client";

import { Landmark, ListChecks, Store, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

export type AppTab = "tracker" | "mazo" | "mercado" | "finanzas";

const TABS: { id: AppTab; label: string; Icon: typeof ListChecks }[] = [
  { id: "tracker", label: "Tracker", Icon: ListChecks },
  { id: "mazo", label: "Mazo", Icon: Swords },
  { id: "mercado", label: "Mercado", Icon: Store },
  { id: "finanzas", label: "Finanzas", Icon: Landmark },
];

export function BottomNav({
  tab,
  onChange,
}: {
  tab: AppTab;
  onChange: (t: AppTab) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-ink/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex w-full max-w-md items-stretch px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex flex-1 flex-col items-center gap-1 rounded-xl py-2 transition-colors",
                active ? "text-gold" : "text-muted hover:text-fg",
              )}
            >
              {active && (
                <span className="absolute -top-2 h-0.5 w-8 rounded-full bg-gold shadow-[0_0_10px_rgba(246,196,69,0.8)]" />
              )}
              <Icon
                className={cn("h-5 w-5 transition-transform", active && "scale-110")}
                strokeWidth={active ? 2.6 : 2}
              />
              <span className="font-display text-[11px] font-semibold tracking-wide">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
