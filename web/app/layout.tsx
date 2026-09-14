import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, Figtree, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";
import { WalletProvider } from "../lib/wallet";
import { Shell } from "./components/Shell";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  weight: ["500", "600", "700"],
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  weight: ["400", "600", "700", "800"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "AutoCourt — used-vehicle claims, verified",
  description:
    "Evidence-based used-vehicle verification: seller claims adjudicated against the recorded " +
    "evidence by a validator panel, with verdicts derived in deterministic public code on GenLayer.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${figtree.variable} ${plexMono.variable}`}>
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}
