import { describe, expect, it } from "vitest";
import {
  checkVin, computeCheckDigit, vinCandidatesIn,
  parseDtc, extractDtcs,
  parseMileage, formatMileage, findRegressions, toKm,
} from "../lib/validation/all";

describe("VIN — format is the gate, the check digit is a reported fact", () => {
  it("accepts the canonical all-ones VIN (weights sum 89 ≡ 1 mod 11)", () => {
    const r = checkVin("11111111111111111");
    expect(r.formatValid).toBe(true);
    expect(r.checkDigit).toBe("VALID");
  });

  it("accepts the classic published example 1M8GDM9AXKP042788 with X as check digit", () => {
    const r = checkVin("1M8GDM9AXKP042788");
    expect(r.formatValid).toBe(true);
    expect(r.checkDigit).toBe("VALID");
    expect(computeCheckDigit(r.vin)).toBe("X");
  });

  it("a transposed pair keeps a legal format but fails the check digit — the two facts separate", () => {
    const r = checkVin("1M8GDM9AXKP042878");
    expect(r.formatValid).toBe(true);
    expect(r.checkDigit).toBe("INVALID");
  });

  it("rejects I, O and Q with a sentence a form can show", () => {
    const r = checkVin("1O111111111111111");
    expect(r.formatValid).toBe(false);
    expect(r.problem).toMatch(/I, O and Q/);
  });

  it("rejects wrong lengths and lowercases its way to canonical form", () => {
    expect(checkVin("abc").formatValid).toBe(false);
    expect(checkVin(" 1m8gdm9axkp042788 ").vin).toBe("1M8GDM9AXKP042788");
  });

  it("finds VIN-shaped strings in document text, skipping digit-only runs", () => {
    const text = "Invoice 12345678901234567 for vehicle 1M8GDM9AXKP042788, thanks.";
    expect(vinCandidatesIn(text)).toEqual(["1M8GDM9AXKP042788"]);
  });
});

describe("OBD-II — shape parsed in code, meaning left to the panel", () => {
  it("parses a standard powertrain code", () => {
    expect(parseDtc("p0301")).toEqual({
      code: "P0301", system: "powertrain", manufacturerSpecific: false,
    });
  });

  it("flags the manufacturer range without pretending to read it", () => {
    expect(parseDtc("P1234")?.manufacturerSpecific).toBe(true);
    expect(parseDtc("B0004")?.system).toBe("body");
    expect(parseDtc("U0100")?.system).toBe("network");
  });

  it("refuses non-codes rather than guessing", () => {
    expect(parseDtc("P04")).toBeNull();
    expect(parseDtc("X0301")).toBeNull();
    expect(parseDtc("P4301")).toBeNull();
  });

  it("extracts deduplicated codes from a scanner dump, order preserved", () => {
    const dump = "Stored: P0301, P0420. Pending: p0301. History: C1201 done";
    expect(extractDtcs(dump).map((d) => d.code)).toEqual(["P0301", "P0420", "C1201"]);
  });
});

describe("mileage — every conversion in code, never in a prompt", () => {
  it("parses grouped digits and unit words", () => {
    expect(parseMileage("87,432 km")).toEqual({ value: 87432, unit: "km", km: 87432 });
    expect(parseMileage("54,000 miles")?.km).toBe(toKm(54000, "mi"));
    expect(parseMileage("54000mi")?.unit).toBe("mi");
  });

  it("applies the default unit only when none is written", () => {
    expect(parseMileage("87432", "mi")?.unit).toBe("mi");
    expect(parseMileage("87432 km", "mi")?.unit).toBe("km");
  });

  it("refuses nonsense and absurd magnitudes", () => {
    expect(parseMileage("about ninety thousand")).toBeNull();
    expect(parseMileage("-500")).toBeNull();
    expect(parseMileage("6000000")).toBeNull();
  });

  it("formats the exact string the panel will read", () => {
    expect(formatMileage(parseMileage("87432 km")!)).toBe("87,432 km");
    expect(formatMileage(parseMileage("54000 miles")!)).toBe("54,000 miles");
  });

  it("finds a later-dated document with materially lower mileage", () => {
    const conflicts = findRegressions([
      { evidenceId: "E1", isoDate: "2025-03-01", mileage: parseMileage("120,000 km")! },
      { evidenceId: "E2", isoDate: "2025-09-01", mileage: parseMileage("88,000 km")! },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.regressionKm).toBe(32000);
    expect(conflicts[0]!.earlier.evidenceId).toBe("E1");
  });

  it("absorbs unit rounding inside the tolerance and cross-unit comparisons", () => {
    const conflicts = findRegressions([
      { evidenceId: "E1", isoDate: "2025-03-01", mileage: parseMileage("55,000 miles")! },
      { evidenceId: "E2", isoDate: "2025-04-01", mileage: parseMileage("88,400 km")! },
    ]);
    expect(conflicts).toHaveLength(0); // 55,000 mi ≈ 88,514 km — a rounding gap, not a regression
  });

  it("same-day readings never conflict — order within a day is unknowable", () => {
    const conflicts = findRegressions([
      { evidenceId: "E1", isoDate: "2025-03-01", mileage: parseMileage("120,000 km")! },
      { evidenceId: "E2", isoDate: "2025-03-01", mileage: parseMileage("90,000 km")! },
    ]);
    expect(conflicts).toHaveLength(0);
  });
});
