import { describe, expect, it } from "vitest";

import { actsFor, freshAppealItems, freshDisputes, roleOf, type Limits } from "../lib/acts";
import type { ItemSummary, RecordView } from "../lib/types";

const SELLER = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";

const LIMITS: Limits = {
  max_items_at_submission: 8,
  max_new_items_per_appeal: 4,
  max_evidence_items: 12,
  max_runs_per_assessment: 4,
  max_disputing_accounts: 8,
  anchor_allowlist: ["raw.githubusercontent.com"],
};

function item(id: string, patch: Partial<ItemSummary> = {}): ItemSummary {
  return {
    evidence_id: id,
    lane: "UPLOADED",
    phase: "SUBMISSION",
    status: "EXTRACTED",
    declared_class: "SERVICE_INVOICE",
    declared_label: "",
    uploader_account: SELLER,
    uploader_role: "SELLER",
    file_sha256: "a".repeat(64),
    text_sha256: "b".repeat(64),
    extractor_version: "extractor-1.0.0",
    ...patch,
  };
}

function record(patch: Partial<RecordView> = {}): RecordView {
  return {
    assessment_id: "ac-000001",
    state: "OPEN",
    vin: "1HGCM82633A004352",
    vin_check_digit_ok: true,
    identity_status: "CONFIRMED",
    registry_source: "NHTSA vPIC (US DOT)",
    registry_fields: {},
    make: "Honda",
    model: "Accord",
    year: 2003,
    seller_account: SELLER,
    seller_address: SELLER,
    claims: [{ claim_id: "CL-01", type: "MILEAGE", declared_value: "87,432 miles" }],
    packet_version: 0,
    runs_count: 0,
    items: [],
    disputes: [],
    ...patch,
  };
}

const act = (r: RecordView, account: string, id: string) => actsFor(r, LIMITS, account).find((a) => a.id === id)!;

describe("who the connected account is", () => {
  it("matches the seller whatever the address's case", () => {
    expect(roleOf(record(), SELLER.toUpperCase().replace("0X", "0x"))).toBe("SELLER");
  });

  it("makes a disputer or an uploader a party, and anyone else a visitor", () => {
    const r = record({ disputes: [{ account: BUYER, claim_ids: ["CL-01"], note: "", after_runs: 0, address: BUYER }] });
    expect(roleOf(r, BUYER)).toBe("PARTY");
    expect(roleOf(r, STRANGER)).toBe("VISITOR");
    expect(roleOf(r, "")).toBe("DISCONNECTED");
  });
});

describe("acts on an open record", () => {
  it("lets the seller seal only once there is something to judge", () => {
    expect(act(record(), SELLER, "seal").reason).toMatch(/at least one evidence item/);
    expect(act(record({ items: [item("E-001")] }), SELLER, "seal").available).toBe(true);
  });

  it("keeps the seal with the seller of record", () => {
    expect(act(record({ items: [item("E-001")] }), BUYER, "seal").reason).toMatch(/only the seller/);
  });

  it("lets anyone connected add evidence and sources, up to the contract's limit", () => {
    expect(act(record(), BUYER, "evidence").available).toBe(true);
    expect(act(record(), BUYER, "source").available).toBe(true);
    const full = record({ items: Array.from({ length: 8 }, (_, i) => item(`E-00${i + 1}`)) });
    expect(act(full, BUYER, "evidence").reason).toMatch(/8 items/);
    expect(act(full, BUYER, "source").reason).toMatch(/8 items/);
  });

  it("says so when the deployment allows no independent sources", () => {
    expect(actsFor(record(), { ...LIMITS, anchor_allowlist: [] }, SELLER).find((a) => a.id === "source")!.reason).toMatch(
      /no claim can be verified/,
    );
  });

  it("never lets the seller dispute their own claims", () => {
    expect(act(record(), SELLER, "dispute").reason).toMatch(/cannot dispute their own/);
    expect(act(record(), BUYER, "dispute").available).toBe(true);
  });

  it("asks a visitor with no wallet to connect rather than showing a dead button", () => {
    for (const id of ["evidence", "source", "dispute"]) expect(act(record(), "", id).reason).toMatch(/connect a wallet/);
  });

  it("stops a new disputer once the contract's account cap is reached", () => {
    const disputes = Array.from({ length: 8 }, (_, i) => ({
      account: `0x${String(i + 4).repeat(40)}`,
      claim_ids: ["CL-01"],
      note: "",
      after_runs: 0,
      address: "",
    }));
    expect(act(record({ disputes }), BUYER, "dispute").reason).toMatch(/8 disputing accounts/);
    expect(act(record({ disputes }), disputes[0]!.account, "dispute").available).toBe(true);
  });
});

describe("acts on a sealed record", () => {
  const sealed = record({ state: "SEALED", items: [item("E-001")], packet_version: 1 });

  it("lets anyone connected ask for the panel, and closes intake", () => {
    expect(act(sealed, STRANGER, "adjudicate").available).toBe(true);
    expect(act(sealed, SELLER, "evidence").reason).toMatch(/sealed/);
    expect(act(sealed, SELLER, "seal").reason).toMatch(/already sealed/);
  });
});

describe("acts after a verdict", () => {
  const judged = record({ state: "ADJUDICATED", items: [item("E-001")], packet_version: 1, runs_count: 1 });

  it("sends a re-judgment through an appeal, never a second adjudication", () => {
    expect(act(judged, SELLER, "adjudicate").reason).toMatch(/re-judgment is an appeal/);
  });

  it("needs something new before an appeal", () => {
    expect(act(judged, SELLER, "appeal").reason).toMatch(/new evidence or a new dispute/);
    const withItem = { ...judged, items: [...judged.items, item("E-002", { phase: "APPEAL", judged_version: 0 })] };
    expect(act(withItem, SELLER, "appeal").available).toBe(true);
    expect(freshAppealItems(withItem)).toHaveLength(1);
  });

  it("counts a dispute entered since the standing run as new, and an older one as not", () => {
    const old = { account: BUYER, claim_ids: ["CL-01"], note: "", after_runs: 0, address: BUYER };
    const fresh = { ...old, after_runs: 1 };
    expect(freshDisputes({ ...judged, disputes: [old] })).toHaveLength(0);
    expect(act({ ...judged, disputes: [old, fresh] }, BUYER, "appeal").available).toBe(true);
  });

  it("lets only a recorded party appeal", () => {
    const withItem = { ...judged, items: [...judged.items, item("E-002", { phase: "APPEAL", judged_version: 0, uploader_account: BUYER })] };
    expect(act(withItem, STRANGER, "appeal").reason).toMatch(/only a recorded party/);
    expect(act(withItem, BUYER, "appeal").available).toBe(true);
  });

  it("makes the verdict final at the contract's run limit, reading the limit rather than remembering it", () => {
    const capped = { ...judged, runs_count: 4, items: [...judged.items, item("E-002", { phase: "APPEAL", judged_version: 0 })] };
    expect(act(capped, SELLER, "appeal").reason).toMatch(/4 runs.*final/);
    expect(actsFor(capped, { ...LIMITS, max_runs_per_assessment: 5 }, SELLER).find((a) => a.id === "appeal")!.available).toBe(true);
  });

  it("caps new evidence per appeal", () => {
    const four = Array.from({ length: 4 }, (_, i) => item(`E-10${i}`, { phase: "APPEAL", judged_version: 0 }));
    expect(act({ ...judged, items: [...judged.items, ...four] }, SELLER, "evidence").reason).toMatch(/at most 4 new items/);
  });
});
