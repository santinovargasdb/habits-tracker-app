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

async function getInitialBalance(): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;
  const { data } = await supabase
    .from("wallet")
    .select("balance")
    .limit(1)
    .maybeSingle();
  return data?.balance ?? 0;
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialBalance = await getInitialBalance();

  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <WalletProvider initialBalance={initialBalance}>
          <Header />
          <main className="relative z-10">{children}</main>
        </WalletProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
