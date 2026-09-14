"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Logo } from "./Logo";
import { api, shortAddress, type Me } from "./api";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/vehicles/new", label: "New assessment" },
  { href: "/settings", label: "Settings" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, [pathname]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMe(null);
    router.push("/");
  }

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <Link href="/" className="wordmark">
            <Logo size={26} />
            AutoCourt
          </Link>
          {me ? (
            <nav className="topnav">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={pathname.startsWith(n.href) ? "active" : ""}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          ) : null}
          <div className="topbar-right">
            <span
              className="netpill netpill-network"
              title="GenLayer Studio Next · chain 61997"
            >
              <span className="live" aria-hidden />
              GenLayer Studio Next
            </span>
            {me === undefined ? null : me ? (
              <>
                <span className="netpill" title={me.walletAddress}>
                  {me.displayName ? (
                    <span className="who">{me.displayName}</span>
                  ) : null}
                  <span className="addr">{shortAddress(me.walletAddress)}</span>
                </span>
                <button className="btn btn-quiet" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : pathname.startsWith("/auth") ? null : (
              <Link className="btn btn-ghost" href="/auth">
                Connect wallet
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="shell">{children}</main>
      <footer className="footer">
        <div className="shell spread" style={{ flexWrap: "wrap", rowGap: 8 }}>
          <span>
            Verdicts are derived in deterministic public code. No party,
            including us, authors what the panel decides.
          </span>
          <span>
            Adjudicated evidence is public, permanently.
            {me ? (
              <>
                {" "}
                <Link href="/settings" className="link">
                  Privacy settings
                </Link>
              </>
            ) : null}
          </span>
        </div>
      </footer>
    </>
  );
}
