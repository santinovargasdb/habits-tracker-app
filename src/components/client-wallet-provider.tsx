"use client";

import { WalletProvider } from "@/lib/wallet-context";
import { ReactNode } from "react";

export function ClientWalletProvider({
  initialBalance,
  children,
}: {
  initialBalance: number;
  children: ReactNode;
}) {
  return <WalletProvider initialBalance={initialBalance}>{children}</WalletProvider>;
}
