/**
 * Normalization of extracted text into the JUDGED bytes. The output of
 * this function (after redaction) is exactly what `submit_evidence_text`
 * carries and what `text_sha256` commits — change it and every recorded
 * hash changes, which is why EXTRACTOR_VERSION rides in the on-chain
 * manifest per item.
 */

/** Must stay equal to the contract's PER_ITEM_TEXT_CAP. */
export const PER_ITEM_TEXT_CAP = 6_000;

/** The version string committed per item in the on-chain manifest. */
export const EXTRACTOR_VERSION = "extractor-1.0.0";

export function normalizeText(raw: string): string {
  const collapsed = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]/g, " ")
    .replace(/ +/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (collapsed.length <= PER_ITEM_TEXT_CAP) return collapsed;
  // Cut on a word boundary, never mid-word: quotes ground word-token-wise
  // against these bytes.
  const cut = collapsed.slice(0, PER_ITEM_TEXT_CAP);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
