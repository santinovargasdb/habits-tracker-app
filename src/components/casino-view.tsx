"use client";

import { useState } from "react";
import { Dices } from "lucide-react";
import RouletteView from "@/components/roulette-view";
import BlackjackView from "@/components/blackjack-view";
import { cn } from "@/lib/utils";

type CasinoTab = "ruleta" | "blackjack";

const TABS: [CasinoTab, string][] = [
  ["ruleta", "Ruleta"],
  ["blackjack", "Blackjack"],
];

export default function CasinoView({ configured }: { configured: boolean }) {
  const [tab, setTab] = useState<CasinoTab>("ruleta");

  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <Dices className="h-4 w-4 text-gold" strokeWidth={2.4} />
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-fg">
          Casino
        </h2>
        <span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
      </div>

      {/* Selector de pestañas */}
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-line bg-ink-2 p-1" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-lg px-3 py-2 font-display text-xs font-bold transition",
              tab === key
                ? "bg-gradient-to-br from-gold to-gold-deep text-ink"
                : "text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Ambas montadas: preserva la mano de blackjack en curso al alternar. */}
      <div hidden={tab !== "ruleta"}>
        <RouletteView configured={configured} />
      </div>
      <div hidden={tab !== "blackjack"}>
        <BlackjackView configured={configured} />
      </div>
    </section>
  );
}
