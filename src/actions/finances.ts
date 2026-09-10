"use server";

import { getSupabase } from "@/lib/supabase/server";
import type { FundType, Investment } from "@/lib/types";

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
  const supabase = await getSupabase();
  if (!supabase) {
    return { ok: false, persisted: false, newBalance: null, newInvested: null };
  }

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
  const supabase = await getSupabase();
  if (!supabase) return { persisted: false, funds: null };

  const { data, error } = await supabase.rpc("calculate_daily_interest");
  if (error) {
    console.error("[calculateDailyInterest] RPC error:", error.message);
    return { persisted: false, funds: null };
  }
  return { persisted: true, funds: (data ?? []) as Investment[] };
}

// -----------------------------------------------------------------------------
// Ruleta
// -----------------------------------------------------------------------------
export interface SpinResult {
  ok: boolean;
  persisted: boolean;
  multiplier: number | null;
  payout: number | null;
  newBalance: number | null;
  insufficient?: boolean;
  error?: string;
}

export async function spinRoulette(bet: number): Promise<SpinResult> {
  const supabase = await getSupabase();
  if (!supabase) {
    return {
      ok: false,
      persisted: false,
      multiplier: null,
      payout: null,
      newBalance: null,
    };
  }

  const { data, error } = await supabase.rpc("spin_roulette", { p_bet: bet });
  if (error) {
    const insufficient = /insuficiente/i.test(error.message);
    console.error("[spinRoulette] RPC error:", error.message);
    return {
      ok: false,
      persisted: true,
      multiplier: null,
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
    multiplier: row?.multiplier ?? null,
    payout: row?.payout ?? null,
    newBalance: row?.new_balance ?? null,
  };
}
