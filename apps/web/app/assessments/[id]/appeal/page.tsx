"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { evidenceClassLabel, plural, statePhrase } from "../../../../lib/present";
import { api } from "../../../components/api";
import {
  Chip,
  Empty,
  ErrorNotice,
  IdTag,
  Loading,
  PageError,
  Spinner,
} from "../../../components/bits";

interface Detail {
  id: string;
  state: string;
  myRole: "SELLER" | "BUYER";
  maxRuns: number | null;
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

  if (error && !detail) return <PageError error={error} />;
  if (!detail) return <Loading />;

  const successRuns = detail.runs.filter((r) => r.status === "SUCCESS").length;
  // The limit is the contract's. When it could not be read, say nothing
  // about it rather than print a number the chain might not honour.
  const runsLeft =
    detail.maxRuns === null ? null : Math.max(0, detail.maxRuns - successRuns);
  const newItems = detail.evidenceItems.filter((i) => !i.onChainTxHash);

  if (detail.state !== "ADJUDICATED") {
    return (
      <section className="section" style={{ maxWidth: 680, margin: "0 auto" }}>
        <Empty>
          An appeal needs a standing verdict, and this assessment is{" "}
          {statePhrase(detail.state)}.
        </Empty>
      </section>
    );
  }

  return (
    <section className="section" style={{ maxWidth: 680, margin: "0 auto" }}>
      <h2>Appeal the verdict</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        An appeal re-judges the <em>recorded</em> evidence — exactly what the
        first panel read, straight from the contract&apos;s own storage — plus
        anything new, clearly marked as arriving after the outcome was known.
        Earlier runs stay on the record.
      </p>
      {runsLeft !== null ? (
        <p className="fine" style={{ marginTop: 8 }}>
          {runsLeft === 0
            ? `This record already holds the ${detail.maxRuns} runs the contract allows.`
            : `${plural(runsLeft, "run")} left of the ${detail.maxRuns} the contract allows.`}
        </p>
      ) : null}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="field">
          <label htmlFor="grounds">Grounds for the appeal</label>
          <textarea
            id="grounds"
            rows={4}
            maxLength={1200}
            value={grounds}
            onChange={(e) => setGrounds(e.target.value)}
            placeholder="An independent inspection found frame damage the history record missed."
          />
          <span className="hint spread">
            <span>On the record, and shown to the panel as advocacy.</span>
            <span>{grounds.length.toLocaleString("en-US")} / 1,200</span>
          </span>
        </div>

        <h3 style={{ margin: "14px 0 10px" }}>New evidence to enter</h3>
        {newItems.length === 0 ? (
          <p className="muted small">
            Nothing new has been uploaded yet.{" "}
            <Link href={`/assessments/${id}`} className="link">
              Add appeal evidence to the record
            </Link>
            , or record a new dispute there; either supports an appeal.
          </p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {newItems.map((i) => (
              <label
                key={i.id}
                className="row small"
                style={{ cursor: i.consentedAt ? "pointer" : "default", gap: 10 }}
              >
                <input
                  type="checkbox"
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
                <IdTag>{i.evidenceId}</IdTag>
                <span>{i.declaredLabel || evidenceClassLabel(i.declaredClass)}</span>
                {!i.consentedAt ? <Chip tone="warn">Needs consent first</Chip> : null}
              </label>
            ))}
          </div>
        )}

        <ErrorNotice error={error} />
        <button
          className="btn btn-primary"
          style={{ marginTop: 18 }}
          disabled={busy || !grounds.trim() || runsLeft === 0}
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
