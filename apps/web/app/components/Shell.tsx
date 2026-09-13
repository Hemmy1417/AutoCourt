"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Logo } from "./Logo";
import { api, type Me } from "./api";

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
            <span className="netpill">GenLayer · Studio Next · 61997</span>
            {me === undefined ? null : me ? (
              <>
                <span className="small muted">{me.displayName}</span>
                <button className="btn btn-quiet" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <Link className="btn btn-ghost" href="/auth">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="shell">{children}</main>
      <footer className="footer">
        <div className="shell spread" style={{ flexWrap: "wrap" }}>
          <span>
            AutoCourt — verdicts derived in deterministic public code; no
            party, including us, authors what the panel decides.
          </span>
          <span className="mono" style={{ fontSize: 12 }}>
            adjudicated evidence is public, permanently — see Settings →
            Privacy
          </span>
        </div>
      </footer>
    </>
  );
}
