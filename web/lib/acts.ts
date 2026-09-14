/**
 * S40: what a visitor can do to a record, as a PURE function of the record
 * the contract returned, the contract's own limits and the connected
 * account. Every act the page offers comes from here, and an act this
 * function blocks is shown with its reason in words, never as a button that
 * fails. The contract enforces every rule again; this only stops a person
 * from paying a fee to be told no.
 */
import { sameAddress } from "./chain";
import type { ChainConfig, RecordView } from "./types";

export type Role = "SELLER" | "PARTY" | "VISITOR" | "DISCONNECTED";

export type ActId = "evidence" | "source" | "dispute" | "seal" | "adjudicate" | "appeal";

export interface Act {
  id: ActId;
  label: string;
  available: boolean;
  /** When unavailable: the reason, in words. */
  reason?: string;
}

/** Limits the acts depend on; each comes from get_config, never from memory. */
export type Limits = Pick<
  ChainConfig,
  | "max_items_at_submission"
  | "max_new_items_per_appeal"
  | "max_evidence_items"
  | "max_runs_per_assessment"
  | "max_disputing_accounts"
  | "anchor_allowlist"
>;

/** Who the connected account is to this record. */
export function roleOf(record: RecordView, account: string): Role {
  if (!account) return "DISCONNECTED";
  if (sameAddress(record.seller_account, account)) return "SELLER";
  const party =
    record.disputes.some((d) => sameAddress(d.account, account)) ||
    record.items.some((i) => i.uploader_account && sameAddress(i.uploader_account, account));
  return party ? "PARTY" : "VISITOR";
}

/** Accounts the contract accepts as appellants: the seller, disputers and uploaders. */
export function isRecordedParty(record: RecordView, account: string): boolean {
  const role = roleOf(record, account);
  return role === "SELLER" || role === "PARTY";
}

/** Post-verdict items no panel has judged yet. */
export function freshAppealItems(record: RecordView) {
  return record.items.filter((i) => i.phase === "APPEAL" && !i.judged_version);
}

/** Disputes entered since the standing run. */
export function freshDisputes(record: RecordView) {
  return record.disputes.filter((d) => d.after_runs >= record.runs_count);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function actsFor(record: RecordView, limits: Limits, account: string): Act[] {
  const role = roleOf(record, account);
  const connected = role !== "DISCONNECTED";
  const { state } = record;
  const items = record.items.length;
  const runsLeft = limits.max_runs_per_assessment - record.runs_count;
  const acts: Act[] = [];

  // Evidence: before the seal, or after a verdict while an appeal is possible.
  const appealItems = freshAppealItems(record).length;
  let evidenceReason: string | undefined;
  if (state === "SEALED") evidenceReason = "the packet is sealed while it waits for the panel";
  else if (state === "OPEN" && items >= limits.max_items_at_submission)
    evidenceReason = `the record already holds the ${limits.max_items_at_submission} items allowed before sealing`;
  else if (state === "ADJUDICATED" && runsLeft <= 0)
    evidenceReason = `the record holds the ${limits.max_runs_per_assessment} runs the contract allows, so no appeal can use new evidence`;
  else if (state === "ADJUDICATED" && appealItems >= limits.max_new_items_per_appeal)
    evidenceReason = `an appeal carries at most ${plural(limits.max_new_items_per_appeal, "new item", "new items")}`;
  else if (state === "ADJUDICATED" && items >= limits.max_evidence_items)
    evidenceReason = `the record holds the ${limits.max_evidence_items} items the contract allows`;
  else if (!connected) evidenceReason = "connect a wallet to add evidence in your own name";
  acts.push({
    id: "evidence",
    label: state === "ADJUDICATED" ? "Add appeal evidence" : "Add evidence",
    available: !evidenceReason,
    ...(evidenceReason ? { reason: evidenceReason } : {}),
  });

  // Independent sources enter before the seal only.
  let sourceReason: string | undefined;
  if (state !== "OPEN") sourceReason = "independent sources can only enter before the packet is sealed";
  else if (limits.anchor_allowlist.length === 0)
    sourceReason = "this deployment allows no independent sources, so no claim can be verified here";
  else if (items >= limits.max_items_at_submission)
    sourceReason = `the record already holds the ${limits.max_items_at_submission} items allowed before sealing`;
  else if (!connected) sourceReason = "connect a wallet to add an independent source";
  acts.push({
    id: "source",
    label: "Add an independent source",
    available: !sourceReason,
    ...(sourceReason ? { reason: sourceReason } : {}),
  });

  // Disputes: anyone but the seller of record, while the account cap allows.
  const disputers = new Set(record.disputes.map((d) => d.account.toLowerCase()));
  let disputeReason: string | undefined;
  if (!connected) disputeReason = "connect a wallet to dispute a claim in your own name";
  else if (role === "SELLER") disputeReason = "the seller of record cannot dispute their own claims";
  else if (!disputers.has(account.toLowerCase()) && disputers.size >= limits.max_disputing_accounts)
    disputeReason = `the record already holds the ${limits.max_disputing_accounts} disputing accounts it allows`;
  acts.push({
    id: "dispute",
    label: "Dispute a claim",
    available: !disputeReason,
    ...(disputeReason ? { reason: disputeReason } : {}),
  });

  // Seal: the seller closes intake once there is something to judge.
  let sealReason: string | undefined;
  if (state !== "OPEN") sealReason = "the packet is already sealed";
  else if (!connected) sealReason = "connect the seller's wallet to seal the packet";
  else if (role !== "SELLER") sealReason = "only the seller of record seals the packet";
  else if (items === 0) sealReason = "add at least one evidence item first";
  acts.push({
    id: "seal",
    label: "Seal the packet",
    available: !sealReason,
    ...(sealReason ? { reason: sealReason } : {}),
  });

  // Adjudication: anyone may ask the panel to judge a sealed packet.
  let adjudicateReason: string | undefined;
  if (state === "OPEN") adjudicateReason = "the packet must be sealed first";
  else if (state === "ADJUDICATED") adjudicateReason = "a verdict already stands; a re-judgment is an appeal";
  else if (!connected) adjudicateReason = "connect a wallet to request adjudication";
  acts.push({
    id: "adjudicate",
    label: "Request adjudication",
    available: !adjudicateReason,
    ...(adjudicateReason ? { reason: adjudicateReason } : {}),
  });

  // Appeal: a recorded party, with something new on the record, while runs remain.
  let appealReason: string | undefined;
  if (state !== "ADJUDICATED") appealReason = "an appeal needs a standing verdict";
  else if (runsLeft <= 0) appealReason = `the record holds the ${limits.max_runs_per_assessment} runs the contract allows, so this verdict is final`;
  else if (!connected) appealReason = "connect a wallet to appeal";
  else if (!isRecordedParty(record, account))
    appealReason = "only a recorded party may appeal: the seller, a disputer, or someone who added evidence";
  else if (appealItems === 0 && freshDisputes(record).length === 0)
    appealReason = "an appeal needs new evidence or a new dispute on the record";
  acts.push({
    id: "appeal",
    label: "Appeal the verdict",
    available: !appealReason,
    ...(appealReason ? { reason: appealReason } : {}),
  });

  return acts;
}
