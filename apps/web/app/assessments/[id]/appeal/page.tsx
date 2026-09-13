"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "../../../components/api";
import { ErrorNotice, Spinner } from "../../../components/bits";

interface Detail {
  id: string;
  state: string;
  myRole: "SELLER" | "BUYER";
  evidenceItems: {
    id: string;
    evidenceId: string;
    declaredClass: string;
    declaredLabel: string;
    consentedAt: string | null;
    onChainTxHash: string | null;
  }[];
  runs: { status: string }[];
}

// Screen 11 — appeal / readjudication.
export default function AppealScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [grounds, setGrounds] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Detail>(`/api/assessments/${id}`).then(setDetail).catch(setError);
  }, [id]);

  if (error && !detail) return <ErrorNotice error={error} />;
  if (!detail)
    return (
      <div className="row" style={{ justifyContent: "center", padding: 60 }}>
        <Spinner />
      </div>
    );

  const successRuns = detail.runs.filter((r) => r.status === "SUCCESS").length;
  const runsLeft = 4 - successRuns;
  const newItems = detail.evidenceItems.filter((i) => !i.onChainTxHash);

  if (detail.state !== "ADJUDICATED") {
    return (
      <section className="section">
        <div className="empty">
          An appeal needs a standing verdict. This assessment is{" "}
          {detail.state.toLowerCase()}.
        </div>
      </section>
    );
  }

  return (
    <section className="section" style={{ maxWidth: 680, margin: "0 auto" }}>
      <h2>Appeal the verdict</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        An appeal re-judges the RECORDED bytes — exactly what the first
        panel read, straight from the contract&apos;s own storage — plus
        anything new, clearly tagged as arriving after the outcome was
        known. Prior runs stay on the record. {runsLeft} run
        {runsLeft === 1 ? "" : "s"} left of 4.
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="field">
          <label>Grounds (on the record, shown to the panel as advocacy)</label>
          <textarea
            rows={4}
            maxLength={1200}
            value={grounds}
            onChange={(e) => setGrounds(e.target.value)}
            placeholder="an independent inspection found frame damage the history record missed"
          />
          <span className="hint">{grounds.length}/1200</span>
        </div>

        <h3 style={{ margin: "10px 0" }}>New evidence to enter</h3>
        {newItems.length === 0 ? (
          <p className="muted small">
            Nothing new uploaded yet.{" "}
            <Link
              href={`/assessments/${id}`}
              style={{ color: "var(--signal-deep)", fontWeight: 700 }}
            >
              Add appeal evidence on the dossier
            </Link>{" "}
            — or record a new dispute there; either supports an appeal.
          </p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {newItems.map((i) => (
              <label key={i.id} className="row small" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  disabled={!i.consentedAt}
                  checked={picked.includes(i.id)}
                  onChange={(e) =>
                    setPicked((p) =>
                      e.target.checked
                        ? [...p, i.id]
                        : p.filter((x) => x !== i.id),
                    )
                  }
                />
                <span className="tag">{i.evidenceId}</span>
                {i.declaredLabel || i.declaredClass.replaceAll("_", " ")}
                {!i.consentedAt ? (
                  <span className="chip chip-warn">
                    <span className="dot" />
                    needs consent first
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        )}

        <ErrorNotice error={error} />
        <button
          className="btn btn-primary"
          style={{ marginTop: 16 }}
          disabled={busy || !grounds.trim() || runsLeft <= 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/api/assessments/${id}/appeal`, {
                method: "POST",
                body: JSON.stringify({ grounds, newEvidenceIds: picked }),
              });
              router.push(`/assessments/${id}`);
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : "File the appeal"}
        </button>
      </div>
    </section>
  );
}
