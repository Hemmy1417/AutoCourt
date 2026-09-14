# AutoCourt — architecture

Product: evidence-based used-vehicle verification. A seller lists a vehicle
and declares claims; evidence accumulates from both sides; a GenLayer
Intelligent Contract adjudicates the claims against the evidence and the app
renders a claim-by-claim verdict a buyer can trust — including the honest
outcomes: insufficient, conflicting, inspection-required.

Every decision below is downstream of [STANDARDS-MAP.md](STANDARDS-MAP.md).
Read that first; this file says *what* is built, that one says *why it must
be built that way*.

## The shape today: a dApp (since 14 Sep 2026)

AutoCourt was first built full stack: a Next.js app with API routes,
PostgreSQL, a job queue and a worker that sent every transaction from an
operator's wallet. On 14 Sep the Vercel build of that monorepo failed, and the
user directed the build into the shape of their Verda repository: one web app
that talks to the contract directly. The contract needed no change to run
without an operator, because it never checked for one. That same evening it
was redeployed to close the gap the operator had been hiding (see below), so
the app now serves a new deployment of record, and the earlier deployment's
records and proofs stay on chain where the README lists them.

| | |
|---|---|
| Layout | `contracts/` (the contract), `tests/direct/` (its suite), `web/` (one Next.js app with its own lockfile and scripts), `docs/`, `fixtures/` |
| Reads | straight from the visitor's browser to Studio Next through genlayer-js, typed in `web/lib/read.ts`. Contract reads share a 30-per-minute bucket per IP (measured, with the RPC's CORS headers present on refusals too), so the layer paces a tab at 20 a minute, caches, and retries a rate-limit refusal. There is no server proxy, deliberately: a proxy would pool every visitor into one budget |
| Writes | signed by the connected wallet (EIP-6963 discovery, silent reconnect) and sent by `web/lib/tx.ts`: size the fee deposit, sign, then confirm by reading the record back, and say "finalized" only when the transaction reports it. A deterministic write is simulated first, so a refusal arrives in the contract's words before anything is signed; a write whose method fetches the web or runs the panel is priced with the plain estimate |
| Fees | test GEN on Studio Next. The wallet menu requests it from the network's faucet (`sim_fundAccount`) for the connected address |
| Evidence | read, fingerprinted, redacted and signed in the uploader's browser (`web/lib/evidence`). The original file never leaves it; the reviewed text, both hashes, typed readings and the uploader's signature enter the record in one write, the moment the uploader publishes |
| Independent sources | the browser commits the fingerprint of the text GenVM's webdriver will render (`web/lib/evidence/anchor.ts`), and every validator fetches the page itself |
| State | the contract's. No database, no sessions, no queue, no stored files, no secrets on any server |
| Deployment | Vercel, root directory `web`, no environment variables required (the deployment of record is the default; `NEXT_PUBLIC_*` variables override it) |

What this removed: the operator. With it went the operator's testimony about
extraction (the uploader now extracts and signs their own text), the job
queue's failure and retry machinery (each write is one signed transaction with
a visible lifecycle), share links and sessions (a record is public; a wallet
is the identity), and the private pre-submission draft (an item is public the
moment its uploader publishes it, and the publish step says so). What it
exposed: the contract's writes were open to any wallet, which the operator
used to hide. The redeploy closed that in the contract itself (ruleset
`autocourt-rules-3`, then `-4`):

- **Every account a write records is the wallet that signed it** — the seller
  of record, each uploader, each disputer, each appellant. A claimed account
  that differs from the signer is refused in words, never recorded.
- **Only the seller of record seals.** Only a recorded party (the seller, a
  disputer, an uploader, or a wallet that added an independent source) may
  ask for the panel, add appeal evidence or appeal.
- **Intake slots are split by side.** Before sealing the seller owns 5 of the
  8 slots and every other wallet shares 3; each appeal's 4 new slots split
  2 and 2. An independent source spends a slot on the side of the wallet
  that asked for it, which the record names (`added_by`).
- **An anchor URL must name a plain host,** so userinfo, a backslash or a
  port cannot smuggle a different host past the allowlist.
- **The allowlist names a real public authority,** `api.nhtsa.gov`: NHTSA's
  recall records, which a render probe showed every validator reaching and
  agreeing on before the deploy (PROBE-REPORT.md).

Designing the recall proof then exposed one asymmetry in the derivation,
fixed in `autocourt-rules-4` before the new deployment held a record: first-
party support could turn an independent source's contradiction into
`CONFLICTING_EVIDENCE` (§4.4). [THREAT-MODEL.md](THREAT-MODEL.md) states what
remains.

The sections below are the founding decisions. The contract design (§1, §3.2
to §3.5, §4, §6) is exactly what is deployed. Where a section described the
full-stack app, it now describes the dApp, and says what it replaced.

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

On 14 Sep 2026 the user re-ruled the product half's delivery shape: one web
app that talks to the contract directly, like their Verda repository, in
place of the full-stack backend. The contract discipline above is unchanged.

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

*Rewritten 14 Sep: the monorepo, PostgreSQL, the storage adapter, sessions and
the job queue are gone (see "The shape today").* What carried over unchanged,
now in `web/lib`:

- **Magic-byte sniffing.** A file's type is established from its bytes,
  never its extension or declared MIME (`evidence/sniff.ts`).
- **Honest extraction.** Plain text and PDFs with embedded text are
  extracted; anything else enters as a fingerprint with no text, which the
  panel is told about, never silently dropped and never fabricated (brief
  §16). The extractor carries a version string that the on-chain manifest
  commits per item (§3.4). Extracted text is rendered as plain text only.
- **Wallet-only identity.** The account IS an address. It is the seller of
  record, the uploader on every item it signs, and the disputer on every
  dispute it sends, and the contract enforces that: every account a write
  records is the transaction's signer. Identity is self-attested (anyone can
  mint wallets), and the corroboration ladder (§4.4) is designed so that buys
  nothing that matters.
- **Validation in code.** VIN format and check digit, OBD-II code shape and
  mileage parsing (`validation/`), each with unit tests.
- **Acts as a pure function.** What a visitor may do to a record is computed
  from the record, the contract's published limits and the connected account
  (`acts.ts`); a blocked act shows its reason in words (S40).

## 3. Evidence: how bytes enter the record

The single largest v1→v2 change. The judged bytes live **in contract
storage, entered through bounded per-item writes** — never through one
mega-packet transaction (unproven calldata ceiling), and never through a
leader-private fetch (S39). Three lanes:

### 3.1 Uploaded evidence (the default lane)

```
in the uploader's browser:
  choose file → magic-byte type check → sha256(original)
      → extract text (versioned extractor) → normalize → redact (§8.2)
      → sha256(normalized_text) → uploader signs both hashes (EIP-191)
      → submit_evidence_text(...) from the uploader's wallet, one write per item
```

Each `submit_evidence_text` write carries one item: evidence id, declared
type (disclosed as the uploader's claim — S31), uploader account id and
role, capture/upload timestamps, MIME class, extraction status, **both
hashes** (`file_sha256`, `text_sha256`), extractor version, the bounded
normalized text (≤ 6,000 chars), that item's **typed observation rows**
(§3.3), and the uploader's signature over both hashes. The whole JSON argument stays ≤ 8,000 chars — the envelope sibling
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
(format-checked `[PBCU]\d{4}`, deduplicated, in `web/lib/validation` with
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
party-asserted (an uploader would be stamping its own labels), so it is a
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
- The expected sha256 is taken over the text a validator will actually
  hash: GenVM's `render(url, mode="text")` returns the page's
  `innerText` passed through its webdriver's `normalizeWhitespace` (each
  line trimmed, whitespace runs collapsed, blank-line runs collapsed), and the
  contract hashes the first 8,000 characters of that. The app reproduces it
  exactly for plain-text and JSON pages (`web/lib/evidence/anchor.ts`). Found
  live on the earlier deployment: `ac-000023`'s registry extract, whose
  readings sit in columns, entered `SOURCE_UNAVAILABLE` when the fingerprint
  was taken over the raw bytes although every validator reached it and
  agreed; the same file entered `EXTRACTED` on `ac-000024` once it was taken
  over the rendered text.
- The allowlist names two hosts. `api.nhtsa.gov` is a public authority:
  NHTSA's recall records, served as JSON, which the record page offers as a
  one-click source for the listed make, model and year. Commit-pinned
  `raw.githubusercontent.com` stays for documents no public API publishes,
  standing in for a registry. The wallet that asks for a source is recorded
  as `added_by`, and the source spends a slot on that wallet's side.
- Before the host was frozen into a deployment, a disposable probe contract
  had every validator render three URLs and agree on a digest, and the app's
  fingerprint function reproduced each digest (PROBE-REPORT.md, "The render
  probe").

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

Every party writes its own items and disputes from its own wallet, so no
intermediary can drop one. The **intake receipt** still shows the connected
wallet each of its items against the contract's sealed manifests ("in the
sealed packet, version N", or on the record and not yet sealed), because an
item that is not in a sealed manifest cannot have been judged.

## 4. The contract (`contracts/autocourt_assessment.py`)

One canonical deployable contract. Surface (names final, signatures refined
at implementation):

| method | kind | does |
|---|---|---|
| `create_assessment(vehicle_json, claims_json)` | write, nondet | VIN code-validated (format + ISO 3779 check digit) then decoded at the federal registry by every validator; the seller of record is the signer; bounded claim set with the seller's declared values; returns `ac-NNNNNN` |
| `submit_evidence_text(id, item_json)` | write, det | one uploaded item (§3.1) in the signer's name, role SELLER for the seller of record and BUYER for any other wallet; verifies `text_sha256` over the supplied text; refuses past the side's slots, past caps or after seal |
| `submit_anchor_item(id, item_json)` | write, nondet | independent-anchor entry (§3.5); strict host parsing, then the signer's side slot; every validator fetches; exact-hash equivalence; records `added_by` |
| `record_dispute(id, account, claim_ids_json, note)` | write, det | disputed-claim flags + bounded note in the signer's name (never the seller's); recordable before AND after seal — a post-verdict dispute is what opens the appeal path, tagged with the run count it followed |
| `submit_assessment(id, manifest_root)` | write, det | seals the packet, from the seller of record only: the manifest root is recomputed against stored items; immutable once sealed |
| `adjudicate(id)` | write, nondet | from a recorded party only: one panel round over the **stored** packet; findings validated at the boundary; verdicts derived in code; run recorded |
| `submit_appeal_evidence(id, item_json)` | write, det | from a recorded party only: NEW post-verdict item (≤ 4 per appeal, 2 per side), tagged with uploader and phase (S36) |
| `readjudicate(id, appellant_account, grounds)` | write, nondet | appeal in the signer's name, by a recorded party: RECORDED items by id reference (read from storage — §3.4), NEW items from appeal evidence, the appealed run's headline included in the prompt (brief §13); prior runs immutable |
| `get_assessment` / `get_run` / `get_verdict` / `get_manifest` | views | the record, machine-readable; `get_verdict` returns the latest terminal-success run **plus run number and total runs**, so a superseded verdict can never be confused with the standing one |
| `get_stats()` / `get_config()` | views | counters; every bound and the anchor allowlist, so the frontend never guesses a limit |

### 4.1 Preconditions (the S30/S25 guards)

`adjudicate` refuses unless the record is sealed and holds fewer than
`MAX_RUNS_PER_ASSESSMENT` runs, and it refuses when a terminal-success run
over the identical packet version already stands: a re-roll is only reachable
through `readjudicate`, which is a recorded, attributed, capped act —
verdict-shopping is unrepresentable, not merely auditable. `readjudicate`
is callable only from `ADJUDICATED`, only by a **recorded party** signing in
its own name (the seller of record, or a wallet with recorded evidence, a
recorded dispute or an independent source it asked for on this record), and
only when there is new evidence or a new dispute. Each refusal sentence names
the specific precondition. `adjudicate` asks the same of its caller: any
recorded party may ask the panel to judge a sealed packet, and a round that
fails leaves the record sealed for any of them to ask again. A stranger
becomes a party by disputing a claim in its own name.

### 4.2 Failure ladder (S5, complete)

| failure | behavior |
|---|---|
| validator "cannot obtain bytes" (uploaded lane) | impossible by construction — judged bytes are consensus state; the only byte-level failure is a state read failure = transaction failure, state unchanged |
| anchor fetch: all nodes unreachable or hash-mismatch | item enters as `SOURCE_UNAVAILABLE` status; never an adverse finding |
| anchor fetch: reachability split | no state change; retry — never a verdict from partial sight |
| transport failure before a transaction exists | nothing reached the chain and nothing was signed; the write reports it and the button is usable again. A failure to READ a submitted transaction is never a failure of the write: the hash is shown and polling continues |
| LLM failure mid-round (the round ends without a verdict) | state unchanged on chain, the record stays SEALED, and any recorded party may request adjudication again: a new round with its own transaction |
| malformed / structurally invalid model output | never survives consensus: the leader is refused and rotated, and if no valid output emerges the transaction fails with state unchanged. The chain records only judgments that survived consensus |
| ungrounded quote on one finding | **not** a run failure — drop-and-downgrade (§4.5) |
| protocol-level UNDETERMINED / CANCELED | no contract outcome, never mapped to a verdict. The write reports that the validators did not agree and nothing was recorded; sending it again starts a fresh round. A status that has not answered yet is polled, never resubmitted: a lost response is not a refusal |

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
verdict's `adverse` attribute (§6), never on a name list.

Neither side's own uploads can turn an independent source into a conflict.
An accuser's first-party contradiction against `INDEPENDENT` support caps the
claim at `PARTIALLY_VERIFIED` (or forces inspection when severe) instead of
minting `CONFLICTING_EVIDENCE`. The mirror, added in `autocourt-rules-4`:
support that is only `FIRST_PARTY` (the seller's own paperwork, or a wallet
that never disputed the claim) against an `INDEPENDENT` contradiction is
judged as the contradiction alone would be, `CLAIM_CONTRADICTED` when the
record is sufficient. Before it, a seller could answer NHTSA's recall list
with a signed declaration and turn a contradiction into "conflicting
evidence". The live recall record exercised exactly that: its appeal panel
read the seller's declaration as support, and the claim stayed contradicted.

Stated plainly: identity is a wallet, and the contract binds every recorded
account to the transaction's signer; Sybil collusion (one person, several
wallets) is *detectable* (same-hash, same-account rules, on-chain
attribution) and *priced* (the ladder), not prevented.

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
MAX_NEW_ITEMS_PER_APPEAL 4 · slots by side: seller 5 / others 3 before
sealing, 2 / 2 per appeal · MAX_DISPUTING_ACCOUNTS 8 · PER_ITEM_TEXT_CAP 6000 chars ·
PER_WRITE_JSON_CAP 8000 chars · TOTAL_JUDGED_TEXT_CAP 72000 ·
MAX_RUNS_PER_ASSESSMENT 4 · QUOTE_MIN 8 / QUOTE_CAP 240 / MAX_QUOTES 3 ·
NOTE_CAP 200 · VIN length 17 · ANCHOR_FETCH_CAP 8000 bytes ·
LEADER_PAYLOAD_PARSE_CAP 300000` — every number inside the envelope sibling
builds proved live, none frozen until the disposable-deploy calldata probe
confirms them on the target network (§1).

## 5. Data model

*Rewritten 14 Sep: there is no database.* The record is the contract's state,
read through its views: `get_assessments(offset, limit)` lists record ids,
`get_assessment` returns a record with its claims, items (without text) and
disputes, `get_item_text` one item in full, `get_manifest` a sealed
manifest, `get_run` one immutable run and `get_verdict` the standing one.
Their shapes are typed in `web/lib/types.ts`, read from the contract rather
than guessed. Every run renders from the contract; nothing is cached anywhere
it could disagree with the chain.

## 6. Verdict model — a partition, not a flat enum

The brief's 13 values are all implemented in the contract and presented
through `web/lib/present.ts`, but they are **four different kinds of thing**,
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
- **(d) Item statuses** (never verdicts): `SOURCE_UNAVAILABLE` (an
  independent source whose validators' bytes did not match its committed
  fingerprint, or that none could reach — §3.5; for uploaded items the
  analogue is an item with no extractable text, disclosed to the panel, with
  the sufficiency gate steering claims that rest on it to
  `INSUFFICIENT_EVIDENCE` / `PHYSICAL_INSPECTION_REQUIRED`). A round that
  fails consensus records nothing on chain, so it has no status to carry.

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

*Rewritten 14 Sep for the contract's own states.* **Record**: `OPEN`
(taking evidence, sources and disputes) → `SEALED` (the manifest root is
recomputed over the stored items; intake is closed) → `ADJUDICATED` (a run
survived consensus). `ADJUDICATED --appeal (new evidence or a new
dispute)--> ADJUDICATED` with a new run and a new packet version, up to the
contract's run limit. A failed round leaves the record SEALED for any
recorded party to retry, so no state waits on a single mover that might not
come (S26). **Evidence
after a verdict** never mutates the verdict; it enables a new run (S33 shape).
**A dispute after a verdict** does the same.

**Role × act matrix** (`web/lib/acts.ts`, pure, unit-tested, mirroring the
contract rule for rule): the seller of record opens the record, adds evidence
and sources within the seller's 5 slots, and seals; any other connected
wallet adds evidence and sources in its own name within the 3 slots the other
wallets share, and disputes claims; a recorded party (the seller, a disputer,
an uploader or a wallet that asked for a source) requests adjudication of a
sealed packet, adds appeal evidence within its side's 2 slots, and appeals. An
act a precondition blocks is listed with the reason in words, not offered as a
button that fails, and each upload card says how many slots the wallet's side
has left.

## 8. Trust story — what GenLayer removes, exactly

### 8.1 The layered claim (and its honest edges)

Each party extracts, redacts and signs their own evidence, and writes it
from their own wallet; that text is the party's testimony about their
document, made attributable by the signature and tamper-evident by the dual
hashes in the sealed manifest. What GenLayer removes is everything
downstream: nobody authors the verdict — a validator panel judges the
recorded packet, deterministic public code derives every verdict and floor
from findings the panel agreed on, and nobody can re-run, rewrite or
selectively display that record, because every run and manifest is
permanently on chain for anyone to check. The one fact no party supplies, the
vehicle's identity, is read from the federal registry by every validator.

The threat model (`docs/THREAT-MODEL.md`, brief §17) carries this as a
table: **eliminated by design** (verdict authorship, record rewriting,
silent re-rolls, a write in another wallet's name, a stranger sealing or
re-judging a record, a document passed off as another party's),
**detectable after the fact** (extraction that misstates a document, Sybil
patterns), **honest limitations** (shared non-seller slots, wallet-only
identity, permanent publicity, what a model-year recall list can say).

### 8.2 Publicity, consent and redaction

Stated verbatim in the publish step of every upload:

> Evidence on AutoCourt is public. Publishing an item writes, permanently,
> to a public blockchain: its bounded text extract after your redactions,
> your declared label and readings, both fingerprints and your signature
> over them. The panel's findings and quotes are public too. Original files
> never leave your browser; only their fingerprints go on chain. Redact
> before you publish, because nothing on the chain can be removed afterwards.

Consequences carried through the design: redaction happens in the browser
**before** publishing, and the redacted text is what `text_sha256` commits;
publishing requires an explicit acknowledgement of that statement; the words
"private" and "revocable" are never used for anything on the record.

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

## 10. Delivery order (the founding plan, kept as a record)

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
