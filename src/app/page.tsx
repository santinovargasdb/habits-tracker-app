import AppShell from "@/components/app-shell";
import { getSupabase } from "@/lib/supabase/server";
import { EMPTY_DECK, normalizeTimeBlock } from "@/lib/constants";
import { rowToCard } from "@/lib/cards";
import { todayISO, weekStartISO } from "@/lib/utils";
import type {
  Card,
  Deck,
  Habit,
  Investment,
  OwnedCard,
} from "@/lib/types";
import type { TrackerSnapshot } from "@/lib/offline/store";

// Siempre renderizar en el request (datos del día actual, sin cache).
export const dynamic = "force-dynamic";

export default async function Page() {
  const date = todayISO();
  const supabase = await getSupabase();

  let habits: Habit[] = [];
  let cards: Card[] = [];
  let inventory: OwnedCard[] = [];
  let deck: Deck = EMPTY_DECK;
  let investments: Investment[] = [];
  const logs: TrackerSnapshot["logs"] = {};
  const awards: TrackerSnapshot["awards"] = {};

  if (supabase) {
    // Hábitos (incluye `frequency` y `multiplier` para el Bloque Semanal).
    const primaryHabits = await supabase
      .from("habits")
      .select("id, name, time_block, sort_order, frequency, multiplier")
      .order("sort_order", { ascending: true });
    // Compat: si faltan las columnas nuevas, reintentamos con lo básico.
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
        // La DB de prod guarda el bloque en inglés (MORNING/COMMUTE/...); la UI
        // agrupa por las etiquetas canónicas en español. Traducimos al cargar.
        time_block: normalizeTimeBlock(h.time_block),
        // Normalizamos la cadencia a minúsculas (la DB puede tener 'weekly' o 'WEEKLY').
        frequency: String(h.frequency ?? "daily").toLowerCase(),
        multiplier: typeof h.multiplier === "number" ? h.multiplier : 1,
      })) as Habit[];
    }

    // Logs: los diarios se anclan a HOY; los semanales, al lunes de la semana.
    // Un hábito diario puede tener logs viejos con date = ese lunes, así que
    // filtramos cada fila por la fecha que le corresponde según su cadencia.
    const weekStart = weekStartISO(date);
    const weeklyIds = new Set(
      habits.filter((h) => h.frequency === "weekly").map((h) => h.id),
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

    // Catálogo de cartas. Leemos * y normalizamos el multiplicador y el icono
    // (según exista `multiplier`/`multiplier_percent` e `icon_url`/`image_url`).
    const dbCards = (await supabase.from("cards").select("*")).data as Array<
      Record<string, unknown>
    > | null;
    if (dbCards && dbCards.length > 0) {
      cards = dbCards.map(rowToCard);
    }

    // Inventario (join en JS) — incluye id de fila e is_equipped (mazo activo).
    const cardMap = new Map(cards.map((c) => [c.id, c]));
    const primaryInv = await supabase
      .from("user_inventory")
      .select("id, card_id, quantity, level, is_equipped");
    // Compat: si `is_equipped` no existe aún, reintentamos sin ella (default false).
    let dbInv = primaryInv.data as Array<Record<string, unknown>> | null;
    if (!dbInv) {
      const retry = await supabase
        .from("user_inventory")
        .select("id, card_id, quantity, level");
      dbInv = retry.data as Array<Record<string, unknown>> | null;
    }
    if (dbInv) {
      inventory = dbInv
        .map((row) => {
          const card = cardMap.get(String(row.card_id));
          return card
            ? {
                id: String(row.id),
                card,
                quantity: Number(row.quantity ?? 1),
                level: Number(row.level ?? 1),
                is_equipped: Boolean(row.is_equipped),
              }
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

  const seed: TrackerSnapshot = {
    date,
    habits,
    logs,
    awards,
    balance: 0, // el saldo lo maneja el wallet-context / store local
  };

  return (
    <AppShell
      seed={seed}
      cards={cards}
      inventory={inventory}
      initialDeck={deck}
      initialInvestments={investments}
    />
  );
}
