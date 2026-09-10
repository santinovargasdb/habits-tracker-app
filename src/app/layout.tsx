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
  showChrome: boolean;
  balance: number;
  email: string | null;
}

// Modo demo (sin backend): mostramos el chrome del juego igual.
// Con backend: sólo mostramos header/wallet si hay usuario autenticado; en
// /login (sin sesión) el layout renderiza la página sola.
async function getSessionChrome(): Promise<SessionChrome> {
  const supabase = await getSupabase();
  if (!supabase) return { showChrome: true, balance: 0, email: null };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { showChrome: false, balance: 0, email: null };

  const { data } = await supabase
    .from("wallet")
    .select("balance")
    .limit(1)
    .maybeSingle();
  return {
    showChrome: true,
    balance: data?.balance ?? 0,
    email: user.email ?? null,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { showChrome, balance, email } = await getSessionChrome();

  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {showChrome ? (
          <WalletProvider initialBalance={balance}>
            <Header userEmail={email} />
            <main className="relative z-10">{children}</main>
          </WalletProvider>
        ) : (
          <main className="relative z-10">{children}</main>
        )}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
