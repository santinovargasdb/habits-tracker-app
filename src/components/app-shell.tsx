"use client";

import { useState } from "react";
import TrackerView from "@/components/tracker-view";
import DeckView from "@/components/deck-view";
import StoreView from "@/components/store-view";
import FinancesView from "@/components/finances-view";
import { BottomNav, type AppTab } from "@/components/bottom-nav";
import { GameProvider } from "@/lib/game-context";
import type {
  AwardMap,
  Card,
  Deck,
  Habit,
  Investment,
  LogMap,
  OwnedCard,
} from "@/lib/types";

interface AppShellProps {
  date: string;
  habits: Habit[];
  initialLogs: LogMap;
  initialAwards: AwardMap;
  cards: Card[];
  inventory: OwnedCard[];
  initialDeck: Deck;
  initialInvestments: Investment[];
  configured: boolean;
}

export default function AppShell({
  date,
  habits,
  initialLogs,
  initialAwards,
  cards,
  inventory,
  initialDeck,
  initialInvestments,
  configured,
}: AppShellProps) {
  const [tab, setTab] = useState<AppTab>("tracker");

  return (
    <GameProvider
      cards={cards}
      inventory={inventory}
      initialDeck={initialDeck}
      configured={configured}
    >
      {/* Mantenemos ambas vistas montadas para preservar estado/scroll al alternar */}
      <div hidden={tab !== "tracker"}>
        <TrackerView
          date={date}
          habits={habits}
          initialLogs={initialLogs}
          initialAwards={initialAwards}
          configured={configured}
        />
      </div>
      <div hidden={tab !== "mazo"}>
        <DeckView />
      </div>
      <div hidden={tab !== "mercado"}>
        <StoreView />
      </div>
      <div hidden={tab !== "finanzas"}>
        <FinancesView
          initialInvestments={initialInvestments}
          configured={configured}
        />
      </div>

      <BottomNav tab={tab} onChange={setTab} />
    </GameProvider>
  );
}
