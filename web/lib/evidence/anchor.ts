/**
 * The bytes a validator hashes when the contract reads an independent
 * source, reproduced so the app can commit the hash they will compute.
 *
 * The contract reads a source with `gl.nondet.web.render(url, mode="text")`.
 * GenVM serves that from its webdriver (genvm: modules/webdriver, function
 * `normalizeWhitespace`): Chrome loads the page, takes
 * `document.body.innerText`, trims every line, turns every run of whitespace
 * inside a line into one space, and turns every run of blank lines into one.
 * The contract hashes the first ANCHOR_FETCH_CAP characters of THAT, and
 * refuses to judge a source whose hash differs from the one committed.
 *
 * The app used to hash the raw response. Any source with two spaces in a
 * row then carried a hash no validator would ever compute: ac-000023's
 * registry extract, whose readings sit in aligned columns, entered
 * SOURCE_UNAVAILABLE although every validator reached it and agreed.
 *
 * For a plain-text or JSON page, which is what the allowlisted hosts serve,
 * innerText is the text itself, so this is exact. An HTML page's innerText
 * depends on its layout and cannot be reproduced outside a browser; there
 * the hash is a best effort, and a mismatch is recorded, never judged.
 */

import { PER_ITEM_TEXT_CAP } from "./normalize";

/** Must stay equal to the contract's ANCHOR_FETCH_CAP. */
export const ANCHOR_FETCH_CAP = 8_000;

/** Python's `str.isspace()` set, which is not JavaScript's whitespace set. */
const PY_WHITESPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0,
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

/** Python slices strings by code point; `String.prototype.slice` by UTF-16 unit. */
const codePoints = (s: string, n: number) => Array.from(s).slice(0, n).join("");

/** Python's `str.split()` with no separator: runs of whitespace, no empty words. */
function pythonSplit(s: string): string[] {
  const words: string[] = [];
  let word = "";
  for (const ch of s) {
    if (PY_WHITESPACE.has(ch.codePointAt(0) ?? 0)) {
      if (word) words.push(word);
      word = "";
    } else {
      word += ch;
    }
  }
  if (word) words.push(word);
  return words;
}

/** What `render(url, mode="text")` returns for a plain-text source, capped as the contract caps it. */
export function renderedText(text: string): string {
  const normalized = text
    // A browser's parser turns CRLF and lone CR into LF before any script sees the text.
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n")
    .replace(/\n{2,}/g, "\n\n");
  return codePoints(normalized, ANCHOR_FETCH_CAP);
}

/**
 * NHTSA's public recall list for one vehicle, as JSON from the US Department
 * of Transportation. Neither party writes it, and a browser renders JSON as
 * plain text, so the fingerprint above is exact for it too.
 */
export function nhtsaRecallsUrl(v: { make: string; model: string; year: number }): string {
  const q = (s: string) => encodeURIComponent(s.trim());
  return `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${q(v.make)}&model=${q(v.model)}&modelYear=${v.year}`;
}

/** What the contract stores for an entered source: `" ".join(body.split())[:PER_ITEM_TEXT_CAP]`. */
export function anchorStoredText(rendered: string): string {
  return codePoints(pythonSplit(rendered).join(" "), PER_ITEM_TEXT_CAP);
}
