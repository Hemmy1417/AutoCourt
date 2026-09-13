"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "../../components/api";
import { ErrorNotice, Spinner } from "../../components/bits";

const CLAIM_TYPES = [
  { value: "MILEAGE", label: "Mileage", ph: "87,432 miles" },
  { value: "ACCIDENT_HISTORY", label: "Accident history", ph: "no recorded accidents" },
  { value: "CONDITION", label: "Condition", ph: "excellent; no rust; original paint" },
  { value: "DEFECT_DISCLOSURE", label: "Defect disclosure", ph: "minor oil seep at valve cover, disclosed" },
  { value: "SERVICE_HISTORY", label: "Service history", ph: "full history, main dealer" },
];

interface ClaimDraft {
  type: string;
  declaredValue: string;
}

// Screen 4 — create vehicle assessment.
export default function NewAssessment() {
  const router = useRouter();
  const [vin, setVin] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [claims, setClaims] = useState<ClaimDraft[]>([
    { type: "MILEAGE", declaredValue: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function setClaim(i: number, patch: Partial<ClaimDraft>) {
    setClaims((c) => c.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const vehicle = await api<{ id: string }>("/api/vehicles", {
        method: "POST",
        body: JSON.stringify({
          vin,
          make,
          model,
          year: Number(year),
          claims,
        }),
      });
      const assessment = await api<{ id: string }>("/api/assessments", {
        method: "POST",
        body: JSON.stringify({ vehicleId: vehicle.id }),
      });
      router.push(`/assessments/${assessment.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <section className="section" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2>List a vehicle</h2>
      <p className="muted" style={{ marginTop: 6, marginBottom: 24 }}>
        The VIN is code-validated. Each claim&apos;s declared value is YOUR
        assertion — the panel judges it against the record, and unbacked
        claims land as insufficient, not verified.
      </p>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 14 }}>Vehicle</h3>
        <div className="field">
          <label>VIN</label>
          <input
            type="text"
            className="mono-input"
            maxLength={17}
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder="1M8GDM9AXKP042788"
          />
          <span className="hint">
            17 characters, no I / O / Q. A failed check digit is recorded as
            a fact, not a rejection — genuine imported VINs can fail it.
          </span>
        </div>
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: 2 }}>
            <label>Make</label>
            <input
              type="text"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Meridian"
            />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="GT Wagon"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2019"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Claims ({claims.length}/12)</h3>
          <button
            className="btn btn-ghost"
            disabled={claims.length >= 12}
            onClick={() =>
              setClaims((c) => [...c, { type: "CONDITION", declaredValue: "" }])
            }
          >
            Add claim
          </button>
        </div>
        <div className="stack">
          {claims.map((c, i) => {
            const spec = CLAIM_TYPES.find((t) => t.value === c.type);
            return (
              <div
                key={i}
                className="row"
                style={{ alignItems: "start", gap: 12 }}
              >
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <select
                    value={c.type}
                    onChange={(e) => setClaim(i, { type: e.target.value })}
                  >
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
                    placeholder={spec?.ph}
                  />
                </div>
                <button
                  className="btn btn-quiet"
                  disabled={claims.length <= 1}
                  onClick={() => setClaims((rows) => rows.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <ErrorNotice error={error} />
      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
        <button
          className="btn btn-primary"
          disabled={
            busy ||
            !vin ||
            !make ||
            !model ||
            !year ||
            claims.some((c) => !c.declaredValue.trim())
          }
          onClick={create}
        >
          {busy ? <Spinner /> : "Open the assessment"}
        </button>
      </div>
    </section>
  );
}
