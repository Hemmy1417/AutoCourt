/**
 * Shared machinery for the live proof scripts.
 *
 * These scripts drive the product the way a person does — over HTTP,
 * signed in with a real wallet — so each one needs a signer, an upload
 * helper, and a way to wait. The waiting is the part worth having in one
 * place: it has been written wrong three times, in three copies, in the
 * same way each time.
 *
 * THE MISTAKE: treating an empty job queue as a settled record. The
 * worker marks jobs DONE in one call and applies their effects in the
 * next, so in between, the queue is empty while the record has not
 * caught up — an anchor item still reads PENDING_ENTRY, the assessment
 * still reads PROCESSING, and the run row is not written yet. Routes
 * gate on the RECORD, so a script that gates on the QUEUE races them and
 * gets a 400 or a 409 for a step that was about to be legal.
 *
 * Scripts that got away with it were passing on timing luck.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

export const BASE = process.env.AUTOCOURT_URL ?? "http://localhost:3108";

/** States the record passes THROUGH; nothing may be asked of it here. */
const TRANSITIONAL = new Set(["PROCESSING"]);

export function logger(tag) {
  return (s) => console.log(`[${tag} ${new Date().toISOString().slice(11, 19)}] ${s}`);
}

/** Collects failed assertions so a run reports all of them, not just the first. */
export function asserter(log) {
  const failures = [];
  const hard = (cond, what) => {
    if (cond) log(`ASSERT ok — ${what}`);
    else { log(`ASSERT FAILED — ${what}`); failures.push(what); }
  };
  return { hard, failures };
}

export class Actor {
  constructor(name) {
    this.name = name;
    this.account = privateKeyToAccount(generatePrivateKey());
    this.cookie = "";
  }

  /** The raw response, for the cases where a refusal IS the result. */
  async raw(path, init = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" } : {}),
        cookie: this.cookie,
        ...(init.headers ?? {}),
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return res;
  }

  async api(path, init = {}) {
    const res = await this.raw(path, init);
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(
        `${this.name} ${path}: ${res.status} ${JSON.stringify(body).slice(0, 220)}`,
      );
    return body;
  }

  async signIn() {
    const { nonce, message } = await this.api("/api/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ address: this.account.address }),
    });
    const signature = await this.account.signMessage({ message });
    await this.api("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({
        address: this.account.address,
        nonce,
        signature,
        displayName: this.name,
      }),
    });
    return this;
  }
}

/** Upload a text document and consent to its publication in one step. */
export async function upload(actor, assessmentId, {
  filename, text, declaredClass, declaredLabel, captureDate,
}) {
  const form = new FormData();
  form.set("file", new Blob([text], { type: "text/plain" }), filename);
  form.set("declaredClass", declaredClass);
  form.set("declaredLabel", declaredLabel);
  form.set("captureDate", captureDate);
  const item = await actor.api(`/api/assessments/${assessmentId}/evidence`, {
    method: "POST",
    body: form,
  });
  await actor.api(`/api/assessments/${assessmentId}/evidence/${item.id}/consent`, {
    method: "POST",
    body: JSON.stringify({ consentVersion: "publicity-statement-1" }),
  });
  return item;
}

/**
 * Wait until the RECORD is quiet, not merely until the queue is empty.
 *
 * Quiet means: no job left to run, no evidence item still entering the
 * chain, and the assessment not mid-transition. That is the same set of
 * conditions the routes and the UI gate on, which is the whole point —
 * anything less and the script asks for something the product will
 * rightly refuse.
 *
 * `failOnJobFailure` is on by default: an unexpected FAILED job should
 * stop a proof loudly. Scripts whose subject IS a failure pass false.
 */
export async function settled(actor, assessmentId, label, {
  minutes = 30, failOnJobFailure = true, log = console.log, everyMs = 12_000,
} = {}) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    if (Date.now() > deadline)
      throw new Error(`${label}: not settled in ${minutes} minutes`);
    await new Promise((r) => setTimeout(r, everyMs));

    const { jobs } = await actor.api(`/api/assessments/${assessmentId}/jobs`);
    const failed = jobs.filter((j) => j.state === "FAILED");
    if (failOnJobFailure && failed.length)
      throw new Error(
        `${label}: ${failed.map((j) => `${j.kind}: ${j.lastError}`).join("; ")}`,
      );

    const pending = jobs.filter((j) => j.state !== "DONE" && j.state !== "FAILED");
    const record = await actor.api(`/api/assessments/${assessmentId}`);
    const entering = (record.evidenceItems ?? []).filter(
      (i) => i.status === "PENDING_ENTRY",
    );
    const moving = TRANSITIONAL.has(record.state);

    log(
      `${label}: ${record.state} · ${record.onChainId ?? "—"} · ` +
        `runs ${record.runs?.length ?? 0} · pending ${pending.length}` +
        (entering.length ? ` · entering ${entering.length}` : ""),
    );
    if (pending.length === 0 && entering.length === 0 && !moving) return record;
  }
}
