"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { CHAIN_ID } from "../../lib/chain";
import { CONTRACT_ADDRESS, explorerAddress } from "../../lib/config";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/assessments", label: "Records", exact: true },
  { href: "/assessments/new", label: "New assessment", exact: true },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const active = (href: string) =>
    pathname === href || (href === "/assessments" && /^\/assessments\/ac-/.test(pathname));

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <Link href="/" className="wordmark">
            <Logo size={26} />
            AutoCourt
          </Link>
          <nav className="topnav">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={active(n.href) ? "active" : ""}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="netpill netpill-network" title={`GenLayer Studio Next · chain ${CHAIN_ID}`}>
              <span className="live" aria-hidden />
              GenLayer Studio Next
            </span>
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="shell">{children}</main>
      <footer className="footer">
        <div className="shell spread" style={{ flexWrap: "wrap", rowGap: 8 }}>
          <span>
            Verdicts are derived in deterministic public code. No party, including us, authors what
            the panel decides.
          </span>
          <span>
            Evidence on the record is public, permanently.{" "}
            <a className="link" href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
              The contract ↗
            </a>
          </span>
        </div>
      </footer>
    </>
  );
}
