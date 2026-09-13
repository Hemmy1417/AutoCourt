import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

import { sha256Bytes } from "./hash.js";

/**
 * Evidence file storage. The stored name is DERIVED FROM THE HASH — the
 * upload filename is party-supplied and never touches the filesystem
 * (brief §15). Interface-shaped so an S3-compatible store slots in
 * without touching the domain.
 */

export interface EvidenceStorage {
  /** Stores bytes; returns their sha256 (the storage key). Idempotent. */
  put(bytes: Uint8Array): Promise<string>;
  get(sha256: string): Promise<Uint8Array>;
  exists(sha256: string): Promise<boolean>;
}

const HASH_RE = /^[0-9a-f]{64}$/;

export class LocalDiskStorage implements EvidenceStorage {
  constructor(private readonly root: string) {}

  private pathFor(hash: string): string {
    if (!HASH_RE.test(hash)) throw new Error("invalid storage key");
    // Two-level fan-out keeps directories small.
    return join(this.root, hash.slice(0, 2), hash);
  }

  async put(bytes: Uint8Array): Promise<string> {
    const hash = sha256Bytes(bytes);
    const path = this.pathFor(hash);
    await mkdir(join(this.root, hash.slice(0, 2)), { recursive: true });
    await writeFile(path, bytes, { flag: "w" });
    return hash;
  }

  async get(hash: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(hash)));
  }

  async exists(hash: string): Promise<boolean> {
    try {
      await access(this.pathFor(hash));
      return true;
    } catch {
      return false;
    }
  }
}
