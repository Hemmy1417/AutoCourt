import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ANCHOR_FETCH_CAP, anchorStoredText, nhtsaRecallsUrl, renderedText } from "../lib/evidence/anchor";
import { sha256Text } from "../lib/evidence/hash";
import { PER_ITEM_TEXT_CAP } from "../lib/evidence/normalize";

const CONTRACT = readFileSync(new URL("../../contracts/autocourt_assessment.py", import.meta.url), "utf8");
const FIXTURE = readFileSync(new URL("../../fixtures/registry/1HGCM82633A004352.txt", import.meta.url), "utf8");

describe("the bytes a validator hashes for an independent source", () => {
  it("reproduces the digest every validator computed on chain", async () => {
    // ac-000023, tx 0x22790a41…f28f6: the registry extract committed at
    // 76a39ee. Every validator reached it and agreed on the second digest;
    // the app had committed the first (the raw file's), so the contract
    // entered the source SOURCE_UNAVAILABLE.
    expect(await sha256Text(FIXTURE)).toBe("83a9bc85009906d87faa1aa088c27cd80f91d5311a22ed9a8391fddb8a8fb0e3");
    expect(await sha256Text(renderedText(FIXTURE))).toBe(
      "4308ed17c2a6685ec1f1d9bc4c53c297882c8fe3c74d2b24f3566004f3682eb6",
    );
  });

  it("trims each line and collapses whitespace inside it, as GenVM's webdriver does", () => {
    expect(renderedText("  2026-03-07  \t 87,432 miles  \nnext")).toBe("2026-03-07 87,432 miles\nnext");
  });

  it("keeps one blank line and collapses longer runs", () => {
    expect(renderedText("a\n\nb\n\n\n\nc")).toBe("a\n\nb\n\nc");
    expect(renderedText("a\n   \n \nb")).toBe("a\n\nb");
  });

  it("treats CRLF and a lone CR as line breaks, as the browser's parser does", () => {
    expect(renderedText("a  b\r\nc\rd")).toBe("a b\nc\nd");
  });

  it("keeps a trailing newline, which the on-chain digest above includes", () => {
    expect(renderedText("done.\n")).toBe("done.\n");
  });

  it("leaves text with no runs of whitespace untouched, which is why earlier sources entered", () => {
    const plain = "EASTFIELD POLICE - ROAD TRAFFIC COLLISION REPORT\nDate of collision: 2026-09-05\n\nNo injuries reported.\n";
    expect(renderedText(plain)).toBe(plain);
  });

  it("caps by code point, as Python slices, never splitting a character", () => {
    const car = String.fromCodePoint(0x1f697); // two UTF-16 units
    const out = renderedText(car.repeat(ANCHOR_FETCH_CAP + 5));
    expect(Array.from(out)).toHaveLength(ANCHOR_FETCH_CAP);
    expect(out.length).toBe(ANCHOR_FETCH_CAP * 2);
  });

  it("stores the text the contract stores: Python's split, joined by single spaces", () => {
    expect(anchorStoredText("a\n\nb c\n")).toBe("a b c");
    // Python splits on the separator controls JavaScript's \s ignores…
    expect(anchorStoredText(`a${String.fromCharCode(0x1f)}b`)).toBe("a b");
    // …and keeps the byte-order mark JavaScript's \s would split on.
    const bom = String.fromCharCode(0xfeff);
    expect(anchorStoredText(`a${bom}b`)).toBe(`a${bom}b`);
  });

  it("caps where the contract caps", () => {
    const cap = (name: string) => Number(CONTRACT.match(new RegExp(`^${name} = ([\\d_]+)`, "m"))?.[1]?.replace(/_/g, ""));
    expect(cap("ANCHOR_FETCH_CAP")).toBe(ANCHOR_FETCH_CAP);
    expect(cap("PER_ITEM_TEXT_CAP")).toBe(PER_ITEM_TEXT_CAP);
  });
});

describe("NHTSA's recall list as a source", () => {
  it("names the vehicle in the query, on the host the deployment allows", () => {
    const url = nhtsaRecallsUrl({ make: "Honda", model: "Accord", year: 2003 });
    expect(url).toBe("https://api.nhtsa.gov/recalls/recallsByVehicle?make=Honda&model=Accord&modelYear=2003");
    expect(url.length).toBeLessThanOrEqual(300);
    const deploy = readFileSync(new URL("../scripts/deploy.mjs", import.meta.url), "utf8");
    expect(deploy).toMatch(/ANCHOR_ALLOWLIST = \[[^\]]*"api\.nhtsa\.gov"/);
  });

  it("encodes a listing's words, so no make or model can move the URL somewhere else", () => {
    const url = new URL(nhtsaRecallsUrl({ make: " Land Rover ", model: "Sport#x&modelYear=1999@evil", year: 2019 }));
    expect(url.hostname).toBe("api.nhtsa.gov");
    expect(url.hash).toBe("");
    expect(url.searchParams.get("make")).toBe("Land Rover");
    expect(url.searchParams.get("model")).toBe("Sport#x&modelYear=1999@evil");
    expect(url.searchParams.getAll("modelYear")).toEqual(["2019"]);
  });
});
