"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLAIM_TYPES } from "../../../lib/present";
import { getRecord, getRecordIds, getStats, invalidateReads } from "../../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../../lib/tx";
import { checkVin } from "../../../lib/validation/vin";
import { useWallet } from "../../../lib/wallet";
import { CONTRACT_ADDRESS } from "../../../lib/config";
import { ErrorNotice } from "../../components/bits";
import { TxFlow } from "../../components/TxFlow";
import { WalletChoices } from "../../components/WalletButton";

interface ClaimDraft {
  type: string;
  declaredValue: string;
}

const MAX_CLAIMS = 12;

// Screen 4 — list a vehicle. The record opens on chain, in the seller's name.
export default function NewAssessment() {
  const router = useRouter();
  const { account, address, client, chainOk, wallets, error: walletError, connect, switchNetwork } = useWallet();
  const [vin, setVin] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [claims, setClaims] = useState<ClaimDraft[]>([{ type: "MILEAGE", declaredValue: "" }]);
  const [progress, setProgress] = useState<TxProgress | null>(null);
  const [error, setError] = useState<unknown>(null);

  const vinCheck = vin.length > 0 ? checkVin(vin) : null;
  const yearN = Number(year);
  const ready =
    vinCheck?.formatValid &&
    make.trim() &&
    model.trim() &&
    Number.isInteger(yearN) &&
    yearN >= 1950 &&
    yearN <= 2035 &&
    claims.every((c) => c.declaredValue.trim());
  const busy = progress ? inFlight(progress.stage) : false;

  function setClaim(i: number, patch: Partial<ClaimDraft>) {
    setClaims((c) => c.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  async function open() {
    if (!vinCheck) return;
    setError(null);
    try {
      const before = (await getStats(true)).assessments;
      let found = "";
      // The contract numbers records in order. The new one is the first id
      // after `before` whose seller is this wallet and whose VIN is this one,
      // which stays right even if someone else opens a record at the same time.
      const predicate = async () => {
        const now = (await getStats(true)).assessments;
        if (now <= before) return false;
        const ids = await getRecordIds(before, Math.min(now - before, 50), true);
        for (const id of ids) {
          const r = await getRecord(id, true);
          if (r && r.seller_account === account && r.vin === vinCheck.vin) {
            found = id;
            return true;
          }
        }
        return false;
      };
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: "create_assessment",
        args: [
          JSON.stringify({ vin: vinCheck.vin, make: make.trim(), model: model.trim(), year: yearN, seller_account: account }),
          JSON.stringify(claims.map((c) => ({ type: c.type, declared_value: c.declaredValue.trim() }))),
        ],
        // Opening a record runs the registry lookup in every validator.
        simulate: false,
        predicateTries: 40,
        predicate,
        onProgress: setProgress,
        confirmedDetail: "The record is open and finalized on chain.",
      });
      if (found) {
        invalidateReads();
        router.push(`/assessments/${found}`);
      }
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section className="section" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2>List a vehicle</h2>
      <p className="muted" style={{ marginTop: 6, marginBottom: 24 }}>
        The VIN is checked in code, and every validator decodes it at the public federal registry
        before the record exists. Each claim&apos;s declared value is <em>your</em> assertion: the
        panel judges it against the record, and a claim nothing backs is marked insufficient, never
        verified.
      </p>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 14 }}>Vehicle</h3>
        <div className="field">
          <label htmlFor="vin">VIN</label>
          <input
            id="vin"
            type="text"
            className="mono-input"
            maxLength={17}
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder="1HGCM82633A004352"
          />
          <span className="hint">
            {vinCheck && !vinCheck.formatValid
              ? `${vinCheck.problem?.charAt(0).toUpperCase()}${vinCheck.problem?.slice(1)}.`
              : vinCheck?.checkDigit === "INVALID"
                ? "The check digit does not match. That is recorded as a fact, not a rejection: genuine imported VINs can fail it."
                : "17 characters, without the letters I, O or Q."}
          </span>
        </div>
        <div className="row form-row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="make">Make</label>
            <input id="make" type="text" maxLength={60} value={make} onChange={(e) => setMake(e.target.value)} placeholder="Honda" />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="model">Model</label>
            <input id="model" type="text" maxLength={60} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Accord" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="year">Year</label>
            <input id="year" type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2003" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>
            Claims{" "}
            <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>
              {claims.length} of {MAX_CLAIMS}
            </span>
          </h3>
          <button
            className="btn btn-ghost"
            disabled={claims.length >= MAX_CLAIMS}
            onClick={() => setClaims((c) => [...c, { type: "CONDITION", declaredValue: "" }])}
          >
            Add claim
          </button>
        </div>
        <div className="stack">
          {claims.map((c, i) => {
            const spec = CLAIM_TYPES.find((t) => t.value === c.type);
            return (
              <div key={i} className="row" style={{ alignItems: "start", gap: 12 }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <select aria-label="Claim type" value={c.type} onChange={(e) => setClaim(i, { type: e.target.value })}>
                    {CLAIM_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                  <input
                    type="text"
                    maxLength={160}
                    value={c.declaredValue}
                    onChange={(e) => setClaim(i, { declaredValue: e.target.value })}
                    placeholder={spec?.example}
                    aria-label={`${spec?.label ?? "Claim"}: declared value`}
                  />
                </div>
                <button
                  className="btn btn-quiet"
                  disabled={claims.length <= 1}
                  aria-label="Remove this claim"
                  title="Remove this claim"
                  onClick={() => setClaims((rows) => rows.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        {!address ? (
          <>
            <h3 style={{ marginBottom: 8 }}>Connect the seller&apos;s wallet</h3>
            <p className="muted small" style={{ marginBottom: 14 }}>
              The record opens in the name of the wallet that signs it. There is no account to create.
            </p>
            <WalletChoices inline wallets={wallets} error={walletError} connect={connect} />
          </>
        ) : !chainOk ? (
          <div className="spread" style={{ flexWrap: "wrap", gap: 12 }}>
            <p className="small">Your wallet is on a different network.</p>
            <button className="btn btn-primary" onClick={() => void switchNetwork()}>
              Switch to GenLayer Studio Next
            </button>
          </div>
        ) : (
          <>
            <div className="spread" style={{ flexWrap: "wrap", gap: 12 }}>
              <p className="small muted" style={{ maxWidth: 440 }}>
                Opening the record is one transaction. The validators decode the VIN while it runs,
                which usually takes a minute or two.
              </p>
              <button className="btn btn-primary" disabled={!ready || busy} onClick={open}>
                {busy ? "Opening…" : "Open the record"}
              </button>
            </div>
            <TxFlow p={progress} />
            {!progress || progress.stage === "failed" || progress.stage === "rejected" ? (
              <ErrorNotice error={progress ? null : error} />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
