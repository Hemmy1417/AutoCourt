/**
 * Mileage — parsed, normalized and compared entirely in code.
 *
 * The hundredfold lesson from a sibling build: models cannot be trusted
 * with unit arithmetic. Every validator once read a minor-units integer as
 * a hundred times the real amount and called an accurate statement a lie.
 * So here: code parses "87,432 km" and "54,000 miles", code converts,
 * code compares dated readings, and the panel is handed pre-formatted
 * strings plus a code-computed conflict candidate list. The model never
 * divides, multiplies or converts anything.
 */

export type MileageUnit = "km" | "mi";

export type Mileage = {
  value: number;         // integer, in its own unit
  unit: MileageUnit;
  km: number;            // canonical comparison basis, rounded
};

const MI_TO_KM = 1.609344;

export function toKm(value: number, unit: MileageUnit): number {
  return unit === "km" ? Math.round(value) : Math.round(value * MI_TO_KM);
}

/** "87,432 km" | "87432" | "54,000 miles" | "54000mi" → Mileage (unit defaults km) */
export function parseMileage(raw: string, defaultUnit: MileageUnit = "km"): Mileage | null {
  const m = /^\s*([\d][\d,.\s ]*)\s*(km|kms|kilometers|kilometres|mi|miles|mile)?\s*$/i.exec(raw);
  if (!m) return null;
  const digits = m[1]!.replace(/[,.\s ]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 0 || value > 5_000_000) return null;
  const unitWord = (m[2] ?? "").toLowerCase();
  const unit: MileageUnit = unitWord.startsWith("mi") ? "mi" : unitWord ? "km" : defaultUnit;
  return { value, unit, km: toKm(value, unit) };
}

/** The exact string the panel reads. Formatting lives here, nowhere else. */
export function formatMileage(m: Mileage): string {
  const grouped = m.value.toLocaleString("en-US");
  return m.unit === "km" ? `${grouped} km` : `${grouped} miles`;
}

export type DatedReading = {
  evidenceId: string;
  isoDate: string;       // YYYY-MM-DD, validated upstream
  mileage: Mileage;
};

export type MileageConflict = {
  earlier: DatedReading;
  later: DatedReading;
  /** km the odometer would have had to run BACKWARDS */
  regressionKm: number;
};

/**
 * A later-dated document showing materially lower mileage is a fact, not a
 * judgment — the packet carries these as deterministic pre-findings. The
 * tolerance absorbs unit rounding and same-day reading order; it is not a
 * fraud threshold, and the panel decides what a real regression means
 * (conflict vs possible rollback) with the documents in front of it.
 */
export function findRegressions(readings: DatedReading[], toleranceKm = 500): MileageConflict[] {
  const dated = [...readings].sort((a, b) =>
    a.isoDate < b.isoDate ? -1 : a.isoDate > b.isoDate ? 1 : 0,
  );
  const conflicts: MileageConflict[] = [];
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const earlier = dated[i]!;
      const later = dated[j]!;
      if (later.isoDate === earlier.isoDate) continue;
      const regression = earlier.mileage.km - later.mileage.km;
      if (regression > toleranceKm) {
        conflicts.push({ earlier, later, regressionKm: regression });
      }
    }
  }
  return conflicts;
}
