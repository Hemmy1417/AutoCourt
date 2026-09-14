"use client";

import { useState, type ReactNode } from "react";

import {
  humanize,
  sentence,
  stateLabel,
  verdictLabel,
} from "../../lib/present";

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

export function VerdictChip({
  verdict,
  large,
}: {
  verdict: string;
  large?: boolean;
}) {
  return (
    <span
      className={`chip ${VERDICT_TONE[verdict] ?? "chip-dim"}${large ? " chip-lg" : ""}`}
    >
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

const STATE_TONE: Record<string, "dim" | "signal" | "ok" | "bad"> = {
  DRAFT: "dim",
  SUBMITTED: "signal",
  PROCESSING: "signal",
  ADJUDICATED: "ok",
  FAILED: "bad",
};

export function StateChip({ state }: { state: string }) {
  return <Chip tone={STATE_TONE[state] ?? "dim"}>{stateLabel(state)}</Chip>;
}

const JOURNEY = ["DRAFT", "SUBMITTED", "PROCESSING", "ADJUDICATED"] as const;

/** The assessment lifecycle, visible end to end (screen 8's spine). */
export function Journey({ state }: { state: string }) {
  const idx = state === "FAILED" ? 2 : JOURNEY.indexOf(state as never);
  return (
    <ol className="journey">
      {JOURNEY.map((s, i) => (
        <li
          key={s}
          className={`journey-step ${
            i < idx ? "done" : i === idx ? (state === "FAILED" ? "failed" : "now") : ""
          }`}
        >
          <span className="knot" aria-hidden>
            {i < idx ? "✓" : state === "FAILED" && i === idx ? "!" : i + 1}
          </span>
          {s === "PROCESSING" && state === "FAILED"
            ? stateLabel("FAILED")
            : stateLabel(s)}
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
 * Errors reach people as sentences. API messages are written in lower
 * case for composition; a code constant that slips into one is humanized
 * rather than shown.
 */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const raw =
    error instanceof Error ? error.message : String(error ?? "Something went wrong");
  const msg = raw
    .replace(/^\[[A-Z_]+\]\s*/, "")
    .replace(/\b[A-Z]{2,}(?:_[A-Z]+)+\b/g, (c) => humanize(c).toLowerCase());
  return (
    <div className="notice notice-bad" role="alert">
      {sentence(msg)}
    </div>
  );
}

/**
 * A page that could not load at all gets a page, not a stray red line:
 * what happened in plain words, and the one way forward.
 */
export function PageError({ error }: { error: unknown }) {
  const status = (error as { status?: number } | null)?.status;
  const here =
    typeof window === "undefined" ? "/dashboard" : window.location.pathname;
  const [title, body, action] =
    status === 401
      ? ["Sign in to continue", "This page belongs to a record, and records are opened with your wallet.", { href: `/auth?next=${encodeURIComponent(here)}`, label: "Connect wallet" }]
      : status === 403
        ? ["This record is not shared with you", "Only the seller and the buyers they share it with can open it.", { href: "/dashboard", label: "Back to your assessments" }]
        : status === 404
          ? ["Nothing here", "This record does not exist, or it was never on your account.", { href: "/dashboard", label: "Back to your assessments" }]
          : ["This page could not load", "", { href: here, label: "Try again" }];
  return (
    <section className="section" style={{ maxWidth: 560, margin: "0 auto" }}>
      <div className="card" style={{ padding: 32, textAlign: "center" }}>
        <h2>{title}</h2>
        {body ? (
          <p className="muted" style={{ marginTop: 10 }}>
            {body}
          </p>
        ) : (
          <ErrorNotice error={error} />
        )}
        <a className="btn btn-primary" style={{ marginTop: 20 }} href={action.href}>
          {action.label}
        </a>
      </div>
    </section>
  );
}

/** The publicity statement, verbatim (ARCHITECTURE §8.2). One source. */
export const PUBLICITY_STATEMENT =
  "Adjudicated evidence is public. Submitting an assessment publishes, " +
  "permanently, on a public blockchain: the bounded normalized text " +
  "extract of every packet item, the claim values, both hashes, and the " +
  "panel's findings and quotes. Original files are never published — " +
  "they remain in access-controlled app storage; only their sha256 " +
  "fingerprints go on-chain. Private-by-default means: private until " +
  "included in a submitted packet; inclusion is an explicit per-item " +
  "consented act; redaction must happen before submission and is " +
  "impossible after.";
