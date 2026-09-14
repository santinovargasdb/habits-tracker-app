"use client";

import { useEffect } from "react";
import { WalletProvider, useWallet } from "@/lib/wallet-context";
import { readSnapshot } from "@/lib/offline/store";
import { ReactNode } from "react";

function BalanceHydrator() {
  const { setBalance } = useWallet();
  useEffect(() => {
    const snap = readSnapshot();
    if (snap) setBalance(snap.balance);
  }, [setBalance]);
  return null;
}

export function ClientWalletProvider({
  initialBalance,
  children,
}: {
  initialBalance: number;
  children: ReactNode;
}) {
  return (
    <WalletProvider initialBalance={initialBalance}>
      <BalanceHydrator />
      {children}
    </WalletProvider>
  );
}
