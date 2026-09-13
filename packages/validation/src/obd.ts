/**
 * OBD-II diagnostic trouble codes — SAE J2012 shape, parsed in code.
 *
 * The brief's safety rule (§14): a code is context, never a verdict. So
 * this module answers only the deterministic questions — is this a real
 * DTC shape, which system does it address, is it in the standardized or
 * the manufacturer-defined range — and the panel receives those facts as
 * facts. What a code MEANS for this vehicle stays a judgment the panel
 * makes against symptoms and reports, and even then the derivation caps it
 * at DIAGNOSTIC_CONCERN_SUPPORTED, never a confirmed component failure.
 */

const DTC_RE = /^([PBCU])([0-3])([0-9A-F]{3})$/;

export const DTC_SYSTEM = {
  P: "powertrain",
  B: "body",
  C: "chassis",
  U: "network",
} as const;

export type Dtc = {
  /** canonical form, e.g. "P0301" */
  code: string;
  system: (typeof DTC_SYSTEM)[keyof typeof DTC_SYSTEM];
  /** second character 0 or 2/3 = SAE-standardized ranges, 1 = manufacturer */
  manufacturerSpecific: boolean;
};

export function parseDtc(raw: string): Dtc | null {
  const code = raw.trim().toUpperCase();
  const m = DTC_RE.exec(code);
  if (!m) return null;
  const [, sys, digit] = m;
  return {
    code,
    system: DTC_SYSTEM[sys as keyof typeof DTC_SYSTEM],
    manufacturerSpecific: digit === "1",
  };
}

/**
 * Parse a free-text scanner dump into the codes it actually contains,
 * deduplicated, order preserved. Anything that is not DTC-shaped is
 * ignored here — it stays in the evidence text the panel reads.
 */
export function extractDtcs(text: string): Dtc[] {
  const seen = new Set<string>();
  const out: Dtc[] = [];
  for (const m of text.toUpperCase().matchAll(/\b[PBCU][0-3][0-9A-F]{3}\b/g)) {
    const dtc = parseDtc(m[0]);
    if (dtc && !seen.has(dtc.code)) {
      seen.add(dtc.code);
      out.push(dtc);
    }
  }
  return out;
}
