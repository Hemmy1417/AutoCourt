"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../components/api";
import { Empty, ErrorNotice, Spinner, StateChip } from "../components/bits";

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
        <Empty>
          Nothing on the record yet. List a vehicle to open your first
          assessment — or redeem a share link a seller sent you.
        </Empty>
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
