"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "../../components/api";
import { Empty, ErrorNotice, Spinner, StateChip } from "../../components/bits";

interface VehicleRow {
  id: string;
  vin: string;
  vinCheckDigitOk: boolean;
  make: string;
  model: string;
  year: number;
  claims: { claimId: string; type: string; declaredValue: string }[];
  assessments: { id: string; state: string }[];
}

// Screen 5 — vehicle profile.
export default function VehicleProfile() {
  const { id } = useParams<{ id: string }>();
  const [rows, setRows] = useState<VehicleRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ items: VehicleRow[] }>("/api/vehicles")
      .then((r) => setRows(r.items))
      .catch(setError);
  }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!rows)
    return (
      <div className="row" style={{ justifyContent: "center", padding: 60 }}>
        <Spinner />
      </div>
    );
  const v = rows.find((r) => r.id === id);
  if (!v)
    return (
      <section className="section">
        <div className="empty">This vehicle is not on your record.</div>
      </section>
    );

  return (
    <section className="section" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2>
        {v.year} {v.make} {v.model}
      </h2>
      <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <span className="tag">{v.vin}</span>
        <span className="tag">
          check digit {v.vinCheckDigitOk ? "consistent" : "not consistent (a fact, not a verdict)"}
        </span>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Declared claims</h3>
        <div className="stack" style={{ gap: 10 }}>
          {v.claims.map((c) => (
            <div key={c.claimId} className="row" style={{ flexWrap: "wrap" }}>
              <span className="tag">{c.claimId}</span>
              <b className="small">{c.type.replaceAll("_", " ")}</b>
              <span className="small muted">“{c.declaredValue}”</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Assessments</h3>
        {v.assessments.length === 0 ? (
          <Empty>No assessment opened for this vehicle yet.</Empty>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {v.assessments.map((a) => (
              <Link key={a.id} href={`/assessments/${a.id}`} className="spread">
                <span className="small" style={{ fontWeight: 700 }}>
                  Assessment {a.id.slice(0, 8)}…
                </span>
                <StateChip state={a.state} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
