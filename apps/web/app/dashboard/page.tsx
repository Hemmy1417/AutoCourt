"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../components/api";
import { ErrorNotice, Spinner, StateChip } from "../components/bits";

interface AssessmentRow {
  id: string;
  state: string;
  onChainId: string | null;
  myRole: "SELLER" | "BUYER";
  createdAt: string;
  vehicle: { vin: string; make: string; model: string; year: number };
  runs: { status: string; kind: string }[];
}

// Screen 3 — dashboard: everything you're a party to, both roles.
export default function Dashboard() {
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(after?: string | null) {
    try {
      const q = after ? `?cursor=${encodeURIComponent(after)}` : "";
      const page = await api<{ items: AssessmentRow[]; nextCursor: string | null }>(
        `/api/assessments${q}`,
      );
      setRows((prev) => (after ? [...(prev ?? []), ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 22 }}>
        <div>
          <h2>Your assessments</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Selling and buying, in one place. Every row is a record.
          </p>
        </div>
        <Link href="/vehicles/new" className="btn btn-primary">
          New assessment
        </Link>
      </div>
      <ErrorNotice error={error} />
      {rows === null ? (
        <div className="row" style={{ justifyContent: "center", padding: 40 }}>
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: 28 }}>
          <h3>Nothing on the record yet</h3>
          <p className="muted small" style={{ marginTop: 8, maxWidth: 560 }}>
            Your wallet is your account, so this page shows only the
            assessments you are a party to. An empty page here means this
            wallet has not opened or been shared one — not that anything
            is wrong.
          </p>
          <div className="row" style={{ marginTop: 18, flexWrap: "wrap" }}>
            <Link href="/vehicles/new" className="btn btn-primary">
              List a vehicle
            </Link>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>
            Sent a report? Open the share link the seller gave you and it
            will appear here — you can add counter-evidence and dispute a
            claim in your own name.
          </p>
        </div>
      ) : (
        <div className="grid grid-2">
          {rows.map((a) => (
            <Link key={a.id} href={`/assessments/${a.id}`} className="card">
              <div className="spread">
                <h3>
                  {a.vehicle.year} {a.vehicle.make} {a.vehicle.model}
                </h3>
                <StateChip state={a.state} />
              </div>
              <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <span className="tag">{a.vehicle.vin}</span>
                <span className="tag">
                  {a.myRole === "SELLER" ? "you are selling" : "shared with you"}
                </span>
                {a.onChainId ? <span className="tag">{a.onChainId}</span> : null}
              </div>
            </Link>
          ))}
        </div>
      )}
      {cursor ? (
        <div className="row" style={{ justifyContent: "center", marginTop: 20 }}>
          <button
            className="btn btn-ghost"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              await load(cursor);
              setLoadingMore(false);
            }}
          >
            {loadingMore ? <Spinner /> : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
