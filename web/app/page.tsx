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
            Used-vehicle claims, adjudicated
          </span>
          <h1 style={{ marginTop: 14 }}>
            Buy the car,
            <br />
            not the story.
          </h1>
          <p className="muted" style={{ fontSize: 19, marginTop: 18, maxWidth: 560 }}>
            A seller declares the claims. Evidence goes on the record — both sides. A validator panel
            judges it, and deterministic public code derives every verdict. Nobody, including us, gets
            to author the outcome.
          </p>
          <div className="row" style={{ marginTop: 28, flexWrap: "wrap" }}>
            <Link href="/assessments/new" className="btn btn-primary">
              Start an assessment
            </Link>
            <Link href="/assessments" className="btn btn-ghost">
              Browse the records
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
              d: "Every document is fingerprinted in your browser and signed by your wallet; its judged text lives on a public chain, byte-identical for every validator. An appeal re-reads exactly those bytes.",
            },
            {
              t: "Floors, in code",
              d: "A claim backed only by the seller's own paperwork can never be marked verified, and an accusation resting only on the accuser's uploads can never mark it contradicted. The floors are code, not policy.",
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
              d: "There is no server holding your record: this page reads the contract directly, and every run, fingerprint and refusal is on the public explorer.",
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
                Five steps, each one a transaction your wallet signs.
              </p>
            </div>
            <Logo size={56} />
          </div>
          <div className="divider" />
          <ol style={{ display: "grid", gap: 14, margin: 0, paddingLeft: 22, fontSize: 15.5 }}>
            <li>
              <b>List the vehicle.</b> The VIN is checked in code, and every validator decodes it at
              the public federal registry before the record exists.
            </li>
            <li>
              <b>Build the record.</b> Documents are read, redacted and fingerprinted in your browser;
              buyers add counter-evidence and dispute specific claims in their own name.
            </li>
            <li>
              <b>Publish, then seal.</b> Each item is public the moment you sign it, so redaction
              happens before, never after. The seller seals the packet when it is complete.
            </li>
            <li>
              <b>The panel judges.</b> Validators read the same recorded bytes and must agree on every
              finding; code derives the verdicts, confidence and next actions.
            </li>
            <li>
              <b>Share, or appeal.</b> The record is public, so a link to it is the report; new
              evidence opens a new, tagged run.
            </li>
          </ol>
          <p className="fine" style={{ marginTop: 18 }}>
            AutoCourt runs on GenLayer Studio Next, a test network. The wallet menu gives any
            connected wallet test GEN for fees.
          </p>
        </div>
      </section>
    </>
  );
}
