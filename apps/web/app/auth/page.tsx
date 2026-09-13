"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { api } from "../components/api";
import { ErrorNotice, Spinner } from "../components/bits";
import { Logo } from "../components/Logo";

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
    };
  }
}

// Screen 2 — wallet sign-in. The account IS the address: an EIP-191
// signature over a server nonce proves control; no transaction is sent.
function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setHasWallet(typeof window !== "undefined" && Boolean(window.ethereum));
  }, []);

  async function connect() {
    if (!window.ethereum) return;
    setBusy(true);
    setError(null);
    try {
      setStep("asking your wallet for an account…");
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error("no account returned by the wallet");
      setStep("issuing a sign-in nonce…");
      const { nonce, message } = await api<{ nonce: string; message: string }>(
        "/api/auth/nonce",
        { method: "POST", body: JSON.stringify({ address }) },
      );
      setStep("waiting for your signature…");
      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;
      setStep("verifying…");
      await api("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ address, nonce, signature, displayName }),
      });
      router.push(next);
    } catch (e) {
      setError(e);
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <section className="section" style={{ maxWidth: 440, margin: "0 auto" }}>
      <div className="card" style={{ padding: 30, textAlign: "center" }}>
        <div className="row" style={{ justifyContent: "center" }}>
          <Logo size={44} />
        </div>
        <h2 style={{ marginTop: 14 }}>Connect your wallet</h2>
        <p className="muted small" style={{ marginTop: 10 }}>
          Your wallet address is your account — it attributes every upload
          and dispute on the record. Signing in is a free signature; no
          transaction is sent and no fee is paid.
        </p>
        <div className="field" style={{ textAlign: "left", marginTop: 18 }}>
          <label>Display name (optional)</label>
          <input
            type="text"
            maxLength={60}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alex N."
          />
        </div>
        <ErrorNotice error={error} />
        {hasWallet === false ? (
          <div className="notice notice-warn" style={{ marginTop: 12 }}>
            No wallet extension detected. Install MetaMask (or any
            EIP-1193 wallet), then reload this page.
          </div>
        ) : (
          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 12 }}
            disabled={busy || hasWallet === null}
            onClick={connect}
          >
            {busy ? <Spinner /> : "Connect wallet & sign in"}
          </button>
        )}
        {step ? (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {step}
          </p>
        ) : null}
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Wallets are self-created, and AutoCourt says so plainly: what
          makes a second wallet worthless is the contract — items from one
          account never corroborate each other, and VERIFIED needs an
          independent anchor no wallet can mint.
        </p>
      </div>
    </section>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthInner />
    </Suspense>
  );
}
