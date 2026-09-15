"use server";

import { getSupabaseOrThrow } from "@/lib/supabase/server";
import type {
  BlackjackRpcRow,
  BlackjackView,
  ChickenView,
  FundType,
  Investment,
  MinesView,
  RouletteColor,
} from "@/lib/types";

// -----------------------------------------------------------------------------
// Depósitos / retiros de inversión
// -----------------------------------------------------------------------------
export interface ManageInvestmentResult {
  ok: boolean;
  persisted: boolean;
  newBalance: number | null;
  newInvested: number | null;
  insufficient?: boolean;
  error?: string;
}

export async function manageInvestment(
  action: "DEPOSIT" | "WITHDRAW",
  fund: FundType,
  amount: number,
): Promise<ManageInvestmentResult> {
  const supabase = await getSupabaseOrThrow();

  const { data, error } = await supabase.rpc("manage_investment", {
    p_action: action,
    p_fund: fund,
    p_amount: amount,
  });

  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error("[manageInvestment] RPC error:", error.message);
    return {
      ok: false,
      persisted: true,
      newBalance: null,
      newInvested: null,
      insufficient,
      error: error.message,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    persisted: true,
    newBalance: row?.new_balance ?? null,
    newInvested: row?.new_invested ?? null,
  };
}

// -----------------------------------------------------------------------------
// Interés diario (se llama silenciosamente al montar la vista)
// -----------------------------------------------------------------------------
export interface InterestResult {
  persisted: boolean;
  funds: Investment[] | null;
}

export async function calculateDailyInterest(): Promise<InterestResult> {
  const supabase = await getSupabaseOrThrow();

  const { data, error } = await supabase.rpc("calculate_daily_interest");
  if (error) {
    console.error("[calculateDailyInterest] RPC error:", error.message);
    return { persisted: false, funds: null };
  }
  return { persisted: true, funds: (data ?? []) as Investment[] };
}

// -----------------------------------------------------------------------------
// Ruleta europea por color (Paso 7)
// -----------------------------------------------------------------------------
export interface SpinResult {
  ok: boolean;
  persisted: boolean;
  resultNumber: number | null;
  resultColor: RouletteColor | null;
  won: boolean;
  payout: number | null;
  newBalance: number | null;
  insufficient?: boolean;
  error?: string;
}

export async function spinRoulette(
  betAmount: number,
  choice: RouletteColor,
): Promise<SpinResult> {
  const supabase = await getSupabaseOrThrow();

  const { data, error } = await supabase.rpc("spin_roulette", {
    p_bet_amount: betAmount,
    p_choice: choice,
  });
  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error("[spinRoulette] RPC error:", error.message);
    return {
      ok: false,
      persisted: true,
      resultNumber: null,
      resultColor: null,
      won: false,
      payout: null,
      newBalance: null,
      insufficient,
      error: error.message,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    persisted: true,
    resultNumber: row?.result_number ?? null,
    resultColor: (row?.result_color ?? null) as RouletteColor | null,
    won: row?.won ?? false,
    payout: row?.payout ?? null,
    newBalance: row?.new_balance ?? null,
  };
}

// -----------------------------------------------------------------------------
// Blackjack (Paso 7) — estado en servidor; el cliente sólo ve la vista saneada.
// -----------------------------------------------------------------------------
export interface BlackjackActionResult {
  ok: boolean;
  persisted: boolean;
  view: BlackjackView | null;
  insufficient?: boolean;
  error?: string;
}

function rowToView(row: BlackjackRpcRow): BlackjackView {
  return {
    status: row.status,
    result: row.result,
    bet: row.bet,
    playerCards: row.player_cards ?? [],
    playerScore: row.player_score,
    dealerCards: row.dealer_cards ?? [],
    dealerScore: row.dealer_score,
    dealerHidden: row.dealer_hidden,
    payout: row.payout,
    newBalance: row.new_balance,
  };
}

async function callBlackjack(
  rpc: "bj_deal" | "bj_hit" | "bj_stand",
  args: Record<string, unknown>,
  tag: string,
): Promise<BlackjackActionResult> {
  const supabase = await getSupabaseOrThrow();

  const { data, error } = await supabase.rpc(rpc, args);
  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error(`[${tag}] RPC error:`, error.message);
    return { ok: false, persisted: true, view: null, insufficient, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, persisted: true, view: null, error: "Respuesta vacía del servidor" };
  }
  return { ok: true, persisted: true, view: rowToView(row as BlackjackRpcRow) };
}

export async function bjDeal(bet: number): Promise<BlackjackActionResult> {
  return callBlackjack("bj_deal", { p_bet: bet }, "bjDeal");
}

export async function bjHit(): Promise<BlackjackActionResult> {
  return callBlackjack("bj_hit", {}, "bjHit");
}

export async function bjStand(): Promise<BlackjackActionResult> {
  return callBlackjack("bj_stand", {}, "bjStand");
}

// -----------------------------------------------------------------------------
// Casino: Minas y Pollito — estado en servidor; el cliente sólo ve la saneada.
// -----------------------------------------------------------------------------
export interface MinesActionResult {
  ok: boolean;
  view: MinesView | null;
  insufficient?: boolean;
  error?: string;
}

function rowToMines(r: Record<string, unknown>): MinesView {
  return {
    status: r.status as MinesView["status"],
    result: (r.result ?? null) as MinesView["result"],
    bet: Number(r.bet),
    minesCount: Number(r.mines_count),
    picks: (r.picks ?? []) as number[],
    multiplier: Number(r.multiplier),
    nextMultiplier: r.next_multiplier == null ? null : Number(r.next_multiplier),
    payout: r.payout == null ? null : Number(r.payout),
    revealedMines: (r.revealed_mines ?? null) as number[] | null,
    newBalance: Number(r.new_balance),
  };
}

async function callMines(
  rpc: "mines_start" | "mines_pick" | "mines_cashout",
  args: Record<string, unknown>,
  tag: string,
): Promise<MinesActionResult> {
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error(`[${tag}] RPC error:`, error.message);
    return { ok: false, view: null, insufficient, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, view: null, error: "Respuesta vacía del servidor" };
  return { ok: true, view: rowToMines(row as Record<string, unknown>) };
}

export async function minesStart(bet: number, mines: number): Promise<MinesActionResult> {
  return callMines("mines_start", { p_bet: bet, p_mines: mines }, "minesStart");
}
export async function minesPick(cell: number): Promise<MinesActionResult> {
  return callMines("mines_pick", { p_cell: cell }, "minesPick");
}
export async function minesCashout(): Promise<MinesActionResult> {
  return callMines("mines_cashout", {}, "minesCashout");
}

export interface ChickenActionResult {
  ok: boolean;
  view: ChickenView | null;
  insufficient?: boolean;
  error?: string;
}

function rowToChicken(r: Record<string, unknown>): ChickenView {
  return {
    status: r.status as ChickenView["status"],
    result: (r.result ?? null) as ChickenView["result"],
    bet: Number(r.bet),
    lane: Number(r.lane),
    multiplier: Number(r.multiplier),
    nextMultiplier: r.next_multiplier == null ? null : Number(r.next_multiplier),
    payout: r.payout == null ? null : Number(r.payout),
    newBalance: Number(r.new_balance),
  };
}

async function callChicken(
  rpc: "chicken_start" | "chicken_step" | "chicken_cashout",
  args: Record<string, unknown>,
  tag: string,
): Promise<ChickenActionResult> {
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error(`[${tag}] RPC error:`, error.message);
    return { ok: false, view: null, insufficient, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, view: null, error: "Respuesta vacía del servidor" };
  return { ok: true, view: rowToChicken(row as Record<string, unknown>) };
}

export async function chickenStart(bet: number): Promise<ChickenActionResult> {
  return callChicken("chicken_start", { p_bet: bet }, "chickenStart");
}
export async function chickenStep(): Promise<ChickenActionResult> {
  return callChicken("chicken_step", {}, "chickenStep");
}
export async function chickenCashout(): Promise<ChickenActionResult> {
  return callChicken("chicken_cashout", {}, "chickenCashout");
}
