# The standards, applied before the first line of code (v2)

Forty-one standards have been generalized from GenLayer judge letters across
this portfolio. Two of the last three letters flagged the same defect in two
sibling builds a day apart, because it was inherited through a fork and only
checked where it was first found. This document exists so that cannot happen
here: it is the design-time pass, written before the contract, the schema or
the app, and every AutoCourt decision below is traceable to the standard that
forced it.

**v2 provenance.** After v1 of this pass, a four-lens adversarial design
review was run against the founding docs
([design-review-findings.md](design-review-findings.md) — 38 findings, six
blocking-class). The review found that v1, while citing the right standards,
still violated several of them in the details: the corroboration class was
derived in operator code (S7/S34), the manifest hashed bytes the panel never
read (S21), "verbatim" quote checking repeated the exact validator-family
split a sibling already paid for, and the calldata model rested on an
unproven platform ceiling. Every section below is the post-review form; the
architectural consequences live in [ARCHITECTURE.md](ARCHITECTURE.md).

Two tiers. **Architecture standards** cannot be retrofitted — getting them
wrong means a redeploy or a rebuild. **Release gates** run before every push
that claims something.

---

## The decisions the standards force

### 1. Evidence is corroborated where it ENTERS the record — S39, S21, S28

S39 (flagged blocking on Triggera, confirmed word-for-word on Verda a day
later): evidence must be corroborated **where it enters the record**, not
only where it is reused. A digest over bytes only the leader ever saw
certifies self-consistency and nothing else; every later round then
faithfully reconsiders a possible fabrication.

AutoCourt's answer, per lane (ARCHITECTURE §3):

- **Uploaded evidence** enters through bounded per-item calldata writes.
  Calldata is consensus-shared by construction: every validator reads
  byte-identical evidence because there is no other copy to read, and the
  contract recomputes the committed `text_sha256` over those bytes at entry.
  **The claim is split honestly in two** (the review caught v1 overclaiming
  here): *byte-identity at entry is structural* — every validator judges
  identical bytes; *extraction fidelity is a stated limitation* — each uploader extracts
  their own file in their own browser and signs the result, mitigated by (a)
  the on-chain `file_sha256` and pinned extractor version letting anyone
  holding the original recompute the deterministic extraction after the
  fact, (b) the counterparty's own upload channel as the corrective path,
  (c) extraction code committed and versioned in the repo. Detectable, not
  prevented — and the docs say so.
- **Independent-anchor evidence** (the only fetch in the system) inherits
  the full Verda v0.1.1 rule at entry: **every validator fetches the
  allowlisted URL itself** and agreement is exact-hash agreement on the
  bytes each fetched — no leader-private byte exists, ever. All-agree
  unavailable → item status `SOURCE_UNAVAILABLE`, never adverse; a
  reachability split → no state change. The stored, entry-corroborated text
  is what every later round reads; appeals never refetch, so the record
  does not decay with hosting.
- **No other fetch exists.** The contract never fetches a party-controlled
  URL, and no evidence path depends on the operator's servers being up at
  adjudication time.

### 2. Appeals re-judge the recorded bytes — the ones the panel actually read — S14, S28, S36, S21

The v1 design verified appeal items against the **original-file** hash while
the panel judged the **normalized text** — the S21 defect shape verbatim (a
digest covering bytes nobody re-checks), and the exact "internally
consistent dossier" hole S39 was flagged for twice. v2 closes it
structurally:

- Every manifest entry commits **both** digests plus provenance:
  `(evidence_id, file_sha256, text_sha256, extractor_version)`, root over
  all fields — the manifest binds the judged bytes, not only the source
  file.
- `RECORDED` appeal items are referenced **by id only** and read from
  contract storage; there is no parameter through which altered bytes could
  be re-supplied. `NEW` items carry full text + both hashes and are tagged
  with uploader and post-verdict timestamp (S36), and the appeal prompt
  includes the appealed run's verdict, so the panel always knows which
  evidence is being reconsidered and which arrived after the outcome was
  known.
- Prior runs are immutable; an appeal creates a new AdjudicationRun.

### 3. The subject controls identity and sources, so corroboration is derived in the CONTRACT — S27, S34, S7, S8

The seller creates the listing, declares the claims, and uploads most of the
evidence — S27's exact hazard. v1 priced it with a class "derived in code",
but that code was the **app's**: an operator-authored label the contract's
floor would have trusted (S7's exact field class), and a role-based
`COUNTERPARTY` that anyone with the seller's own share link could mint (the
sybil the review flagged three ways). v2:

- The packet carries only **primitive facts** per item (uploader account
  id, role, timestamps, hashes, entry lane) plus the recorded dispute set.
  The **contract** derives the corroboration class deterministically per
  `(claim, item, direction)` edge from those facts and the
  equivalence-agreed finding status — S7-clean, and the app's copy is
  display-only.
- The ladder is `INDEPENDENT` (entered through the every-validator anchor
  lane — integrity-bound to a host neither party controls) > `ADVERSE`
  (uploaded by an account with a recorded opposing dispute stake on that
  claim, distinct account id) > `FIRST_PARTY`. Same-account items never
  corroborate each other.
- The floors, keyed on each verdict's `adverse: bool` attribute and never
  on a name list (so `odometer_rollback_indicated` cannot slip past a
  floor that only names `CLAIM_CONTRADICTED`): a claim with only
  `FIRST_PARTY` support cannot exceed `PARTIALLY_VERIFIED`; **`VERIFIED`
  requires `INDEPENDENT` support** — opposing-role uploads are exactly what
  colluding accounts manufacture, so `ADVERSE` support strengthens adverse
  findings but never lifts a seller-favoring ceiling; adverse findings
  resting solely on the accusing party's own uploads are held at
  `INSUFFICIENT_EVIDENCE` / `PHYSICAL_INSPECTION_REQUIRED`.
- Stated plainly (S12): account identity is app-attested; Sybil collusion
  is detectable (same-hash and same-account rules, on-chain attribution)
  and priced by the ladder, not prevented.
- VIN is validated in code (format + ISO 3779 check digit). Identity beyond
  the VIN is a stated limitation, not a silent assumption.

### 4. The model returns findings; code derives every verdict — S7, S16, S22, Factora pattern

The panel never outputs the assessment verdict, a score, or anything that
steers the report by itself. It returns **per-claim findings** — supported /
contradicted / absent, with evidence references, severity, explanation
findings for the code flags, and quoted grounds. Deterministic code then:

- validates every field structurally at the boundary (enum membership,
  severity range, evidence ids must exist in the manifest — S16);
- grounds quotes by the **word-token rule**, not verbatim equality —
  character-exact checking is the rule that split StudioNet model families
  live in the sibling spine, turning honest answers into downgrades and one
  round into no verdict. Failure ladder: ungrounded quote → dropped;
  adverse finding with zero grounded quotes → **downgraded to its
  non-adverse state** (`[DOWNGRADE]` + raw quotes to validator stdout);
  `REJECTED` reserved for structural invalidity only — one weak validator
  family may cost sharpness on one finding, never the availability of the
  product's core verb (S5 applied in the right direction);
- **recomputes the code flags** (mileage-sequence conflict, duplicate-hash,
  VIN-echo) from the packet's typed observation rows inside the judged code
  path — never trusting an app-computed pre-finding (S7, S31);
- derives claim verdicts, flags, and the assessment rollup through fixed
  precedence over a **partitioned** enum (claim verdicts / code flags /
  rollup / run-and-item statuses — ARCHITECTURE §6), so one deterministic
  function cannot say `CLAIM_CONTRADICTED` at the claim and something
  contradictory at the headline;
- applies the sufficiency gate to **every** conclusive verdict, both
  directions (S22): insufficient evidence forces `INSUFFICIENT_EVIDENCE`,
  it cannot decay into either `VERIFIED` or `CLAIM_CONTRADICTED`;
- derives `confidence_band` and `recommended_next_action` **in code** from
  already-agreed inputs (the archetypal S7 fields — one review lens
  proposed putting confidence inside equivalence; the code-formula form is
  stronger, since every input is equivalence-agreed or deterministic from
  calldata, and it is recorded here as the deliberate reconciliation);
  `unresolved_questions` is the one free-prose field, rendered under an
  explicit "panel narrative — not consensus-checked" label (S12);
- treats an unknown enum, a malformed finding, or a structurally invalid
  payload as a failed adjudication that **fails closed** (S5): the
  transaction fails under consensus, state does not advance, the previous
  record stands — and the app records the refused attempt as a `REJECTED`
  run with its transaction hash, since an output that failed the gate can
  never be written on-chain.

### 5. Equivalence covers the findings, not the prose — S7, S21, CredenceLend lessons

Validators must agree on: per-claim finding status, severity band, the
evidence-id sets cited for and against, the explanation-finding states the
code flags read, and the inspection-required bit — every field the derived
report reads. Reasoning prose stays free. The disagreement diagnostic prints
the dissenter's own quotes, and the **disposable-deploy diagnostic pass**
(`[DISAGREE]`/`[DOWNGRADE]` stdout on a throwaway deploy) runs before the
canonical deployment. Two inherited lessons applied from line one:

- **No unit arithmetic in the model.** Mileage, money, dates and OBD-II
  codes are formatted by code into the exact strings the panel reads
  ("87,432 miles", "USD 4,500.00", "2024-03-07", "P0301"); the model never
  divides, converts or reformats a number that matters.
- **One home per problem.** The prompt partitions the findings space
  explicitly — a claim the records never mention is ABSENT, not
  contradicted; manipulation and irrelevance are separate questions; the
  enum partition extends the same rule to the verdict layer — because model
  families split exactly on those seams.

### 6. Party-declared labels are claims, and evidence is data — S31, S19, brief §7

The uploader picks the evidence type ("mechanic report", "service
invoice"). That label is disclosed to the panel as the uploader's claim,
never as fact, and the panel judges from the content what the document
actually is — a mislabel counts against the case it was chosen to help. A
buyer's dispute flag is treated symmetrically: a recorded assertion, not a
fact. Every string that enters the prompt is sanitized (delimiter defusal),
evidence is fenced with the sanitized-away delimiter so a party cannot type
a counterfeit evidence block into a free-text field, and the prompt states
that instructions inside evidence are content to be reported, not
commands — the brief's own prompt-injection scenarios become direct-mode
adversarial tests.

### 7. No money moves, and the trust claim is layered, not absolute — S9, S12, brief non-goals

The brief's non-goals exclude payments, escrow and enforcement, so S9 is
answered in DECISION terms: the adjudicated verdict IS the product (the
category Verda received Project credit in, with the same shape and a single
ask — evidence provenance). The review killed v1's "remove GenLayer and one
party's backend becomes the authority on every claim" as an overclaim the
operator's intake role rebuts. The defensible, layered claim (ARCHITECTURE
§8): consensus eliminates operator authorship of the **judgment** and the
**record**; intake is **tamper-evident, not trustless** — dual-hash
manifests, intake receipts, attributable disputes, and no-re-roll
preconditions are what make the S9 answer true, which is why they are
architecture, not polish. Since the rebuild as a dApp (14 Sep) there is no
operator to decline service: every party writes from its own wallet. That
first exposed the contract's writes as open to any wallet, and the redeploy
the same day bound them: every recorded account is the signer, only the
seller seals, only a recorded party judges or appeals, and intake slots are
split by side (ARCHITECTURE, "The shape today"; THREAT-MODEL for what
remains). No pooled funds → S3, S23, S24 largely N/A; recorded as consciously
out of scope rather than silently skipped.

### 8. The whole path is reachable in the UI — S40

Flagged blocking on Triggera: ten contract verbs, one clickable. Here the
brief demands thirteen screens, and the standard shapes how they are built:

- act availability is a **pure function** of (record, role, state) with its
  own test file — statuses × roles, no browser, no chain — fed by the
  role × act matrix written into ARCHITECTURE §7;
- a closed assessment states what happened to it; an empty action list is an
  answer, never a vanished panel;
- an act the backend or contract would refuse is listed with the reason in
  words, not offered as a button that fails;
- the contract's own refusal sentence surfaces on failure (decoded from the
  fee simulation or the finalized receipt, its machine tag removed), and the
  transaction lifecycle (estimating → wallet → submitted → pending → accepted
  → finalized) is visible on every write, with "finalized" claimed only at
  FINALIZED + leader SUCCESS (S32);
- the detection machinery is a SURFACE, not a principle: the per-run
  manifest view shows every party their items as "in run N" / "not in any
  run" (intake receipts), and the report links every run, so re-rolls and
  omissions are visible where users actually look.

### 9. Windows, freshness and state exits — S13, S26, S6-era lessons

Any window this product enforces (appeal windows if added) is wall-clock,
never activity-counted. Every non-terminal state names who can move it and
what happens if they never do (S26): an `OPEN` record is sealed by its
seller, and a `SEALED` record can be sent to the panel by anyone connected,
again after a failed round — so no state waits on an actor that does not
exist. A
`PHYSICAL_INSPECTION_REQUIRED` verdict is terminal-but-reopenable by new
evidence. Evidence or disputes arriving after a verdict never mutate that
verdict — they can only open a new run (S33's shape: no objection a
standing verdict never read).

---

## Release gates (run before every push that claims anything)

| gate | standard | check |
|---|---|---|
| One address everywhere | S37 | grep the repo for the contract address; `.env.example`, docs, CI and README must agree on the deployment of record |
| Proofs claim what scripts assert | S38 | every "live proof" sentence points at the assertion that fails without it; observational wording otherwise |
| Narrative honesty | S12 | README claims nothing the code does not do; "consensus-checked" only for fields inside equivalence; nothing that has entered a packet called "private", "sealed" or "revocable" |
| Every enum value reachable or RESERVED | S12 | grep the verdict enum: each value has a producing code path, or an explicit RESERVED note naming why (e.g. `VERIFIED` under an empty anchor allowlist; `SOURCE_UNAVAILABLE` is an item status, not a claim verdict) |
| Finality language | S32 | FINALIZED only from the receipt; ACCEPTED is written as ACCEPTED |
| Adversarial names tell the truth | S39 lesson | grep tests for `tolerated` / `endorsed` / `is True` on adversarial cases — each is a decision to re-derive, not inherit |
| Bounds frozen only after the probe | template §6.8 | the disposable-deploy calldata probe ran on the target network before `get_config()` bounds were frozen; the diversity diagnostic pass ran before the canonical deploy |
| Intake receipts hold | brief §16, S40 | the receipt page reads the sealed manifests from the contract and places every item the connected wallet wrote in one, or says it is not sealed yet |
| Publicity consent is live | brief §15, S12 | the verbatim publicity statement (ARCHITECTURE §8.2) appears in the publish step, which cannot be completed without acknowledging it |
| Secrets | template §1.4 | no keys, mnemonics or tokens in the repo; the web app needs none at all, and `web/.env.example` names only public values |
| Test claims | S11, S30 | counts stated only from a run in this session; the pure act function (`web/lib/acts.ts`) is tested across states × roles, including post-terminal actions (evidence after a final verdict, appeal past the run limit), and the contract's §4.1 preconditions refuse a second judgment of one packet on chain |

## Standards consciously N/A here, and why

- **S1** (enforce recorded windows): no term-bound rights in MVP.
- **S3/S23/S24** (pooled deposits, reserves, atomic settlement): no funds held.
- **S15/S17** (stake symmetry, appeal fund-escape): no bonds in MVP; if a
  dispute bond is ever added, these activate before it ships.
- **S25** (one adjudicator per case): single canonical contract adjudicates
  every run; binding is trivial but still recorded per run via the contract
  address + version in each verdict, and the §4.1 preconditions stop two
  runs racing one assessment.

Everything else above is either load-bearing (§1–§9) or a live release gate.
S41 itself is honored by this document's existence: the standards were read
at design time, the review ran before the code, and any letter this build
earns gets generalized into the shared file the session it is answered.
