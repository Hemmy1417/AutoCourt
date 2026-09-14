"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { truncAddr } from "../../lib/chain";
import { formatGen } from "../../lib/config";
import { getBalanceAtto, requestTestGen } from "../../lib/faucet";
import { useWallet } from "../../lib/wallet";

/**
 * The wallet control: a pill that connects, or the connected address with a
 * menu holding the balance, test GEN, the network switch and disconnect.
 */
export function WalletButton() {
  const { address, chainOk, connecting, wallets, error, connect, disconnect, switchNetwork } = useWallet();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [funding, setFunding] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const boxRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setBalance(await getBalanceAtto(address));
    } catch {
      setBalance(null);
    }
  }, [address]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open) return;
    const kick = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(kick);
  }, [open, refresh]);

  if (address) {
    return (
      <div className="wallet-pop" ref={boxRef}>
        {!chainOk ? (
          <button type="button" className="netpill netpill-warn" onClick={() => void switchNetwork()}>
            Wrong network, switch
          </button>
        ) : null}
        <button
          type="button"
          className="netpill"
          onClick={() => setOpen((v) => !v)}
          title={address}
          aria-expanded={open}
          style={{ cursor: "pointer", fontFamily: "var(--font-ui)", marginLeft: chainOk ? 0 : 8 }}
        >
          <span className="live" aria-hidden />
          <span className="addr">{truncAddr(address)}</span>
        </button>
        {open ? (
          <div className="wallet-menu">
            <div className="menu-note">
              {balance === null ? "Reading your balance…" : `${formatGen(balance)} GEN on Studio Next`}
            </div>
            <button
              disabled={funding === "busy"}
              onClick={async () => {
                setFunding("busy");
                try {
                  await requestTestGen(address);
                  setFunding("done");
                  setTimeout(() => void refresh(), 2500);
                } catch {
                  setFunding("failed");
                }
              }}
            >
              {funding === "busy"
                ? "Requesting test GEN…"
                : funding === "done"
                  ? "Test GEN sent. Request more"
                  : funding === "failed"
                    ? "The faucet did not answer. Try again"
                    : "Get test GEN"}
            </button>
            {!chainOk ? (
              <button onClick={() => void switchNetwork()}>Switch to GenLayer Studio Next</button>
            ) : null}
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(address);
                setOpen(false);
              }}
            >
              Copy address
            </button>
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wallet-pop" ref={boxRef}>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {open ? <WalletChoices onDone={() => setOpen(false)} wallets={wallets} error={error} connect={connect} /> : null}
    </div>
  );
}

/** The discovered wallets, one button each: two extensions never fight over one global. */
export function WalletChoices({
  wallets,
  error,
  connect,
  onDone,
  inline,
}: {
  wallets: ReturnType<typeof useWallet>["wallets"];
  error: string;
  connect: ReturnType<typeof useWallet>["connect"];
  onDone?: () => void;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "stack" : "wallet-menu"} style={inline ? { gap: 8 } : undefined}>
      {wallets.length === 0 ? (
        <p className={inline ? "muted small" : "menu-note"}>
          No wallet extension found in this browser. Install MetaMask or another EVM wallet, then reload.
        </p>
      ) : null}
      {wallets.map((w) => (
        <button
          key={w.info.uuid}
          className={inline ? "btn btn-ghost" : undefined}
          style={inline ? { justifyContent: "flex-start" } : undefined}
          onClick={() => {
            void connect(w)
              .then(() => onDone?.())
              .catch(() => {});
          }}
        >
          {w.info.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={w.info.icon} alt="" width={20} height={20} />
          ) : null}
          {w.info.name}
        </button>
      ))}
      {error ? <p className={inline ? "notice notice-bad" : "menu-note"}>{error}</p> : null}
    </div>
  );
}
