import AppShell from "@/components/app-shell";
import { getSupabase } from "@/lib/supabase/server";
import {
  DEMO_INVENTORY,
  DEMO_INVESTMENTS,
  EMPTY_DECK,
  SEED_CARDS,
  SEED_HABITS,
} from "@/lib/constants";
import { todayISO, weekStartISO } from "@/lib/utils";
import type {
  AwardMap,
  Card,
  Deck,
  Habit,
  Investment,
  LogMap,
  OwnedCard,
} from "@/lib/types";

// Siempre renderizar en el request (datos del día actual, sin cache).
export const dynamic = "force-dynamic";

export default async function Page() {
  const date = todayISO();
  const supabase = await getSupabase();
  const configured = supabase !== null;

  let habits: Habit[] = SEED_HABITS;
  let cards: Card[] = SEED_CARDS;
  let inventory: OwnedCard[] = DEMO_INVENTORY;
  let deck: Deck = EMPTY_DECK;
  let investments: Investment[] = DEMO_INVESTMENTS;
  const logs: LogMap = {};
  const awards: AwardMap = {};

  if (supabase) {
    // Hábitos (incluye `frequency` para el Bloque Semanal).
    const primaryHabits = await supabase
      .from("habits")
      .select("id, name, time_block, sort_order, frequency")
      .order("sort_order", { ascending: true });
    // Compat: si la columna `frequency` no existe (migración 08 sin aplicar),
    // la query falla; reintentamos sin ella y asumimos DAILY.
    let dbHabits = primaryHabits.data as Array<Record<string, unknown>> | null;
    if (!dbHabits) {
      const retry = await supabase
        .from("habits")
        .select("id, name, time_block, sort_order")
        .order("sort_order", { ascending: true });
      dbHabits = retry.data as Array<Record<string, unknown>> | null;
    }
    if (dbHabits && dbHabits.length > 0) {
      habits = dbHabits.map((h) => ({
        ...h,
        frequency: h.frequency ?? "DAILY",
      })) as Habit[];
    }

    // Logs: los diarios se anclan a HOY; los semanales, al lunes de la semana.
    // Un hábito diario puede tener logs viejos con date = ese lunes, así que
    // filtramos cada fila por la fecha que le corresponde según su cadencia.
    const weekStart = weekStartISO(date);
    const weeklyIds = new Set(
      habits.filter((h) => h.frequency === "WEEKLY").map((h) => h.id),
    );
    const logDates = weekStart === date ? [date] : [date, weekStart];
    const { data: dbLogs } = await supabase
      .from("logs")
      .select("habit_id, status, coins_awarded, date")
      .in("date", logDates);
    for (const row of dbLogs ?? []) {
      const expected = weeklyIds.has(row.habit_id) ? weekStart : date;
      if (row.date !== expected) continue;
      logs[row.habit_id] = row.status;
      awards[row.habit_id] = row.coins_awarded ?? 0;
    }

    // Catálogo de cartas (incluye `image_url` para el icono oficial).
    const primaryCards = await supabase
      .from("cards")
      .select(
        "id, name, rarity, target_block, multiplier_percent, description, image_url",
      );
    // Compat: si la columna `image_url` no existe (migración 09 sin aplicar),
    // reintentamos sin ella; la UI cae al arte emoji de fallback.
    let dbCards = primaryCards.data as Array<Record<string, unknown>> | null;
    if (!dbCards) {
      const retry = await supabase
        .from("cards")
        .select("id, name, rarity, target_block, multiplier_percent, description");
      dbCards = retry.data as Array<Record<string, unknown>> | null;
    }
    if (dbCards && dbCards.length > 0) {
      cards = dbCards.map((c) => ({
        ...c,
        image_url: c.image_url ?? null,
      })) as Card[];
    }

    // Inventario (join en JS)
    const cardMap = new Map(cards.map((c) => [c.id, c]));
    const { data: dbInv } = await supabase
      .from("user_inventory")
      .select("card_id, quantity, level");
    if (dbInv) {
      inventory = dbInv
        .map((row) => {
          const card = cardMap.get(row.card_id);
          return card
            ? { card, quantity: row.quantity, level: row.level }
            : null;
        })
        .filter((x): x is OwnedCard => x !== null);
    }

    // Mazo activo (singleton)
    const { data: dbDeck } = await supabase
      .from("active_deck")
      .select(
        "slot_1, slot_2, slot_3, slot_4, slot_5, slot_6, slot_7, slot_8",
      )
      .limit(1)
      .maybeSingle();
    if (dbDeck) {
      deck = [
        dbDeck.slot_1,
        dbDeck.slot_2,
        dbDeck.slot_3,
        dbDeck.slot_4,
        dbDeck.slot_5,
        dbDeck.slot_6,
        dbDeck.slot_7,
        dbDeck.slot_8,
      ];
    }

    // Inversiones
    const { data: dbInv2 } = await supabase
      .from("investments")
      .select("id, fund_type, invested_amount, last_compounded_at");
    if (dbInv2 && dbInv2.length > 0) investments = dbInv2 as Investment[];
  }

  return (
    <AppShell
      date={date}
      habits={habits}
      initialLogs={logs}
      initialAwards={awards}
      cards={cards}
      inventory={inventory}
      initialDeck={deck}
      initialInvestments={investments}
      configured={configured}
    />
  );
}
