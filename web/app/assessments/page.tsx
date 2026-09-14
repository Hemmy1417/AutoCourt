"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { roleOf } from "../../lib/acts";
import { truncAddr } from "../../lib/chain";
import { plural, recordNumber, vehicleTitle } from "../../lib/present";
import { getRecord, getRecordIds, getStats } from "../../lib/read";
import type { RecordView } from "../../lib/types";
import { useWallet } from "../../lib/wallet";
import { ErrorNotice, Spinner, StateChip } from "../components/bits";

const PAGE = 8;

// Screen 3 — every record on the contract, newest first, yours marked.
export default function Records() {
  const router = useRouter();
  const { account } = useWallet();
  const [total, setTotal] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [rows, setRows] = useState<Record<string, RecordView | null>>({});
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    getStats()
      .then((s) => setTotal(s.assessments))
      .catch(setError);
  }, []);

  // Ids newest first, one page of the contract's list at a time (it returns
  // at most 50 per call); each card fills in as its own read returns.
  useEffect(() => {
    if (total === null) return;
    const start = Math.max(0, total - shown);
    const end = Math.max(0, total - (shown - PAGE));
    if (end <= start) return;
    let live = true;
    getRecordIds(start, end - start)
      .then((page) => {
        if (!live) return;
        const newest = [...page].reverse();
        setIds((prev) => [...prev, ...newest.filter((id) => !prev.includes(id))]);
        for (const id of newest) {
          getRecord(id)
            .then((r) => live && setRows((prev) => ({ ...prev, [id]: r })))
            .catch((e) => live && setError(e));
        }
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [total, shown]);

  const open = () => {
    const n = Number(lookup.replace(/[^0-9]/g, ""));
    if (n > 0) router.push(`/assessments/ac-${String(n).padStart(6, "0")}`);
  };

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 22, flexWrap: "wrap", gap: 14 }}>
        <div>
          <h2>Records</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Every assessment on the contract, newest first. Records are public: anyone can read one,
            and your wallet marks the ones you are a party to.
          </p>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Record number"
            placeholder="Record number"
            style={{ width: 150 }}
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && open()}
          />
          <button className="btn btn-ghost" disabled={!lookup.trim()} onClick={open}>
            Open
          </button>
          <Link href="/assessments/new" className="btn btn-primary">
            New assessment
          </Link>
        </div>
      </div>
      <ErrorNotice error={error} />
      {total === null ? (
        <div className="row" style={{ justifyContent: "center", padding: 40 }}>
          <Spinner />
        </div>
      ) : total === 0 ? (
        <div className="card" style={{ padding: 28 }}>
          <h3>Nothing on the record yet</h3>
          <p className="muted small" style={{ marginTop: 8 }}>
            No assessment has been opened on this contract. List a vehicle to open the first one.
          </p>
        </div>
      ) : (
        <div className="grid grid-2">
          {ids.map((id) => {
            const r = rows[id];
            if (r === undefined) {
              return (
                <div key={id} className="card" aria-busy="true">
                  <div className="spread">
                    <h3 className="muted">{recordNumber(id)}</h3>
                    <Spinner />
                  </div>
                  <p className="fine" style={{ marginTop: 6 }}>
                    Reading the record from the contract…
                  </p>
                </div>
              );
            }
            if (r === null) return null;
            const role = roleOf(r, account);
            return (
              <Link key={id} href={`/assessments/${id}`} className="card card-link">
                <div className="spread" style={{ alignItems: "flex-start" }}>
                  <h3>{vehicleTitle(r)}</h3>
                  <StateChip state={r.state} />
                </div>
                <p className="fine" style={{ marginTop: 6 }}>
                  {role === "SELLER"
                    ? "You are the seller"
                    : role === "PARTY"
                      ? "You are a party to this record"
                      : `Seller ${truncAddr(r.seller_account)}`}
                  {" · "}
                  {plural(r.items.length, "item")}
                  {r.runs_count > 0 ? ` · ${plural(r.runs_count, "run")}` : ""}
                </p>
                <div className="row" style={{ marginTop: 14, flexWrap: "wrap", gap: 8 }}>
                  <span className="tag">
                    VIN <span className="tag-mono">{r.vin}</span>
                  </span>
                  <span className="tag" title={id}>
                    {recordNumber(id)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {total !== null && shown < total ? (
        <div className="row" style={{ justifyContent: "center", marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={() => setShown((s) => s + PAGE)}>
            Show {Math.min(PAGE, total - shown)} older
          </button>
        </div>
      ) : null}
    </section>
  );
}
