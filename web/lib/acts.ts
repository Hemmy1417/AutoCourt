/**
 * S40: what a visitor can do to a record, as a PURE function of the record
 * the contract returned, the contract's own limits and the connected
 * account. Every act the page offers comes from here, and an act this
 * function blocks is shown with its reason in words, never as a button that
 * fails. The contract enforces every rule again (every write is bound to the
 * wallet that signs it); this only stops a person paying a fee to be told no.
 */
import { sameAddress } from "./chain";
import type { ChainConfig, ItemSummary, RecordView } from "./types";

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
  | "max_seller_items_at_submission"
  | "max_other_items_at_submission"
  | "max_seller_items_per_appeal"
  | "max_other_items_per_appeal"
  | "max_evidence_items"
  | "max_runs_per_assessment"
  | "max_disputing_accounts"
  | "anchor_allowlist"
>;

/** Every wallet the contract counts as a party: seller, disputers, uploaders, source adders. */
export function recordedParties(record: RecordView): string[] {
  const parties = new Set<string>([record.seller_account.toLowerCase()]);
  for (const d of record.disputes) parties.add(d.account.toLowerCase());
  for (const i of record.items) {
    if (i.uploader_account) parties.add(i.uploader_account.toLowerCase());
    if (i.added_by) parties.add(i.added_by.toLowerCase());
  }
  return [...parties];
}

/** Who the connected account is to this record. */
export function roleOf(record: RecordView, account: string): Role {
  if (!account) return "DISCONNECTED";
  if (sameAddress(record.seller_account, account)) return "SELLER";
  return recordedParties(record).includes(account.toLowerCase()) ? "PARTY" : "VISITOR";
}

/** The seller, disputers, uploaders and source adders: who may ask for a judgment or appeal. */
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

const owner = (i: ItemSummary) => (i.uploader_account || i.added_by || "").toLowerCase();

/**
 * Intake slots are split by side, as the contract splits them: before sealing
 * the seller owns some and every other wallet shares the rest, and each
 * appeal splits its new slots the same way. The side is the connected
 * wallet's.
 */
export function sideSlots(record: RecordView, limits: Limits, account: string) {
  const isSeller = sameAddress(record.seller_account, account);
  const appeal = record.state === "ADJUDICATED";
  const cap = appeal
    ? isSeller
      ? limits.max_seller_items_per_appeal
      : limits.max_other_items_per_appeal
    : isSeller
      ? limits.max_seller_items_at_submission
      : limits.max_other_items_at_submission;
  const taken = record.items.filter(
    (i) =>
      (appeal ? i.phase === "APPEAL" && !i.judged_version : i.phase !== "APPEAL") &&
      (owner(i) === record.seller_account.toLowerCase()) === isSeller,
  ).length;
  return { isSeller, cap, taken, left: Math.max(0, cap - taken), appeal };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

function slotsFullReason(record: RecordView, limits: Limits, account: string): string | undefined {
  const s = sideSlots(record, limits, account);
  if (s.left > 0) return undefined;
  const when = s.appeal ? "per appeal" : "before sealing";
  return s.isSeller
    ? `the seller of record may enter at most ${plural(s.cap, "item", "items")} ${when}, and all are used`
    : `wallets other than the seller share ${plural(s.cap, "slot", "slots")} ${when}, and all are taken`;
}

export function actsFor(record: RecordView, limits: Limits, account: string): Act[] {
  const role = roleOf(record, account);
  const connected = role !== "DISCONNECTED";
  const party = role === "SELLER" || role === "PARTY";
  const { state } = record;
  const items = record.items.length;
  const runsLeft = limits.max_runs_per_assessment - record.runs_count;
  const appealItems = freshAppealItems(record).length;
  const acts: Act[] = [];

  // Evidence: before the seal, or after a verdict while an appeal is possible.
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
  else if (state === "ADJUDICATED" && !party)
    evidenceReason = "only a recorded party may add appeal evidence; dispute a claim first";
  else evidenceReason = slotsFullReason(record, limits, account);
  acts.push({
    id: "evidence",
    label: state === "ADJUDICATED" ? "Add appeal evidence" : "Add evidence",
    available: !evidenceReason,
    ...(evidenceReason ? { reason: evidenceReason } : {}),
  });

  // Independent sources enter before the seal only, on the adder's side.
  let sourceReason: string | undefined;
  if (state !== "OPEN") sourceReason = "independent sources can only enter before the packet is sealed";
  else if (limits.anchor_allowlist.length === 0)
    sourceReason = "this deployment allows no independent sources, so no claim can be verified here";
  else if (items >= limits.max_items_at_submission)
    sourceReason = `the record already holds the ${limits.max_items_at_submission} items allowed before sealing`;
  else if (!connected) sourceReason = "connect a wallet to add an independent source";
  else sourceReason = slotsFullReason(record, limits, account);
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

  // Seal: only the seller of record closes intake, once there is something to judge.
  let sealReason: string | undefined;
  if (state !== "OPEN") sealReason = "the packet is already sealed";
  else if (!connected) sealReason = "connect the seller's wallet to seal the packet";
  else if (role !== "SELLER") sealReason = "only the seller of record can seal the packet";
  else if (items === 0) sealReason = "add at least one evidence item first";
  acts.push({
    id: "seal",
    label: "Seal the packet",
    available: !sealReason,
    ...(sealReason ? { reason: sealReason } : {}),
  });

  // Adjudication: a recorded party asks the panel to judge a sealed packet.
  let adjudicateReason: string | undefined;
  if (state === "OPEN") adjudicateReason = "the packet must be sealed first";
  else if (state === "ADJUDICATED") adjudicateReason = "a verdict already stands; a re-judgment is an appeal";
  else if (!connected) adjudicateReason = "connect a wallet to request adjudication";
  else if (!party)
    adjudicateReason = "only a recorded party may request adjudication: the seller, a disputer, or someone who added evidence";
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
  else if (!party)
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
