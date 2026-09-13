"use client";

import { useState, type ReactNode } from "react";

/** Verdict → chip. The ONLY place verdict hues appear. */
const VERDICT_CHIP: Record<string, { cls: string; label?: string }> = {
  VERIFIED: { cls: "chip-ok" },
  PARTIALLY_VERIFIED: { cls: "chip-warn", label: "PARTIALLY VERIFIED" },
  CLAIM_CONTRADICTED: { cls: "chip-bad", label: "CONTRADICTED" },
  CONFLICTING_EVIDENCE: { cls: "chip-warn", label: "CONFLICTING EVIDENCE" },
  INSUFFICIENT_EVIDENCE: { cls: "chip-dim", label: "INSUFFICIENT EVIDENCE" },
  PHYSICAL_INSPECTION_REQUIRED: {
    cls: "chip-info",
    label: "INSPECTION REQUIRED",
  },
  INCONCLUSIVE: { cls: "chip-dim" },
  MATERIAL_CONCERN: { cls: "chip-bad", label: "MATERIAL CONCERN" },
  MILEAGE_CONFLICT: { cls: "chip-warn", label: "MILEAGE CONFLICT" },
  POSSIBLE_ODOMETER_ROLLBACK: {
    cls: "chip-bad",
    label: "POSSIBLE ODOMETER ROLLBACK",
  },
  DIAGNOSTIC_CONCERN_SUPPORTED: {
    cls: "chip-warn",
    label: "DIAGNOSTIC CONCERN",
  },
  SOURCE_UNAVAILABLE: { cls: "chip-dim", label: "SOURCE UNAVAILABLE" },
  REJECTED: { cls: "chip-dim" },
};

export function VerdictChip({ verdict }: { verdict: string }) {
  const spec = VERDICT_CHIP[verdict] ?? { cls: "chip-dim" };
  return (
    <span className={`chip ${spec.cls}`}>
      <span className="dot" />
      {spec.label ?? verdict.replaceAll("_", " ")}
    </span>
  );
}

export function StateChip({ state }: { state: string }) {
  const map: Record<string, string> = {
    DRAFT: "chip-dim",
    SUBMITTED: "chip-signal",
    PROCESSING: "chip-signal",
    ADJUDICATED: "chip-ok",
    FAILED: "chip-bad",
  };
  return (
    <span className={`chip ${map[state] ?? "chip-dim"}`}>
      <span className="dot" />
      {state}
    </span>
  );
}

const JOURNEY = ["DRAFT", "SUBMITTED", "PROCESSING", "ADJUDICATED"] as const;

/** The assessment lifecycle, visible end to end (screen 8's spine). */
export function Journey({ state }: { state: string }) {
  const idx = state === "FAILED" ? 2 : JOURNEY.indexOf(state as never);
  return (
    <div className="journey">
      {JOURNEY.map((s, i) => (
        <span key={s} style={{ display: "contents" }}>
          {i > 0 && <span className="journey-link" />}
          <span
            className={`journey-step ${
              i < idx ? "done" : i === idx ? "now" : ""
            }`}
          >
            <span className="knot">{i < idx ? "✓" : i + 1}</span>
            {s === "PROCESSING" && state === "FAILED" ? "FAILED" : s}
          </span>
        </span>
      ))}
    </div>
  );
}

export function CopyText({ value, short }: { value: string; short?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      className="copyable"
      title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "copied ✓" : (short ?? value)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <span className="spin" aria-label="working" />;
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const msg =
    error instanceof Error ? error.message : String(error ?? "failed");
  return <div className="notice notice-bad">{msg}</div>;
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
