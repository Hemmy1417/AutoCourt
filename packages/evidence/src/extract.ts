import { sniffKind, type SniffedKind } from "./sniff.js";
import { normalizeText } from "./normalize.js";

/**
 * Extraction is adapter-shaped, and absence is honest: an item whose kind
 * has no extractor records extraction UNAVAILABLE — unextracted evidence
 * the panel is told about, never silently dropped and never fabricated
 * (brief §16).
 */

export interface ExtractionResult {
  status: "EXTRACTED" | "UNAVAILABLE";
  /** Normalized, NOT yet redacted. Empty when UNAVAILABLE. */
  normalizedText: string;
  kind: SniffedKind;
}

export interface Extractor {
  /** Which sniffed kinds this extractor can read. */
  supports(kind: SniffedKind): boolean;
  extract(bytes: Uint8Array): Promise<string>;
}

/** Plain text and text-like bytes: decode as UTF-8. */
export class PlainTextExtractor implements Extractor {
  supports(kind: SniffedKind): boolean {
    return kind === "text";
  }

  async extract(bytes: Uint8Array): Promise<string> {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/**
 * PDF text extraction. The default build extracts only the text a PDF
 * carries as plain literal strings in uncompressed content streams — a
 * deliberate floor, versioned as part of EXTRACTOR_VERSION. Scanned or
 * compressed-stream PDFs fall through to UNAVAILABLE honestly rather
 * than producing fabricated text.
 */
export class BasicPdfExtractor implements Extractor {
  supports(kind: SniffedKind): boolean {
    return kind === "pdf";
  }

  async extract(bytes: Uint8Array): Promise<string> {
    const raw = new TextDecoder("latin1").decode(bytes);
    const pieces: string[] = [];
    // Literal strings inside BT..ET text blocks: (…) Tj and TJ arrays.
    const textBlock = /BT([\s\S]*?)ET/g;
    let block: RegExpExecArray | null;
    while ((block = textBlock.exec(raw)) !== null) {
      const body = block[1] ?? "";
      const literal = /\(((?:[^()\\]|\\.)*)\)\s*T[Jj]/g;
      let m: RegExpExecArray | null;
      while ((m = literal.exec(body)) !== null) {
        pieces.push(
          (m[1] ?? "")
            .replace(/\\([()\\])/g, "$1")
            .replace(/\\n/g, "\n")
            .replace(/\\[0-7]{1,3}/g, ""),
        );
      }
    }
    const text = pieces.join(" ").trim();
    if (text.length === 0) {
      throw new Error(
        "no extractable literal text (scanned or compressed PDF)",
      );
    }
    return text;
  }
}

/**
 * The null OCR adapter: images and video are stored, hashed, and honestly
 * UNAVAILABLE. A real OCR engine slots in behind the same interface — and
 * changes EXTRACTOR_VERSION when it does.
 */
export class NullOcrExtractor implements Extractor {
  supports(_kind: SniffedKind): boolean {
    return false;
  }

  async extract(): Promise<string> {
    throw new Error("no OCR engine configured");
  }
}

export const DEFAULT_EXTRACTORS: Extractor[] = [
  new PlainTextExtractor(),
  new BasicPdfExtractor(),
];

export async function extractEvidence(
  bytes: Uint8Array,
  extractors: Extractor[] = DEFAULT_EXTRACTORS,
): Promise<ExtractionResult> {
  const kind = sniffKind(bytes);
  for (const extractor of extractors) {
    if (!extractor.supports(kind)) continue;
    try {
      const raw = await extractor.extract(bytes);
      const normalizedText = normalizeText(raw);
      if (normalizedText.length > 0) {
        return { status: "EXTRACTED", normalizedText, kind };
      }
    } catch {
      // fall through to the honest answer
    }
  }
  return { status: "UNAVAILABLE", normalizedText: "", kind };
}
