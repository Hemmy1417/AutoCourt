# AutoCourt — founding architecture decisions (v2)

Product: evidence-based used-vehicle verification. A seller lists a vehicle
and declares claims; evidence accumulates from both sides; a GenLayer
Intelligent Contract adjudicates the claims against the evidence and the app
renders a claim-by-claim verdict a buyer can trust — including the honest
outcomes: insufficient, conflicting, inspection-required.

Every decision below is downstream of [STANDARDS-MAP.md](STANDARDS-MAP.md).
Read that first; this file says *what* is built, that one says *why it must
be built that way*.

**v2 provenance.** Before any code, a four-lens adversarial design review
(evidence model, trust story, contract shape, product scope) was run against
the v1 of this document. It returned 38 findings, six of them blocking-class;
the raw output is preserved verbatim in
[design-review-findings.md](design-review-findings.md). Every blocking and
high finding is resolved in this v2, and the material changes are: the
amortized evidence-entry model (§3), the dual-hash manifest (§3.4), the
corroboration ladder moved into the contract (§4.4), the verdict-enum
partition (§6), CredenceLend-style quote grounding with drop-and-downgrade
(§4.5), and the explicit publicity/consent boundary (§8.2).

## 0. Scope ruling — the brief's two halves

The build prompt contains a full-stack product definition (AutoCourt) and,
appended, the standalone-contract master operating template whose §1.5 says
"contract-only by default, do not add a dashboard/backend". These conflict on
scope. Ruling, recorded so it is a decision and not an accident:

- the **product half governs scope** — its own words: "This is a full-stack
  product build, not a standalone Intelligent Contract repository";
- the **master template governs contract discipline** — Direct Mode testing,
  forged-leader validation, GenVM lint, deployment evidence, source parity,
  finality language, freeze rule. Those sections are applied to
  `contracts/autocourt_assessment.py` exactly as if it were a standalone
  submission.

## 1. Network and chain facts

| | |
|---|---|
| Network | GenLayer Studio Next |
| Chain id | 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Explorer | `https://explorer-studio-dev.genlayer.com` (`/address/<a>`, `/tx/<h>`) |
| Client | genlayer-js 2.0.0-rc.1 (fee distribution required on writes) |
| Runner | pin the current proven `py-genlayer` runner at contract-writing time (today: `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`); the `# { "Depends": ... }` header and its trailing blank line are load-bearing |

The deployment of record, once it exists, is named in exactly one way across
`.env.example`, README, CI and docs (S37 gate). Before any bound in
`get_config()` is frozen, a **disposable-deploy calldata probe** measures the
real write-argument ceiling on this network — the proven live envelope from
sibling builds is ~8,000-char JSON write arguments, and nothing larger is
assumed anywhere in this design (§3.2, §4.6).

## 2. Stack

- **Monorepo, npm workspaces.** `apps/web` (Next.js App Router, TypeScript —
  UI **and** API route handlers), `apps/worker` (Node entry point that drains
  the job queue in local/long-lived deployments), `packages/*` for everything
  either consumes: `shared-types`, `validation`, `evidence`,
  `genlayer-client`, `db`. One lockfile, one `tsc`, one test runner (vitest)
  for TS; pytest for the contract.
- **PostgreSQL + Prisma.** `infrastructure/docker/docker-compose.yml` runs
  Postgres 16 locally; `DATABASE_URL` in env. Migrations committed.
- **Evidence files** go through a storage adapter (`packages/evidence`):
  `LocalDiskStorage` in dev (`var/evidence/`, gitignored), interface-shaped
  so an S3-compatible store slots in without touching the domain. Files are
  hashed (sha256) at upload; the stored name is derived from the hash, never
  from the upload filename. Every file's type is established by magic-byte
  sniffing, never by extension or declared MIME. Extracted evidence text is
  rendered exclusively as plain text (it is attacker-authored). Antivirus
  scanning is **not** performed; that is a stated limitation in the threat
  model, not implied coverage.
- **Extraction** is adapter-shaped too: PDF text extraction and plain text
  are real; OCR ships as an interface with a null default that records
  `extraction_status = UNAVAILABLE` — an image (or video) without extraction
  is *unextracted evidence the panel is told about*, never silently dropped
  and never fabricated (brief §16: "evidence is never silently discarded").
  The extractor carries a **version string**; that version is committed into
  the on-chain manifest per item (§3.4), and `scripts/verify-extraction`
  recomputes any item's normalized-text hash from its original so a third
  party can check the pipeline after the fact.
- **Auth**: wallet-based, and only wallet-based (user decision, 13 Sep).
  The account IS an address: sign-in is an EIP-191 `personal_sign` over a
  server-issued short-lived nonce (no transaction, no fee), sessions are
  signed HttpOnly cookies backed by DB rows. The wallet address is also
  the on-chain account string — `uploader_account`, dispute stakes and
  appellants are all addresses, so attribution on the record reads
  naturally against the chain. Roles stay contextual: a user is a seller
  on vehicles they created and a buyer on assessments shared with them.
  **Identity is still self-attested** — anyone can mint wallets — and the
  corroboration ladder (§4.4) is designed so that this buys them nothing
  that matters: same-account items never corroborate, and opposing-role
  uploads can never lift a seller-favoring verdict.
- **Background work**: assessment jobs are DB rows with a **lease**
  (`locked_until`, bounded retries). `packages/worker-core` exposes
  `runPendingJobs()`; `apps/worker` loops it in the supported long-lived
  deployment; in a serverless deployment the **named mover is a platform cron
  (e.g. Vercel cron) hitting the authenticated drain route on a fixed
  cadence** — the lease guarantees a dead invocation cannot strand a job in
  `PROCESSING`. The GenLayer transaction is submitted once and then
  *polled* — a crash between submit and record is recovered by re-reading
  the chain, never by resubmitting blind (a lost response is not a refusal).
- **API discipline** (brief §11/§15): deterministic token-bucket rate
  limiting per session **and** per IP on the upload and assessment-trigger
  routes; cursor pagination on every list endpoint; one typed error envelope
  `{code, message, details}` used by every route — the same envelope carries
  the contract's verbatim refusal sentence when a write is refused (§7 of the
  standards map); a minimal structured request-log hook (route, status,
  duration, request id) as the observability seam.

## 3. Evidence: how bytes enter the record

The single largest v1→v2 change. The judged bytes live **in contract
storage, entered through bounded per-item writes** — never through one
mega-packet transaction (unproven calldata ceiling), and never through a
leader-private fetch (S39). Three lanes:

### 3.1 Uploaded evidence (the default lane)

```
upload → magic-byte type check → sha256(original) → store original
      → extract text (versioned extractor) → normalize → redact (§8.2)
      → sha256(normalized_text) → EvidenceItem row
      → submit_evidence_text(...) on-chain, one write per item
```

Each `submit_evidence_text` write carries one item: evidence id, declared
type (disclosed as the uploader's claim — S31), uploader account id and
role, capture/upload timestamps, MIME class, extraction status, **both
hashes** (`file_sha256`, `text_sha256`), extractor version, the bounded
normalized text (≤ 6,000 chars), and that item's **typed observation rows**
(§3.3). The whole JSON argument stays ≤ 8,000 chars — the envelope sibling
builds proved live. The contract recomputes `text_sha256` over the supplied
text and refuses a mismatch, so the hash is bound to the bytes **at entry**,
by every validator, because the bytes are calldata (S39 satisfied
structurally for this lane).

Original binary files never travel on-chain; only their sha256 does.

### 3.2 The assessment record and its seal

`submit_assessment` then carries only the claim set, the evidence-id list,
and the manifest root (≤ 8,000 chars). The contract recomputes the root over
the items **it already stores** and refuses a mismatch. Sealing makes the
packet immutable; `adjudicate(id)` later reads only stored bytes, so no
single transaction ever needs an unproven calldata ceiling. Panel budget:
≤ 12 items judged per assessment (8 at first adjudication + 4 appeal
additions), total judged text ≤ 72,000 chars — inside the prompt envelopes
sibling builds carried through live consensus, with the leader findings
payload parse-capped at 300,000 chars (it carries findings and quotes, never
evidence text).

### 3.3 Typed observation rows, not app pre-findings

v1 had the app compute "deterministic pre-findings" (mileage-sequence
conflicts, duplicate hashes, VIN echoes) and ship them as packet facts.
That made a decisive field an unverified app assertion (S7). v2 inverts it:
the packet carries only **typed observation rows** — `(evidence_id,
doc_date, odometer_reading, source_field)` and normalized OBD-II codes
(format-checked `[PBCU]\d{4}`, deduplicated, in `packages/validation` with
its own unit tests) — and the **contract recomputes** mileage-sequence
conflicts, duplicate-hash detection, and VIN-echo mismatches from those rows
in deterministic code every validator runs. A reading that exists only
inside free text is not a typed row and cannot raise a code flag; it can
only support a panel finding under equivalence. App-side previews of these
checks are UI conveniences, never packet fields.

Numbers and dates are formatted by code into the exact strings the panel
reads. The model never converts a unit (the hundredfold lesson).

### 3.4 The dual-hash manifest

Every manifest entry is `(evidence_id, file_sha256, text_sha256,
extractor_version)` and the root hashes all four fields. The manifest binds
**the bytes the panel actually judges** (normalized text), not only the
source file — a re-extraction that changes the text changes `text_sha256`
and therefore cannot impersonate a recorded item. `RECORDED` items in an
appeal are referenced **by id only** and read from contract storage;
re-supplied bytes for a recorded item are refused by construction (there is
no parameter to supply them through), which makes the
altered-re-extraction attack unrepresentable rather than merely detectable.

### 3.5 Independent-anchor evidence (the lane that can reach VERIFIED)

The brief's evidence taxonomy includes "external source result", and the
corroboration ladder (§4.4) reserves the `VERIFIED` ceiling for evidence
integrity-bound to a source neither party controls. That binding cannot be
app-asserted (the operator would be stamping its own labels), so it is a
distinct entry lane with a **narrow, every-validator fetch at entry**:

- `submit_anchor_item(assessment_id, item_json)` names a URL on the
  deployment's **anchor allowlist** (a `get_config()` constant of registrable
  independent hosts — never party-controlled domains) plus the expected
  sha256 of the page bytes.
- The write is nondeterministic: **every validator fetches the URL itself**,
  hashes the bounded raw bytes (≤ 8,000), and agreement is exact-hash
  agreement — the CredenceLend entry shape, satisfying the Verda v0.1.1 rule
  (each validator binds the stored content to bytes *it* fetched; no
  leader-private byte exists).
- On agreement the contract stores the deterministically-normalized text
  (in-contract whitespace collapse, not the app extractor) as the item's
  judged bytes. All nodes agreeing unreachable-or-mismatch → the item enters
  as status `SOURCE_UNAVAILABLE` (fail-soft; never an adverse finding); a
  reachability **split** → no state change, retry later — never a verdict
  from partial sight.
- Adjudication and appeals read the stored, entry-corroborated text; an
  appeal never refetches, so the record does not decay with hosting
  (S14/S28).

This is the only fetch in the system. Uploaded evidence never rides it, and
a deployment can run with an empty allowlist (then `VERIFIED` is honestly
unreachable and the docs say so — §6).

### 3.6 Disputes and intake receipts

A buyer flags claims as disputed through `record_dispute` — a bounded
on-chain write naming the account, claim ids, and an optional note. Recorded
disputes are what the corroboration ladder means by an "opposing stake"
(§4.4), are disclosed to the panel as the buyer's assertions (a dispute is a
claim, not a fact — S31 symmetric), and a dispute filed after a verdict
enables a new run exactly like new evidence.

Because omission is the operator's cheapest attack, the UI includes a
**per-run manifest view**: every party sees `(id, sha256)` for each of their
items with "in run N" / "not in any run" status, straight from the contract
manifest — so a silently dropped item is visible to the party who uploaded
it. An invariant test asserts a buyer's recorded disputes and evidence
appear in the next packet or the run records their absence.

## 4. The contract (`contracts/autocourt_assessment.py`)

One canonical deployable contract. Surface (names final, signatures refined
at implementation):

| method | kind | does |
|---|---|---|
| `create_assessment(vehicle_json, claims_json)` | write, det | VIN code-validated (format + ISO 3779 check digit); bounded claim set with the seller's declared values; returns `ac-NNNNNN` |
| `submit_evidence_text(id, item_json)` | write, det | one uploaded item (§3.1); verifies `text_sha256` over the supplied text; refuses past caps or after seal |
| `submit_anchor_item(id, item_json)` | write, nondet | independent-anchor entry (§3.5); every validator fetches; exact-hash equivalence |
| `record_dispute(id, dispute_json)` | write, det | buyer's disputed-claim flags + bounded note; recordable before AND after seal — a post-verdict dispute is what opens the appeal path, tagged with the run count it followed |
| `submit_assessment(id, manifest_json)` | write, det | seals the packet: claims + item-id list + manifest root, recomputed against stored items; immutable once sealed |
| `adjudicate(id)` | write, nondet | one panel round over the **stored** packet; findings validated at the boundary; verdicts derived in code; run recorded |
| `submit_appeal_evidence(id, item_json)` | write, det | NEW post-verdict item (≤ 4 per appeal), tagged with uploader and timestamp (S36) |
| `readjudicate(id, appeal_json)` | write, nondet | appeal: RECORDED items by id reference (read from storage — §3.4), NEW items by id from appeal evidence, the appealed run's verdict included in the prompt (brief §13); prior runs immutable |
| `get_assessment` / `get_run` / `get_verdict` / `get_manifest` | views | the record, machine-readable; `get_verdict` returns the latest terminal-success run **plus run number and total runs**, so a superseded verdict can never be confused with the standing one |
| `get_stats()` / `get_config()` | views | counters; every bound and the anchor allowlist, so the frontend never guesses a limit |

### 4.1 Preconditions (the S30/S25 guards)

`adjudicate`/`readjudicate` refuse unless: the assessment is sealed, exactly
zero runs are in flight, the caller is a **recorded party** (the seller of
record or an account with recorded evidence or a recorded dispute on this
assessment), and runs < `MAX_RUNS_PER_ASSESSMENT` — each refusal sentence
names the specific precondition. `adjudicate` additionally refuses when a
terminal-success run over the identical manifest root already stands: a
re-roll is only reachable through `readjudicate`, which is itself a recorded,
attributed, capped act — verdict-shopping is unrepresentable, not merely
auditable. `readjudicate` is callable only from `ADJUDICATED`. Retrying a
`FAILED` run is allowed to either party.

### 4.2 Failure ladder (S5, complete)

| failure | behavior |
|---|---|
| validator "cannot obtain bytes" (uploaded lane) | impossible by construction — judged bytes are consensus state; the only byte-level failure is a state read failure = transaction failure, state unchanged |
| anchor fetch: all nodes unreachable or hash-mismatch | item enters as `SOURCE_UNAVAILABLE` status; never an adverse finding |
| anchor fetch: reachability split | no state change; retry — never a verdict from partial sight |
| transport failure before a transaction exists | nothing reached the chain, so the worker retries, bounded by the job's attempts; a failure to READ a submitted transaction is never an attempt — its hash is kept and polled |
| LLM failure mid-round (the round ends without a verdict) | state unchanged on chain; the attempt is recorded as a `FAILED` or `REJECTED` run with its transaction hash and `Assessment → FAILED`. The queue never re-runs a judgment: the retry is either party's (S26 exit), each its own recorded attempt |
| a step fails mid-sequence | the steps queued behind it fail with it, naming it ("an earlier step failed (SEAL)"), so none addresses a record in a state it never reached. Only those: anything queued afterwards is a new attempt and runs. A buyer's dispute depends on nothing but the record existing, so it neither fails with an adjudication ahead of it nor fails a seal behind it |
| malformed / structurally invalid model output | never survives consensus: the leader is refused and rotated, and if no valid output emerges the transaction fails with state unchanged; the app records the refused attempt as a `REJECTED` run with its transaction hash — the chain records only judgments that survived consensus |
| ungrounded quote on one finding | **not** a run failure — drop-and-downgrade (§4.5) |
| protocol-level UNDETERMINED / CANCELED | no contract outcome, never mapped to a verdict. For a write (evidence, seal, dispute) the ended transaction is dropped and the next pass sends a NEW attempt with its own hash, bounded; for a judgment, the failed-round row above. A status that has not answered yet is polled, never resubmitted — a lost response is not a refusal |

### 4.3 Panel output and equivalence

Panel output = per-claim findings only: status, severity band, evidence-id
citations, grounding quotes, plus the explanation findings the flags need
(e.g. whether a code-detected mileage inversion is EXPLAINED by the
records), and one free-prose `unresolved_questions` field per claim.
Deterministic code validates every field structurally at the boundary (enum
membership, severity range, cited ids exist in the manifest — S16).

**Equivalence covers the decision cut** — exactly the inputs the
derivation reads, and nothing shaded: which items bear on which claims
and in which direction, the severe/not-severe cut of each severity, the
sufficient/not cut of the record judgment, explanation states, and the
diagnostic booleans. Judgment SHADINGS (MINOR vs MODERATE, PARTIAL vs
INSUFFICIENT) and the listing of non-bearing ABSENT rows stay free,
because model families split on shadings while agreeing on decisions —
the live diagnostic pass proved both halves (PROBE-REPORT.md): the
shaded-field equivalence burned a round MAJORITY_DISAGREE; the
decision-cut equivalence finalized MAJORITY_AGREE. Every validator
refusal prints a `[DISAGREE]` line naming the field and both values, and
the **disposable-deploy diagnostic pass** runs before any canonical
deployment, because a split you cannot diagnose from chain stdout is a
split you cannot fix.

### 4.4 Corroboration is derived in the contract, per edge

The packet carries only **primitive facts** per item — uploader account id,
role, timestamps, hashes, lane — plus the recorded dispute set. The
**contract** derives the corroboration class deterministically, per
`(claim, item, direction)` edge, from those facts and the
equivalence-agreed finding status; the app's copy is display-only. Ladder:

- `INDEPENDENT` — the item entered through the anchor lane (§3.5): its
  bytes were verified by every validator against a host neither party
  controls.
- `ADVERSE` — uploaded by an account with a **recorded opposing dispute
  stake** on that claim, and a different account id from every item it would
  corroborate.
- `FIRST_PARTY` — uploaded by the party the claim favors.

Rules in code: items from the same account id never corroborate each other;
`VERIFIED` (the seller-favoring ceiling) requires `INDEPENDENT` support,
because opposing-role uploads are exactly what colluding accounts
manufacture — `ADVERSE` support can strengthen adverse findings and lift a
claim to `PARTIALLY_VERIFIED`, never to `VERIFIED`. The S34 floor holds
adverse findings that rest solely on the accusing party's own uploads at
`INSUFFICIENT_EVIDENCE` / `PHYSICAL_INSPECTION_REQUIRED`, keyed on the
verdict's `adverse` attribute (§6), never on a name list. Stated plainly:
account identity is app-attested, and Sybil collusion is *detectable*
(same-hash, same-account rules, on-chain attribution) and *priced*
(the ladder), not prevented.

### 4.5 Quote grounding: word-token, drop-and-downgrade

"Verbatim" quote equality is the exact rule that split validator model
families live in sibling builds, so it is not used. Grounding is the proven
word-token rule: contiguous lowercase-alphanumeric token runs, in order, in
the cited item's stored text; ellipsis/newline-split fragments allowed,
≥ 2 words per fragment; `QUOTE_MIN 8 / QUOTE_CAP 240 / MAX_QUOTES 3`;
re-attribution across eligible cited items before giving up. Failure ladder:
an ungrounded quote is dropped; an adverse finding left with zero grounded
quotes is **downgraded to its non-adverse state** (with `[DOWNGRADE]` and
the raw quotes printed to validator stdout); `REJECTED` is reserved for
structural invalidity. One weak model family can therefore cost sharpness on
one finding — never the availability of the product's core verb.

### 4.6 Bounds (all published via `get_config()`)

`MAX_CLAIMS 12 · MAX_EVIDENCE_ITEMS 12 (8 at submission + 4 appeal) ·
MAX_NEW_ITEMS_PER_APPEAL 4 · PER_ITEM_TEXT_CAP 6000 chars ·
PER_WRITE_JSON_CAP 8000 chars · TOTAL_JUDGED_TEXT_CAP 72000 ·
MAX_RUNS_PER_ASSESSMENT 4 · QUOTE_MIN 8 / QUOTE_CAP 240 / MAX_QUOTES 3 ·
NOTE_CAP 200 · VIN length 17 · ANCHOR_FETCH_CAP 8000 bytes ·
LEADER_PAYLOAD_PARSE_CAP 300000` — every number inside the envelope sibling
builds proved live, none frozen until the disposable-deploy calldata probe
confirms them on the target network (§1).

## 5. Data model (Prisma, the domain rows the brief names)

`User, Vehicle, VehicleClaim, Assessment, EvidenceItem, EvidenceExtraction,
DiagnosticObservation, InspectionFinding, AssessmentFinding, AdjudicationRun,
Appeal, AuditEvent, ShareLink` — relationships per the brief. Additions
forced by the review: `VehicleClaim` carries buyer dispute flags (audit-
evented); `EvidenceItem` carries MIME class, the full brief-§6 evidence-class
enum (video and other unextractable classes stored, hashed, honestly
`UNAVAILABLE`), redaction status, and both hashes; per-item chain of custody
is the `AuditEvent` rows keyed by evidence id, surfaced on the evidence
review screen. `DiagnosticObservation` and `InspectionFinding` are not just
rows — they are **packet sections** (§3.3, brief §13). Every
`AdjudicationRun` stores the manifest root, the tx hash, and renders from
the **contract view as source of truth** (DB caches, chain decides). Share
links are signed, expiring, revocable — and govern only the app's copy of
anything (§8.2). Audit events are append-only.

## 6. Verdict model — a partition, not a flat enum

The brief's 13 values are all implemented in `packages/shared-types` and
mirrored in the contract, but they are **four different kinds of thing**,
and the spec says which is which so one deterministic function cannot
contradict itself:

- **(a) Claim-level verdicts** — exactly one per claim: `VERIFIED,
  PARTIALLY_VERIFIED, CLAIM_CONTRADICTED, CONFLICTING_EVIDENCE,
  INSUFFICIENT_EVIDENCE, PHYSICAL_INSPECTION_REQUIRED, INCONCLUSIVE`.
- **(b) Code-derived flags** (never claim verdicts): `mileage_conflict`
  (contract-recomputed date/odometer inversion from typed rows, §3.3),
  `odometer_rollback_indicated` (= mileage_conflict **and** the panel's
  explanation finding says NOT_EXPLAINED), `diagnostic_concern_supported`
  (panel symptom-support finding over normalized codes; a diagnostic code is
  never an auto-failure — brief §14; safety-critical concerns always set the
  inspection bit).
- **(c) Assessment-level rollup** — the report headline, derived by fixed
  precedence over (a)+(b): `POSSIBLE_ODOMETER_ROLLBACK ≻ MILEAGE_CONFLICT ≻
  MATERIAL_CONCERN ≻ DIAGNOSTIC_CONCERN_SUPPORTED ≻` (claim-verdict
  summary).
- **(d) Run/item statuses** (never verdicts): `REJECTED` (an adjudication
  attempt whose transaction consensus refused — recorded app-side with its
  tx hash, because a structurally invalid output never survives consensus
  and so can never be written on-chain), `SOURCE_UNAVAILABLE` (an anchor item
  all validators agreed was unreachable — §3.5; for uploaded items the
  analogue is `extraction_status UNAVAILABLE`, disclosed to the panel, with
  the sufficiency gate steering claims that rest on it to
  `INSUFFICIENT_EVIDENCE` / `PHYSICAL_INSPECTION_REQUIRED`).

Every value in (a)–(c) carries an `adverse: bool` attribute, and **every
floor and gate keys on attributes, never on enumerated names** — so an
adverse flag like `odometer_rollback_indicated` (a fraud indication,
strictly stronger than `CLAIM_CONTRADICTED`) can never slip past the S34
floor by not being on a list. The sufficiency gate applies to every
conclusive verdict in both directions (S22): insufficient evidence forces
`INSUFFICIENT_EVIDENCE`, which can decay into neither `VERIFIED` nor
`CLAIM_CONTRADICTED`. If the anchor allowlist is empty in a deployment,
`VERIFIED` is unreachable there, and `get_config()` + docs say so — a
release gate greps that every enum value has a producing code path or an
explicit RESERVED note.

**The three brief-mandated report fields** have exactly one home each:

- `confidence_band` (LOW/MEDIUM/HIGH) — **derived in code** per claim by a
  fixed formula over already-agreed inputs: corroboration class (§4.4),
  finding states, extraction coverage of cited items. Never a panel output
  (the archetypal S7 field), and stronger than putting it in equivalence:
  every input is either equivalence-agreed or deterministic from calldata.
  Rendered as a labeled band with named grounds — never a numeric gauge
  (brief §10).
- `recommended_next_action` — a deterministic table keyed by
  `(claim verdict, flags)`; e.g. `PHYSICAL_INSPECTION_REQUIRED` names the
  inspection type.
- `unresolved_questions` — the one free-prose field: panel-authored, outside
  equivalence, rendered under an explicit "panel narrative — not
  consensus-checked" label (S12); it is where the panel says what additional
  evidence would reduce uncertainty (brief §14).

## 7. State machines

**Assessment**: `DRAFT → SUBMITTED (sealed) → PROCESSING → ADJUDICATED |
FAILED`; `ADJUDICATED --appeal (new evidence or new dispute)--> PROCESSING
(new run)`; `FAILED --retry--> PROCESSING`. Every non-terminal state has a
named mover — including in serverless deployment, where the mover is the
platform cron + job lease (§2) — and a timeout exit (S26). **Evidence after
a verdict** never mutates the verdict; it enables a new run (S33 shape).
**Dispute after a verdict** does the same. **Share link**:
`ACTIVE → REVOKED | EXPIRED` (wall-clock, S13).

**Role × act matrix** (the input to the §8-of-standards-map pure-function
test): seller — create, upload, seal, adjudicate, retry; buyer (recorded via
dispute or evidence) — upload, dispute, request readjudication, retry;
either recorded party — view every run, manifest and receipt. An act any
precondition blocks is listed with the reason in words, not offered as a
button that fails.

## 8. Trust story — what GenLayer removes, exactly

### 8.1 The layered claim (and its honest edges)

AutoCourt's operator authenticates users, stores files, extracts text, and
assembles the assessment packet — nothing about consensus changes that, so
the packet is the operator's testimony about the evidence, made
tamper-evident by per-item dual hashes and an on-chain manifest. What
GenLayer removes is everything downstream: no party, including the operator,
authors the verdict — a validator panel judges the recorded packet,
deterministic public code derives every verdict and floor from findings the
panel agreed on, and no one can re-run, rewrite, or selectively display that
record, because every run and manifest is permanently on chain for either
party to check. So a buyer is protected outright from a biased or bought
judgment and from a rewritten record, and is protected from a curated packet
by **detection rather than prevention**: committed hashes, intake receipts
(§3.6), and immutable runs make omission and alteration provable by the
party wronged.

The threat model (`docs/THREAT-MODEL.md`, brief §17) carries this as a
table: **eliminated by design** (verdict authorship, record rewriting,
selective display against the chain, silent re-rolls — §4.1),
**detectable after the fact** (extraction alteration — via dual hashes,
versioned extractor and `verify-extraction`; omission — via intake
receipts), **honest limitations** (the operator can refuse service —
AutoCourt is not censorship-resistant; the operator can stall but cannot
forge or alter; app-attested account identity; originals custody; no
antivirus). Remove GenLayer and the operator's backend becomes the author
of the judgment and the keeper of the record — those two, not everything,
are what consensus buys, and they are the two a buyer cannot audit alone.

### 8.2 Publicity, consent and redaction

Stated verbatim in the docs, the settings screen, and the consent step at
"generate assessment":

> Adjudicated evidence is public. Submitting an assessment publishes,
> permanently, on a public blockchain: the bounded normalized text extract
> of every packet item, the claim values, both hashes, and the panel's
> findings and quotes. Original files are never published — they remain in
> access-controlled app storage; only their sha256 fingerprints go
> on-chain. Private-by-default means: private until included in a submitted
> packet; inclusion is an explicit per-item consented act; redaction must
> happen before submission and is impossible after.

Consequences carried through the design: redaction runs **before** packet
build and the redacted text is what `text_sha256` commits; per-item consent
is a recorded act; the words "private", "sealed" and "revocable" are never
used for anything that has entered a packet; §16 privacy tests assert
access control for **originals and un-adjudicated items** (where it is
true), not for adjudicated text (where it would be false). The
account-and-privacy settings screen (brief §10 screen 13) is backed by:
profile + session management, the user's evidence list with visibility
state, pre-submission redaction controls, and this permanence statement.

## 9. What is deliberately absent

Payments, escrow, bonds, ownership transfer, marketplace mechanics, "AI
score" gauges, autonomous mechanical diagnosis, safety certification (brief
§3). No pooled funds → the money standards are consciously N/A (standards
map, final table). The S9 answer is the two-party adversarial reliance:
a buyer must be able to rely on a verdict the seller-facing platform
provably cannot author — which is why the intake-provenance machinery
(contract-derived corroboration, dual-hash manifest, attributable disputes,
no re-rolls, intake receipts) is the load-bearing part of this design, not
decoration.

## 10. Delivery order

1. Contract + direct-mode suite (the heart; adversarial from day one, the
   brief's §7 injection scenarios as named tests)
2. Packages: shared-types (enum partition), validation (VIN, OBD-II,
   observation rows), evidence pipeline (dual hash, redaction), db schema
3. Disposable-deploy calldata probe + validator-diversity diagnostic pass
   on Studio Next; freeze `get_config()` bounds
4. API + worker (upload → entry writes → seal → adjudicate → poll → record;
   rate limits, pagination, error envelope, leases)
5. UI — 13 screens per brief §10 (**design direction to be chosen with the
   user before this phase**), including the per-run manifest/intake view,
   run history, consent step, settings screen, and report **export** (a
   print-styled report carrying the manifest root, contract address+version
   and adjudication tx reference — a portable restatement of the on-chain
   record, no new trust surface)
6. GenVM lint, canonical deployment, live evidence, integration tests, and
   a Playwright E2E of the full seller-to-buyer journey (create → evidence
   → assess → share → buyer counter-evidence → dispute → reassess → verdict
   → revoke link returns 404/410) over a **committed deterministic seed**
   (fixture vehicles + evidence files with known sha256s, so manifest
   hashes are assertable)
7. Docs per brief §17 (README, THREAT-MODEL, verdict-model, runbook),
   release gates, clean-clone check, submission prep
