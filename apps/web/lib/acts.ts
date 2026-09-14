/**
 * S40: act availability as a PURE function of (record, role, state) — its
 * own test file, no browser, no chain. Every act the UI can offer comes
 * from here; an act this function blocks is LISTED with its reason in
 * words, never rendered as a button that fails.
 */

export type Role = "SELLER" | "BUYER";

export interface ActsInput {
  state: string; // DRAFT | SUBMITTED | PROCESSING | ADJUDICATED | FAILED
  role: Role;
  evidenceCount: number;
  unconsentedCount: number;
  successRuns: number;
  maxRuns: number;
  newAppealEvidenceCount: number; // uploaded post-verdict, not yet on-chain
  freshDisputeCount: number;
  /** Anchors whose every-validator fetch has not landed yet. */
  pendingAnchorCount: number; // recorded after the latest success run
  hasOnChainId: boolean;
  /** A submission step (create, evidence, seal) failed for good. */
  sealFailed?: boolean;
}

export interface Act {
  id:
    | "upload"
    | "redact"
    | "consent"
    | "dispute"
    | "submit"
    | "adjudicate"
    | "appeal"
    | "retry"
    | "share";
  label: string;
  available: boolean;
  /** When unavailable: the reason, in words. */
  reason?: string;
}

export function actsFor(input: ActsInput): Act[] {
  const {
    state,
    role,
    evidenceCount,
    unconsentedCount,
    successRuns,
    maxRuns,
    newAppealEvidenceCount,
    freshDisputeCount,
    pendingAnchorCount,
  } = input;
  const acts: Act[] = [];
  const runsLeft = maxRuns - successRuns;

  const uploadOpen = state === "DRAFT" || state === "ADJUDICATED";
  acts.push({
    id: "upload",
    label: state === "ADJUDICATED" ? "Add appeal evidence" : "Add evidence",
    available: uploadOpen,
    ...(uploadOpen
      ? {}
      : {
          reason:
            state === "PROCESSING" || state === "SUBMITTED"
              ? "the packet is sealed while adjudication is pending"
              : "this assessment is not accepting evidence right now",
        }),
  });

  acts.push({
    id: "redact",
    label: "Redact before submission",
    available: state === "DRAFT" && evidenceCount > 0,
    ...(state !== "DRAFT"
      ? { reason: "redaction must happen before submission and is impossible after" }
      : evidenceCount === 0
        ? { reason: "nothing uploaded yet" }
        : {}),
  });

  acts.push({
    id: "consent",
    label: "Consent items for the packet",
    available: uploadOpen && unconsentedCount > 0,
    ...(unconsentedCount === 0 && evidenceCount > 0
      ? { reason: "every item is consented" }
      : evidenceCount === 0
        ? { reason: "nothing uploaded yet" }
        : {}),
  });

  acts.push({
    id: "dispute",
    label: "Dispute a claim",
    available: role === "BUYER",
    ...(role !== "BUYER"
      ? { reason: "the seller of record cannot dispute their own claims" }
      : {}),
  });

  const submitOk =
    role === "SELLER" &&
    state === "DRAFT" &&
    evidenceCount > 0 &&
    unconsentedCount === 0 &&
    pendingAnchorCount === 0;
  acts.push({
    id: "submit",
    label: "Submit for adjudication",
    available: submitOk,
    ...(role !== "SELLER"
      ? { reason: "only the seller submits the assessment" }
      : state !== "DRAFT"
        ? { reason: "this assessment has already been submitted" }
        : evidenceCount === 0
          ? { reason: "add at least one evidence item first" }
          : unconsentedCount > 0
            ? {
                reason:
                  unconsentedCount === 1
                    ? "1 item still needs the publicity consent"
                    : `${unconsentedCount} items still need the publicity consent`,
              }
            : pendingAnchorCount > 0
              ? {
                  reason: `${
                    pendingAnchorCount === 1
                      ? "an independent source is"
                      : `${pendingAnchorCount} independent sources are`
                  } still entering the record — validators must agree on the bytes they fetched before the packet can be sealed`,
                }
              : {}),
  });

  const sealFailed = state === "SUBMITTED" && Boolean(input.sealFailed);
  acts.push({
    id: "adjudicate",
    label: "Request adjudication",
    available: state === "SUBMITTED" && !sealFailed,
    ...(sealFailed
      ? { reason: "the packet could not be sealed, so there is nothing for the panel to judge" }
      : state === "SUBMITTED"
      ? {}
      : state === "PROCESSING"
        ? { reason: "an adjudication is already in flight" }
        : state === "DRAFT"
          ? { reason: "submit the packet first" }
          : state === "ADJUDICATED"
            ? { reason: "a verdict already stands; a re-judgment is an appeal" }
            : { reason: "retry the failed attempt instead" }),
  });

  const appealOk =
    state === "ADJUDICATED" &&
    runsLeft > 0 &&
    (newAppealEvidenceCount > 0 || freshDisputeCount > 0);
  acts.push({
    id: "appeal",
    label: "Appeal the verdict",
    available: appealOk,
    ...(state !== "ADJUDICATED"
      ? { reason: "an appeal needs a standing verdict" }
      : runsLeft <= 0
        ? { reason: `the record holds at most ${maxRuns} runs` }
        : newAppealEvidenceCount === 0 && freshDisputeCount === 0
          ? { reason: "an appeal needs new evidence or a new dispute on the record" }
          : {}),
  });

  acts.push({
    id: "retry",
    label: "Retry adjudication",
    available: state === "FAILED",
    ...(state !== "FAILED" ? { reason: "nothing failed" } : {}),
  });

  acts.push({
    id: "share",
    label: "Share with a buyer",
    available: role === "SELLER",
    ...(role !== "SELLER" ? { reason: "only the seller shares" } : {}),
  });

  return acts;
}
