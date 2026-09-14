"use client";

import { useState } from "react";
import TrackerView from "@/components/tracker-view";
import DeckView from "@/components/deck-view";
import StoreView from "@/components/store-view";
import FinancesView from "@/components/finances-view";
import { BottomNav, type AppTab } from "@/components/bottom-nav";
import { GameProvider } from "@/lib/game-context";
import type { TrackerSnapshot } from "@/lib/offline/store";
import type {
  Card,
  Deck,
  Investment,
  OwnedCard,
} from "@/lib/types";

interface AppShellProps {
  seed: TrackerSnapshot | null;
  cards: Card[];
  inventory: OwnedCard[];
  initialDeck: Deck;
  initialInvestments: Investment[];
}

export default function AppShell({
  seed,
  cards,
  inventory,
  initialDeck,
  initialInvestments,
}: AppShellProps) {
  const [tab, setTab] = useState<AppTab>("tracker");

  return (
    <GameProvider cards={cards} inventory={inventory} initialDeck={initialDeck}>
      {/* Mantenemos ambas vistas montadas para preservar estado/scroll al alternar */}
      <div hidden={tab !== "tracker"}>
        <TrackerView seed={seed} />
      </div>
      <div hidden={tab !== "mazo"}>
        <DeckView />
      </div>
      <div hidden={tab !== "mercado"}>
        <StoreView />
      </div>
      <div hidden={tab !== "finanzas"}>
        <FinancesView initialInvestments={initialInvestments} />
      </div>

      <BottomNav tab={tab} onChange={setTab} />
    </GameProvider>
  );
}
