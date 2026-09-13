/**
 * VIN validation — ISO 3779 format plus the North-American check digit,
 * reported honestly as two separate facts.
 *
 * Format is universal: 17 characters, no I, O or Q (they read as 1 and 0).
 * The position-9 check digit is MANDATORY only for vehicles built to the
 * North-American scheme; a perfectly genuine European VIN can "fail" it.
 * Conflating the two would let AutoCourt call a real vehicle fake, which is
 * the exact class of false certainty the brief forbids (§14). So `format`
 * is a gate, and `checkDigit` is a deterministic pre-finding the assessment
 * packet reports for the panel and the reader to weigh — never a rejection
 * by itself.
 */

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** ISO 3779 transliteration. I, O, Q have no value — they cannot appear. */
const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4,
  "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
};

/** Position weights, 1-indexed positions 1..17; position 9 weighs 0. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export type VinCheck = {
  /** uppercased, trimmed input — the canonical form everything stores */
  vin: string;
  /** 17 chars, alphabet legal. The hard gate. */
  formatValid: boolean;
  /** North-American check digit result; meaningful only when formatValid */
  checkDigit: "VALID" | "INVALID";
  /** why formatValid is false, in words a form can show */
  problem?: string;
};

export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase();
}

export function computeCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]!;
    const value = TRANSLITERATION[ch];
    if (value === undefined) throw new Error(`untransliterable character ${ch}`);
    sum += value * WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

export function checkVin(raw: string): VinCheck {
  const vin = normalizeVin(raw);
  if (vin.length !== 17) {
    return {
      vin, formatValid: false, checkDigit: "INVALID",
      problem: `a VIN has exactly 17 characters — this has ${vin.length}`,
    };
  }
  if (/[IOQ]/.test(vin)) {
    return {
      vin, formatValid: false, checkDigit: "INVALID",
      problem: "the letters I, O and Q never appear in a VIN — they read as digits",
    };
  }
  if (!VIN_RE.test(vin)) {
    return {
      vin, formatValid: false, checkDigit: "INVALID",
      problem: "a VIN uses only capital letters and digits",
    };
  }
  return {
    vin,
    formatValid: true,
    checkDigit: computeCheckDigit(vin) === vin[8] ? "VALID" : "INVALID",
  };
}

/**
 * Every VIN-shaped string found in a text, for the packet's deterministic
 * VIN-mismatch pre-finding: a document about a different vehicle is a fact
 * code can surface before any model reads a word.
 */
export function vinCandidatesIn(text: string): string[] {
  const found = text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
  // digits-only 17-runs are far more often invoice numbers than VINs
  return [...new Set(found.filter((c) => /[A-Z]/.test(c)))];
}
