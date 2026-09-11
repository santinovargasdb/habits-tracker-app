import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/header";
import { WalletProvider } from "@/lib/wallet-context";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { getSupabase } from "@/lib/supabase/server";

const display = Bricolage_Grotesque({
  variable: "--ff-display",
  subsets: ["latin"],
  display: "swap",
});
const body = Hanken_Grotesk({
  variable: "--ff-body",
  subsets: ["latin"],
  display: "swap",
});
const mono = JetBrains_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dojo Ledger — Tracking de Hábitos",
  description:
    "Trackeá tus hábitos y ganá monedas. Motor de tracking con economía gamificada.",
  applicationName: "Dojo Ledger",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Dojo Ledger",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

interface SessionChrome {
  authed: boolean;
  balance: number;
  email: string | null;
}

// Devuelve la sesión para decidir el chrome (header/logout). OJO: esto NO debe
// gatear al WalletProvider — ver RootLayout.
async function getSessionChrome(): Promise<SessionChrome> {
  const supabase = await getSupabase();
  if (!supabase) return { authed: false, balance: 0, email: null };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authed: false, balance: 0, email: null };

  const { data } = await supabase
    .from("wallet")
    .select("balance")
    .limit(1)
    .maybeSingle();
  return {
    authed: true,
    balance: data?.balance ?? 0,
    email: user.email ?? null,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authed, balance, email } = await getSessionChrome();

  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/*
          WalletProvider SIEMPRE envuelve a los children: la ruleta, la tienda y
          el inventario (bajo `/`) consumen useWallet(), y el proxy y el layout
          resuelven la sesión por separado. Gatearlo por `authed` provocaba
          "useWallet debe usarse dentro de <WalletProvider>" cuando ambos no
          coincidían. El Header/logout sí es condicional (sólo autenticados).
        */}
        <WalletProvider initialBalance={balance}>
          {authed && <Header userEmail={email} />}
          <main className="relative z-10">{children}</main>
        </WalletProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
