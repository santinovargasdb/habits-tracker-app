"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface WalletContextValue {
  balance: number;
  /** Setea el balance a un valor absoluto (reconciliación con la DB). */
  setBalance: (value: number) => void;
  /** Aplica un delta (optimista) al balance. */
  addToBalance: (delta: number) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({
  initialBalance = 0,
  children,
}: {
  initialBalance?: number;
  children: ReactNode;
}) {
  const [balance, setBalance] = useState(initialBalance);

  const addToBalance = useCallback(
    (delta: number) => setBalance((b) => b + delta),
    [],
  );

  return (
    <WalletContext.Provider value={{ balance, setBalance, addToBalance }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet debe usarse dentro de <WalletProvider>");
  }
  return ctx;
}
