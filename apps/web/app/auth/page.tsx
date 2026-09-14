"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { api, type Me } from "../components/api";
import { ErrorNotice, Spinner } from "../components/bits";
import { Logo } from "../components/Logo";

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface DiscoveredWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

// Screen 2 — wallet sign-in. The account IS the address: an EIP-191
// signature over a server nonce proves control; no transaction is sent.
//
// Wallets are found through EIP-6963 discovery (the multi-wallet-safe
// path — several extensions fight over window.ethereum, and some no
// longer inject it at all), with a legacy window.ethereum fallback for
// wallets that never announce.
function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [scanned, setScanned] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Already signed in? Then this page has nothing to ask. Whatever link
  // led here — a bookmark, the back button, a stale CTA — forward it
  // rather than prompting the wallet a second time.
  useEffect(() => {
    let cancelled = false;
    api<Me>("/api/me")
      .then(() => {
        if (!cancelled) router.replace(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  useEffect(() => {
    function onAnnounce(e: Event) {
      const d = (e as CustomEvent).detail as DiscoveredWallet;
      if (!d?.info?.uuid || typeof d.provider?.request !== "function") return;
      setWallets((prev) =>
        prev.some((w) => w.info.uuid === d.info.uuid) ? prev : [...prev, d],
      );
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const eth = (window as unknown as { ethereum?: Eip1193Provider })
        .ethereum;
      if (eth && typeof eth.request === "function") {
        setWallets((prev) =>
          prev.length
            ? prev
            : [
                {
                  info: {
                    uuid: "legacy",
                    name: "Browser wallet",
                    icon: "",
                    rdns: "legacy.injected",
                  },
                  provider: eth,
                },
              ],
        );
      }
      setScanned(true);
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  async function connect(provider: Eip1193Provider) {
    setBusy(true);
    setError(null);
    try {
      setStep("Asking your wallet for an account…");
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error("Your wallet did not share an account.");
      setStep("Preparing your sign-in message…");
      const { nonce, message } = await api<{ nonce: string; message: string }>(
        "/api/auth/nonce",
        { method: "POST", body: JSON.stringify({ address }) },
      );
      setStep("Waiting for your signature in the wallet…");
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;
      setStep("Verifying your signature…");
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
        {scanned && wallets.length === 0 ? (
          <div className="notice notice-warn" style={{ marginTop: 12 }}>
            No wallet extension found. Install MetaMask or another browser
            wallet, then reload this page.
          </div>
        ) : wallets.length > 1 ? (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {wallets.map((w) => (
              <button
                key={w.info.uuid}
                className="btn btn-primary"
                style={{ width: "100%" }}
                disabled={busy}
                onClick={() => connect(w.provider)}
              >
                {busy ? <Spinner /> : <>
                  {w.info.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={w.info.icon}
                      alt=""
                      width={18}
                      height={18}
                      style={{ marginRight: 8, verticalAlign: "-3px" }}
                    />
                  ) : null}
                  Sign in with {w.info.name}
                </>}
              </button>
            ))}
          </div>
        ) : (
          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 12 }}
            disabled={busy || wallets.length === 0}
            onClick={() => wallets[0] && connect(wallets[0].provider)}
          >
            {busy ? (
              <Spinner />
            ) : wallets.length === 0 ? (
              "Looking for wallets…"
            ) : (
              `Connect ${wallets[0]?.info.name ?? "wallet"} & sign in`
            )}
          </button>
        )}
        {step ? (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {step}
          </p>
        ) : null}
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Anyone can create a wallet, and AutoCourt says so plainly. What makes
          a second wallet worthless is the contract: evidence from one account
          never corroborates itself, and a verified claim needs an independent
          source that no wallet can create.
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
