"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  claimTypeLabel,
  formatDate,
  recordNumber,
  vehicleTitle,
} from "../../../lib/present";
import { api } from "../../components/api";
import {
  Empty,
  IdTag,
  Loading,
  PageError,
  StateChip,
} from "../../components/bits";

interface VehicleRow {
  id: string;
  vin: string;
  vinCheckDigitOk: boolean;
  make: string;
  model: string;
  year: number;
  claims: { claimId: string; type: string; declaredValue: string }[];
  assessments: {
    id: string;
    state: string;
    onChainId: string | null;
    createdAt: string;
  }[];
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

  if (error) return <PageError error={error} />;
  if (!rows) return <Loading />;
  const v = rows.find((r) => r.id === id);
  if (!v)
    return (
      <section className="section">
        <Empty>This vehicle is not on your record.</Empty>
      </section>
    );

  return (
    <section className="section" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2>{vehicleTitle(v)}</h2>
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
        <span className="tag">
          VIN <span className="tag-mono">{v.vin}</span>
        </span>
        <span className="tag">
          {v.vinCheckDigitOk
            ? "Check digit consistent"
            : "Check digit inconsistent — recorded as a fact, not a verdict"}
        </span>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Declared claims</h3>
        <div className="stack" style={{ gap: 12 }}>
          {v.claims.map((c) => (
            <div key={c.claimId}>
              <div className="row" style={{ gap: 8 }}>
                <IdTag>{c.claimId}</IdTag>
                <b className="small">{claimTypeLabel(c.type)}</b>
              </div>
              <p className="small muted" style={{ marginTop: 3 }}>
                “{c.declaredValue}”
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Assessments</h3>
        {v.assessments.length === 0 ? (
          <Empty>No assessment has been opened for this vehicle yet.</Empty>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {v.assessments.map((a) => (
              <Link key={a.id} href={`/assessments/${a.id}`} className="spread">
                <span className="small" style={{ fontWeight: 700 }}>
                  {recordNumber(a.onChainId) || "Draft assessment"}
                  <span className="muted" style={{ fontWeight: 500 }}>
                    {" · "}opened {formatDate(a.createdAt)}
                  </span>
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
