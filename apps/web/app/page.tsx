import Link from "next/link";

import { Logo } from "./components/Logo";

// Screen 1 — landing. Marketplace-warm, verdict-serious.
export default function Landing() {
  return (
    <>
      <section className="section" style={{ paddingTop: 72 }}>
        <div style={{ maxWidth: 720 }}>
          <span className="chip chip-signal" style={{ marginBottom: 18 }}>
            <span className="dot" />
            used-vehicle claims, adjudicated
          </span>
          <h1 style={{ marginTop: 14 }}>
            Buy the car,
            <br />
            not the story.
          </h1>
          <p
            className="muted"
            style={{ fontSize: 19, marginTop: 18, maxWidth: 560 }}
          >
            A seller declares the claims. Evidence goes on the record — both
            sides. A validator panel judges it, and deterministic public code
            derives every verdict. Nobody, including us, gets to author the
            outcome.
          </p>
          <div className="row" style={{ marginTop: 28 }}>
            <Link href="/auth" className="btn btn-primary">
              Start an assessment
            </Link>
            <Link href="/auth" className="btn btn-ghost">
              I was sent a report
            </Link>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 12 }}>
        <div className="grid grid-3">
          {[
            {
              t: "Claims, not vibes",
              d: "Mileage, accident history, condition, defects, service history — each declared value is judged claim by claim, never rolled into a score.",
            },
            {
              t: "Evidence enters a record",
              d: "Every document is hashed at entry; the judged text lives on a public chain, byte-identical for every validator. A later appeal re-reads exactly those bytes.",
            },
            {
              t: "Floors, in code",
              d: "A claim backed only by the seller's own paperwork can't reach VERIFIED. An accusation resting only on the accuser's uploads can't become CONTRADICTED. The floors are code, not policy.",
            },
            {
              t: "Honest outcomes",
              d: "Insufficient, conflicting, inspection-required — when the record can't decide, the verdict says so instead of pretending.",
            },
            {
              t: "Appeals that mean something",
              d: "New evidence opens a new run over the recorded bytes plus the new items, clearly tagged. Prior runs are immutable.",
            },
            {
              t: "Check us, don't trust us",
              d: "Intake receipts show your items in the judged manifest. Every run, hash, and refusal is on the public explorer.",
            },
          ].map((f) => (
            <div key={f.t} className="card">
              <h3>{f.t}</h3>
              <p className="muted small" style={{ marginTop: 8 }}>
                {f.d}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="card" style={{ padding: 36 }}>
          <div className="spread" style={{ flexWrap: "wrap", gap: 20 }}>
            <div style={{ maxWidth: 520 }}>
              <h2>How a verdict happens</h2>
              <p className="muted" style={{ marginTop: 10 }}>
                Five steps, each one on the record.
              </p>
            </div>
            <Logo size={56} />
          </div>
          <div className="divider" />
          <ol
            style={{
              display: "grid",
              gap: 14,
              margin: 0,
              paddingLeft: 22,
              fontSize: 15.5,
            }}
          >
            <li>
              <b>List the vehicle.</b> VIN is code-validated; claims carry the
              seller&apos;s declared values.
            </li>
            <li>
              <b>Build the record.</b> Uploads are hashed and extracted;
              buyers add counter-evidence and dispute specific claims.
            </li>
            <li>
              <b>Consent and submit.</b> Adjudicated text becomes public,
              permanently — each item needs your explicit consent, and
              redaction happens before, never after.
            </li>
            <li>
              <b>The panel judges.</b> Validators read the same recorded
              bytes and must agree on every finding; code derives the
              verdicts, confidence, and next actions.
            </li>
            <li>
              <b>Share, or appeal.</b> A share link shows the buyer the same
              derived report; new evidence opens a new, tagged run.
            </li>
          </ol>
        </div>
      </section>
    </>
  );
}
