/**
 * The app-side paths that were only ever unit-tested.
 *
 *   node scripts/prove-app-paths.mjs        (server + dev-db up)
 *
 * None of these touch the chain, so this can run alongside a chain-backed
 * proof without competing for the job queue:
 *
 *   1. Unextractable evidence — an image with no OCR configured must be
 *      stored, hashed and recorded UNEXTRACTED. "Evidence is never
 *      silently discarded" is a brief requirement and was proven only in
 *      a unit test over the extractor, never through an upload.
 *   2. Rate limiting on a real request path, not the pure function.
 *   3. Share-link EXPIRY. Revocation was covered; wall-clock expiry, the
 *      thing S13 is actually about, was not.
 *   4. The compare and export screens, which no test had ever loaded.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.AUTOCOURT_URL ?? "http://localhost:3108";
const log = (s) => console.log(`[paths ${new Date().toISOString().slice(11, 19)}] ${s}`);
const failures = [];
const hard = (cond, what) => {
  if (cond) log(`ASSERT ok — ${what}`);
  else { log(`ASSERT FAILED — ${what}`); failures.push(what); }
};

const envText = readFileSync(fileURLToPath(new URL("../.env", import.meta.url)), "utf8");
const DB = (envText.match(/^DATABASE_URL=(.*)$/m) ?? [])[1];

class Actor {
  constructor(name) {
    this.name = name;
    this.account = privateKeyToAccount(generatePrivateKey());
    this.cookie = "";
  }
  async raw(path, init = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" } : {}),
        cookie: this.cookie, ...(init.headers ?? {}),
      },
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    return res;
  }
  async api(path, init = {}) {
    const res = await this.raw(path, init);
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(`${this.name} ${path}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  }
  async signIn() {
    const { nonce, message } = await this.api("/api/auth/nonce", {
      method: "POST", body: JSON.stringify({ address: this.account.address }),
    });
    const signature = await this.account.signMessage({ message });
    await this.api("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address: this.account.address, nonce, signature, displayName: this.name }),
    });
  }
}

const seller = new Actor("Paths Seller");
const buyer = new Actor("Paths Buyer");
await seller.signIn();
await buyer.signIn();

const vehicle = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2003,
    claims: [{ type: "CONDITION", declaredValue: "clean bodywork" }],
  }),
});
const a = await seller.api("/api/assessments", {
  method: "POST", body: JSON.stringify({ vehicleId: vehicle.id }),
});
log(`working assessment ${a.id}`);

// ── 1. an image with no OCR: stored, hashed, honestly unextracted ───────────
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  ...Array.from({ length: 64 }, (_, i) => (i * 7) % 251),
]);
const form = new FormData();
form.set("file", new Blob([png], { type: "application/octet-stream" }), "damage-photo.png");
form.set("declaredClass", "IMAGE");
form.set("declaredLabel", "Nearside wing photo");
form.set("captureDate", "2026-06-01");
const image = await seller.api(`/api/assessments/${a.id}/evidence`, { method: "POST", body: form });
log(`image stored as ${image.evidenceId} · mime ${image.mimeType} · status ${image.status}`);
hard(image.status === "UNEXTRACTED",
     "an image with no OCR is recorded UNEXTRACTED, never silently dropped");
hard(image.mimeType === "image/png",
     "the type came from the BYTES, not the filename or declared type");
hard(/^[0-9a-f]{64}$/.test(image.fileSha256),
     "the image is hashed even though its content cannot be read");

// ── 2. rate limiting on a real route ────────────────────────────────────────
let limited = 0, ok = 0;
for (let i = 0; i < 30; i++) {
  const res = await seller.raw(`/api/assessments/${a.id}/adjudicate`, { method: "POST" });
  if (res.status === 429) limited += 1;
  else ok += 1;
}
log(`adjudicate attempts: ${ok} answered, ${limited} rate-limited`);
hard(limited > 0, "the expensive path is rate-limited on a real request, not just in theory");

// ── 3. share-link EXPIRY (wall clock), not revocation ───────────────────────
const link = await seller.api(`/api/assessments/${a.id}/share`, {
  method: "POST", body: JSON.stringify({ expiresInDays: 1 }),
});
const prisma = new PrismaClient({ datasources: { db: { url: DB } } });
try {
  // Move the wall clock past it — the window is time, not activity.
  await prisma.shareLink.update({
    where: { id: link.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
} finally {
  await prisma.$disconnect();
}
const redeem = await buyer.raw(`/api/share/${link.token}`, { method: "POST" });
const redeemBody = await redeem.json().catch(() => null);
log(`expired link redeem: ${redeem.status} — ${redeemBody?.message ?? ""}`);
hard(redeem.status === 410, "an expired share link answers 410, not silence");
hard(/expired/i.test(redeemBody?.message ?? ""),
     "the refusal says the link expired, in words");

// ── 4. the two screens no test had ever loaded ──────────────────────────────
for (const [name, path] of [
  ["compare", `/assessments/${a.id}/compare`],
  ["report (export view)", `/assessments/${a.id}/report`],
]) {
  const res = await seller.raw(path);
  const html = await res.text();
  const broken = /Application error|Internal Server Error|__next_error__/i.test(html);
  log(`${name}: ${res.status}${broken ? " — RENDER ERROR" : ""}`);
  hard(res.status === 200 && !broken, `the ${name} screen renders`);
}

console.log("\n============ APP PATHS ============");
console.log(failures.length === 0
  ? "ALL APP PATHS PROVEN — image honesty, rate limiting, link expiry, both screens."
  : `INCOMPLETE — ${failures.length}: ${failures.join("; ")}`);
console.log("===================================");
process.exit(failures.length === 0 ? 0 : 1);
