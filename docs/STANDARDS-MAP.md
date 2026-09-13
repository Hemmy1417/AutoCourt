# The standards, applied before the first line of code

Forty-one standards have been generalized from GenLayer judge letters across
this portfolio. Two of the last three letters flagged the same defect in two
sibling builds a day apart, because it was inherited through a fork and only
checked where it was first found. This document exists so that cannot happen
here: it is the design-time pass, written before the contract, the schema or
the app, and every AutoCourt decision below is traceable to the standard that
forced it.

Two tiers. **Architecture standards** cannot be retrofitted — getting them
wrong means a redeploy or a rebuild. **Release gates** run before every push
that claims something.

---

## The decisions the standards force

### 1. Evidence enters the record through calldata, never through a leader's private fetch — S39, S21, S28

S39 (flagged blocking on Triggera, confirmed word-for-word on Verda a day
later): evidence must be corroborated **where it enters the record**, not only
where it is reused. A digest over bytes only the leader ever saw certifies
self-consistency and nothing else; every later round then faithfully
reconsiders a possible fabrication.

AutoCourt's evidence is user-uploaded files — PDFs, images, scanner reports —
which validators cannot independently fetch from the open web. So the design
refuses the leader-fetch shape entirely:

- The assessment packet the contract judges carries the **normalized evidence
  content itself** (bounded extracted text, per-item sha256, the manifest
  root) **in calldata**. Calldata is consensus-shared by construction: every
  validator reads byte-identical evidence because there is no other copy to
  read. Corroboration-at-entry is structural, not procedural.
- The contract performs **no web fetch of party-controlled URLs**. There is no
  leader-private byte anywhere in the record. (If a later version adds a
  contract-side fetch of, say, a public vehicle-history page, that fetch
  inherits the full Verda v0.1.1 rule: each validator binds the stored excerpt
  to bytes it fetched itself, prefix-compatible, never empty-on-readable.)
- The app-side pipeline (upload → hash → extract → normalize) is deterministic
  software; the on-chain record binds to it through the manifest hash, and the
  stored original files let anyone recompute that hash after the fact.

### 2. Appeals re-judge the recorded packet, and the record names old vs new — S14, S28, S36

Every adjudication run stores the packet hash it judged. A readjudication
(appeal with new evidence) builds a new packet in which every item is tagged
`RECORDED` (byte-identical to an item in the appealed run's manifest, verified
by hash) or `NEW` (entered after the verdict was known, attributed to who
added it). Prior verdicts are immutable — an appeal creates a new
AdjudicationRun; nothing overwrites history. The panel is told which evidence
is being reconsidered and which arrived after the outcome was known, because
S36 says a record that cannot distinguish them cannot support an appeal.

### 3. The subject controls identity and sources, so corroboration is a floor in pure code — S27, S34, S8

The seller creates the listing, declares the claims, and uploads most of the
evidence. That is S27's exact hazard: the judged party manufactures both the
identity and the record. AutoCourt does not pretend otherwise — it prices it:

- Every evidence item carries a **corroboration class derived in
  deterministic code**, never asserted by the panel and never by the
  uploader: `FIRST_PARTY` (uploaded by the party the claim favours),
  `COUNTERPARTY` (uploaded by the opposing party), `CORROBORATED` (two or
  more items from parties with opposing interests, or an item whose integrity
  binds to an independent registrable source).
- The deterministic verdict function enforces the floor: **a claim supported
  only by FIRST_PARTY evidence can never reach `VERIFIED`** — the ceiling is
  `PARTIALLY_VERIFIED`, and the finding must say what independent evidence
  would lift it. Adverse findings against a party likewise cannot rest solely
  on the accusing party's own uploads: the floor holds them at
  `PHYSICAL_INSPECTION_REQUIRED` / `INSUFFICIENT_EVIDENCE` rather than
  `CLAIM_CONTRADICTED`.
- VIN is validated in code (format + check digit). Identity beyond the VIN is
  a stated limitation, not a silent assumption.

### 4. The model returns findings; code derives every verdict — S7, S16, S22, Factora pattern

The panel never outputs the assessment verdict, a score, or anything that
steers the report by itself. It returns **per-claim findings** — supported /
contradicted / absent, with evidence references, severity, and quoted
grounds. Deterministic code then:

- validates every field structurally at the boundary (enum membership,
  severity range, evidence IDs must exist in the manifest, quotes must appear
  verbatim in the referenced item's stored text — S16, S19);
- derives claim verdicts and the overall assessment through a fixed
  precedence function (S7: nothing decisive lives outside what validators
  agreed);
- applies the sufficiency gate to **every** conclusive verdict, both
  directions (S22): insufficient evidence forces `INSUFFICIENT_EVIDENCE`, it
  cannot decay into either `VERIFIED` or `CLAIM_CONTRADICTED`;
- treats an unknown enum, a malformed finding, or a quote that does not
  ground as a failed adjudication that **fails closed** (S5): the run records
  `REJECTED` for the model output, state does not advance, and the previous
  record stands.

### 5. Equivalence covers the findings, not the prose — S7, S21, CredenceLend lessons

Validators must agree on: per-claim status, severity band, the evidence-ID
sets cited for and against, mileage-conflict flags, and the
inspection-required bit — the fields the derived report reads. Reasoning
prose stays free. The disagreement diagnostic prints the dissenter's own
quotes (a split you cannot diagnose from chain stdout is a split you cannot
fix). Two inherited lessons applied from line one:

- **No unit arithmetic in the model.** Mileage, money and dates are formatted
  by code into the exact strings the panel reads ("87,432 miles",
  "USD 4,500.00", "2024-03-07"); the model never divides, converts or
  reformats a number that matters.
- **One home per problem.** The prompt partitions the findings space
  explicitly — a claim the records never mention is ABSENT, not contradicted;
  manipulation and irrelevance are separate questions — because model
  families split exactly on those seams.

### 6. Party-declared labels are claims, and evidence is data — S31, S19, section 7 of the brief

The uploader picks the evidence type ("mechanic report", "service invoice").
That label is disclosed to the panel as the uploader's claim, never as fact,
and the panel judges from the content what the document actually is — a
mislabel counts against the case it was chosen to help. Every string that
enters the prompt is sanitized (delimiter defusal), evidence is fenced with
the sanitized-away delimiter so a party cannot type a counterfeit evidence
block into a free-text field, and the prompt states that instructions inside
evidence are content to be reported, not commands — the brief's own
prompt-injection scenarios become direct-mode adversarial tests.

### 7. No money moves, and that is documented, not hidden — S9, brief non-goals

The brief's non-goals exclude payments, escrow and enforcement, so the
economic-substance standard (S9) is answered in DECISION terms rather than
with a bond: the adjudicated verdict IS the product (a Project, the category
Verda received credit in with the same shape), the full trust weight sits on
the assessment, and nothing in the contract pretends to move value it does
not hold. No pooled funds → S3, S23, S24 largely N/A; they are recorded as
consciously out of scope rather than silently skipped.

### 8. The whole path is reachable in the UI — S40

Flagged blocking on Triggera: ten contract verbs, one clickable. Here the
brief demands thirteen screens, and the standard shapes how they are built:

- act availability is a **pure function** of (record, role, state) with its
  own test file — statuses × roles, no browser, no chain;
- a closed assessment states what happened to it; an empty action list is an
  answer, never a vanished panel;
- an act the backend or contract would refuse is listed with the reason in
  words, not offered as a button that fails;
- the contract's own refusal sentence surfaces verbatim on failure, and the
  transaction lifecycle (submitted → accepted → finalized) is visible, with
  "finalized" claimed only at FINALIZED + leader SUCCESS (S32).

### 9. Windows, freshness and state exits — S13, S26, S6-era lessons

Any window this product enforces (share-link expiry, appeal windows if added)
is wall-clock, never activity-counted. Every non-terminal state names who can
move it and what happens if they never do (S26): an assessment stuck in
`PROCESSING` has a timeout path to `FAILED` with retry; a `PHYSICAL_
INSPECTION_REQUIRED` verdict is terminal-but-reopenable by new evidence.
Evidence uploaded after a verdict never mutates that verdict — it can only
open a new run (S33's shape: no objection a standing verdict never read).

---

## Release gates (run before every push that claims anything)

| gate | standard | check |
|---|---|---|
| One address everywhere | S37 | grep the repo for the contract address; `.env.example`, docs, CI and README must agree on the deployment of record |
| Proofs claim what scripts assert | S38 | every "live proof" sentence points at the assertion that fails without it; observational wording otherwise |
| Narrative honesty | S12 | README claims nothing the code does not do; "consensus-checked" only for fields inside equivalence; nothing user-visible called "sealed" or "guaranteed" |
| Finality language | S32 | FINALIZED only from the receipt; ACCEPTED is written as ACCEPTED |
| Adversarial names tell the truth | S39 lesson | grep tests for `tolerated` / `endorsed` / `is True` on adversarial cases — each is a decision to re-derive, not inherit |
| Secrets | template §1.4 | no keys, mnemonics or tokens in the repo; `.env` gitignored with `.env.example` committed |
| Test claims | S11, S30 | counts stated only from a run in this session; invariant tests exist for concurrency (two runs racing one assessment) and post-terminal actions (evidence after verdict, appeal after appeal) |

## Standards consciously N/A here, and why

- **S1** (enforce recorded windows): no term-bound rights in MVP.
- **S3/S23/S24** (pooled deposits, reserves, atomic settlement): no funds held.
- **S15/S17** (stake symmetry, appeal fund-escape): no bonds in MVP; if a
  dispute bond is ever added, these activate before it ships.
- **S25** (one adjudicator per case): single canonical contract adjudicates
  every run; binding is trivial but still recorded per run via the contract
  address + version in each verdict.

Everything else above is either load-bearing (§1–§9) or a live release gate.
