"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { humanize, sentence, stateLabel, verdictLabel } from "../../lib/present";

/** Verdict → chip. The ONLY place verdict hues appear. */
const VERDICT_TONE: Record<string, string> = {
  VERIFIED: "chip-ok",
  PARTIALLY_VERIFIED: "chip-warn",
  CLAIM_CONTRADICTED: "chip-bad",
  CONFLICTING_EVIDENCE: "chip-warn",
  INSUFFICIENT_EVIDENCE: "chip-dim",
  PHYSICAL_INSPECTION_REQUIRED: "chip-info",
  INCONCLUSIVE: "chip-dim",
  MATERIAL_CONCERN: "chip-bad",
  MILEAGE_CONFLICT: "chip-warn",
  POSSIBLE_ODOMETER_ROLLBACK: "chip-bad",
  DIAGNOSTIC_CONCERN_SUPPORTED: "chip-warn",
  SOURCE_UNAVAILABLE: "chip-dim",
};

export function VerdictChip({ verdict, large }: { verdict: string; large?: boolean }) {
  return (
    <span className={`chip ${VERDICT_TONE[verdict] ?? "chip-dim"}${large ? " chip-lg" : ""}`}>
      <span className="dot" />
      {verdictLabel(verdict)}
    </span>
  );
}

/** A plain status chip for anything that is not a verdict. */
export function Chip({
  tone,
  children,
  title,
}: {
  tone: "ok" | "warn" | "bad" | "info" | "dim" | "signal";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      <span className="dot" />
      {children}
    </span>
  );
}

const STATE_TONE: Record<string, "signal" | "info" | "ok"> = {
  OPEN: "signal",
  SEALED: "info",
  ADJUDICATED: "ok",
};

export function StateChip({ state }: { state: string }) {
  return <Chip tone={STATE_TONE[state] ?? "info"}>{stateLabel(state)}</Chip>;
}

const JOURNEY = ["OPEN", "SEALED", "ADJUDICATED"] as const;

/** The record's lifecycle, visible end to end. */
export function Journey({ state }: { state: string }) {
  const idx = JOURNEY.indexOf(state as never);
  return (
    <ol className="journey">
      {JOURNEY.map((s, i) => (
        <li
          key={s}
          className={`journey-step ${i < idx || (i === idx && s === "ADJUDICATED") ? "done" : i === idx ? "now" : ""}`}
        >
          <span className="knot" aria-hidden>
            {i < idx || (i === idx && s === "ADJUDICATED") ? "✓" : i + 1}
          </span>
          {stateLabel(s)}
        </li>
      ))}
    </ol>
  );
}

export function CopyText({ value, short }: { value: string; short?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copyable"
      title={value}
      aria-label={`Copy ${value}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "Copied" : (short ?? value)}
    </button>
  );
}

/** A short identifier the record itself uses: an evidence item or a claim. */
export function IdTag({ children }: { children: ReactNode }) {
  return <span className="idtag">{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <span className="spin" aria-label="Working" role="status" />;
}

export function Loading() {
  return (
    <div className="row" style={{ justifyContent: "center", padding: 60 }}>
      <Spinner />
    </div>
  );
}

/**
 * Errors reach people as sentences. A machine tag or a code constant that
 * slips into a message is removed or humanized rather than shown.
 */
export function errorWords(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const msg = raw
    .replace(/^\[[A-Z_]+\]\s*/, "")
    .replace(/\b[A-Z]{2,}(?:_[A-Z]+)+\b/g, (c) => humanize(c).toLowerCase());
  return sentence(msg || "Something did not work");
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="notice notice-bad" role="alert">
      {errorWords(error)}
    </div>
  );
}

/** A page that could not load at all gets a page: what happened, and the one way forward. */
export function PageError({ error, notFound }: { error?: unknown; notFound?: boolean }) {
  const here = typeof window === "undefined" ? "/assessments" : window.location.pathname;
  return (
    <section className="section" style={{ maxWidth: 560, margin: "0 auto" }}>
      <div className="card" style={{ padding: 32, textAlign: "center" }}>
        {notFound ? (
          <>
            <h2>Nothing here</h2>
            <p className="muted" style={{ marginTop: 10 }}>
              The contract holds no record by this number.
            </p>
            <Link className="btn btn-primary" style={{ marginTop: 20 }} href="/assessments">
              Browse the records
            </Link>
          </>
        ) : (
          <>
            <h2>This page could not load</h2>
            <ErrorNotice error={error} />
            <a className="btn btn-primary" style={{ marginTop: 20 }} href={here}>
              Try again
            </a>
          </>
        )}
      </div>
    </section>
  );
}

/** The publicity statement, verbatim. One source. */
export const PUBLICITY_STATEMENT =
  "Evidence on AutoCourt is public. Publishing an item writes, permanently, " +
  "to a public blockchain: its bounded text extract after your redactions, " +
  "your declared label and readings, both fingerprints and your signature " +
  "over them. The panel's findings and quotes are public too. Original files " +
  "never leave your browser; only their fingerprints go on chain. Redact " +
  "before you publish, because nothing on the chain can be removed afterwards.";
