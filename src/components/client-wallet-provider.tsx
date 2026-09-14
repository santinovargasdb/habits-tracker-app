"use client";

import { WalletProvider } from "@/lib/wallet-context";
import { ReactNode } from "react";

/**
 * Provee el wallet-context sembrado con el saldo del SSR. La hidratación desde el
 * store local y las actualizaciones de balance (sync + marca optimista) las hace
 * `useTrackerData` — único dueño del balance offline, para no duplicar responsabilidad.
 */
export function ClientWalletProvider({
  initialBalance,
  children,
}: {
  initialBalance: number;
  children: ReactNode;
}) {
  return (
    <WalletProvider initialBalance={initialBalance}>{children}</WalletProvider>
  );
}
