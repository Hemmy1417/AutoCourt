<p align="center">
  <img src="apps/web/app/icon.svg" width="72" alt="AutoCourt" />
</p>

<h1 align="center">AutoCourt</h1>

<p align="center">
  Used-vehicle claims, adjudicated. A seller declares the claims, evidence
  goes on a public record — both sides — a validator panel judges it, and
  deterministic public code derives every verdict. Nobody, including the
  operator, authors the outcome.
</p>

---

## The deployment of record

| | |
|---|---|
| Contract | [`0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998`](https://explorer-studio-dev.genlayer.com/address/0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998) |
| Network | GenLayer Studio Next, chain 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Source | [`contracts/autocourt_assessment.py`](contracts/autocourt_assessment.py) — byte-verified: `node scripts/deploy.mjs verify 0xE26B3C4A…7998` reports byte-for-byte identity (sha256 `aac854f1…01ac`) |
| Superseded | `0x214821A6…5555` (opening round split on an immaterial sufficiency bit), `0xE9d81837…C6a9` (appeal round split on one marginal citation), then `0x283E59d0…3c30` (superseded by the independent identity check below, not by a defect) — every split is documented with its receipts in [PROBE-REPORT](docs/PROBE-REPORT.md) |
| Anchor allowlist | `["raw.githubusercontent.com"]` — the proven independent evidence host on this network, standing in for vehicle registries; visible in `get_config()`, and `VERIFIED` is reachable only through it |

## What the contract owns, and what it refuses to

The operator's app authenticates wallets, stores files, extracts text and
assembles packets — that part is testimony, made tamper-evident by dual
hashes in an on-chain manifest. Everything downstream is consensus:

- **The contract checks the listing's core claim itself.** Before a record
  exists, every validator decodes the VIN at the public federal registry
  (NHTSA vPIC) and must agree on what it read. This is the one fact on an
  AutoCourt record that no party supplies — not the seller, not the buyer,
  not the operator — and it runs on every assessment. A mismatch caps
  every claim below `VERIFIED` and takes the headline; an unreachable or
  undecodable registry is recorded as absence, never as an accusation.
- **Evidence is corroborated where it enters the record.** Uploaded text
  arrives as calldata with its hash recomputed at entry by every
  validator; anchor pages are fetched by every validator itself. No
  leader-private byte exists anywhere. The anchor lane is reachable from
  the app — "Add an independent source" — and it is the only path to
  `VERIFIED`, so the strongest verdict in the system is earnable by using
  the product, not only by running a script.
- **Uploaders attest to their own bytes.** The wallet that uploads a
  document signs its text hash, and the signature lands on the public
  record beside the hash it covers. Anyone can verify forever that these
  are the bytes that account signed, so the operator can assemble a packet
  but cannot substitute a document. Unsigned items are recorded AS
  unsigned.
- **The model returns findings; code derives every verdict.** The panel
  outputs per-claim, per-item findings with quotes that must ground
  word-token-wise in the recorded text. Deterministic code — run
  identically inside every validator — derives the corroboration class of
  every edge, every claim verdict, the flags, the rollup, confidence and
  next action.
- **Floors key on attributes, never names.** A claim backed only by its
  own side's uploads cannot reach `VERIFIED`; an accusation resting only
  on the accuser's uploads cannot become `CLAIM_CONTRADICTED`; the
  rollback flag needs two distinct wallets or an anchor.
- **Appeals re-read the recorded bytes.** `RECORDED` items are referenced
  by id and read from contract storage — there is no parameter through
  which replacement bytes could travel. Prior runs are immutable.
- **Verdict-shopping is unrepresentable.** A second adjudication of an
  unchanged manifest is refused; a re-judgment is only reachable as a
  recorded, attributed, capped appeal.

## The verdict model

| kind | values |
|---|---|
| claim verdicts (one per claim) | `VERIFIED` · `PARTIALLY_VERIFIED` · `CLAIM_CONTRADICTED` · `CONFLICTING_EVIDENCE` · `INSUFFICIENT_EVIDENCE` · `PHYSICAL_INSPECTION_REQUIRED` · `INCONCLUSIVE` |
| code-derived flags | `mileage_conflict` · `odometer_rollback_indicated` · `diagnostic_concern_supported` · `vehicle_identity_mismatch` |
| assessment rollup (fixed precedence) | identity mismatch ≻ `POSSIBLE_ODOMETER_ROLLBACK` ≻ `MILEAGE_CONFLICT` ≻ `MATERIAL_CONCERN` ≻ `DIAGNOSTIC_CONCERN_SUPPORTED` ≻ … |
| statuses, never verdicts | `REJECTED` (an attempt consensus refused — app-side with its tx hash) · `SOURCE_UNAVAILABLE` (an anchor, or the registry, all validators agreed was gone) |
| identity, from the registry | `CONFIRMED` · `MISMATCH` · `UNDECODABLE` · `SOURCE_UNAVAILABLE` |

Corroboration ladder, derived in-contract per (claim, item, direction)
edge: `INDEPENDENT` (every-validator anchor) > `ADVERSE` (recorded
opposing stake, distinct wallet) > `FIRST_PARTY`. Items from one wallet
are one voice. `VERIFIED` requires `INDEPENDENT`.

## Lifecycle

```
seller creates ──► evidence enters ──► disputes recorded ──► SEAL
   (claims)      (per-item writes,      (opposing stakes)  (manifest root
                  hash checked at                           recomputed over
                  entry; anchors                            stored items)
                  fetched by every                              │
                  validator)                                    ▼
        appeal ◄── ADJUDICATED ◄──────────────────────── panel round
   (new items tagged;   │                          (findings + grounded
    RECORDED bytes      ├──► report · claim-by-claim ·  quotes; verdicts
    re-read from        │    intake receipt · share     derived in code)
    storage; ≤4 runs)   ▼
                  the standing verdict names its run AND the total
```

## Measured before frozen

The write envelope and the panel round were both measured on disposable
deploys before anything canonical existed
([docs/PROBE-REPORT.md](docs/PROBE-REPORT.md)):

- 8,000- and 10,000-char write arguments FINALIZED with byte-consistent
  read-back; the real 6,559-char item write read back byte-identical.
- The first live panel round burned `MAJORITY_DISAGREE` — equivalence was
  comparing judgment shadings that model families split on. Narrowed to
  the decision cut, the rerun finalized `MAJORITY_AGREE` deriving exactly
  what the deterministic spec predicts. Both transactions are in the
  report; five direct tests pin both directions.

## The independent source, through the app

`submit_anchor_item` is the only lane where the contract fetches, and the
only path to `VERIFIED`. Driven from the product by
[`scripts/anchor-app-demo.mjs`](scripts/anchor-app-demo.mjs) — sign in,
name a source, let the queue carry it:

| step | result |
|---|---|
| a party-controlled source | refused: `seller-controlled.example.com is not an allowlisted independent source` |
| an allowlisted source | accepted, then **EXTRACTED** — every validator fetched it and agreed |

`ac-000006` · tx `0x3fa2050b6b76f88a466cf89ddecf4c02e907139dccf685442e88c863973558f9`
· file hash `5ba90856…9b32e` (what the app committed) · text hash
`5375d6df…39000` (what the contract normalized and stored)

The packet cannot be sealed while an anchor is still entering: until
every validator has agreed on the bytes they fetched, its real hashes are
unknown, and a manifest sealed now would cover a hash the app merely
guessed. The submit gate says exactly that rather than failing later.

## The identity check, live

Two assessments differing only in their VIN, on the deployment of record.
Nothing about either outcome came from a party — four validators each
decoded the VIN at the federal registry and had to agree
([`scripts/identity-demo.mjs`](scripts/identity-demo.mjs)):

| listing | seller declares | the registry reads | result |
|---|---|---|---|
| honest — `1HGCM82633A004352` | 2003 Honda Accord | 2003 HONDA Accord (Coupe) | **CONFIRMED** |
| false — `1M8GDM9AXKP042788` | 2019 Meridian GT Wagon | **1989 MOTOR COACH INDUSTRIES 102C3 Intercity (Bus)** | **MISMATCH** |

`0x629fce9a7e6813096accfffe563862b105a84f11a7dc91fe9cb7c6b3d848a30d` ·
`0xf8180b706a3db89404156bc27b972ef37d2b6a0264898f4ea588f35505ee6c0b`

The second row is the point. The seller supplied every other byte on that
record, and the contract still caught the identity — because the one
question that matters most was never asked of the seller.

Make comparison is deliberately forgiving ("Mercedes" matches
"MERCEDES-BENZ"), because a false mismatch accuses an honest seller. An
abbreviation the registry does not share — "VW" against "VOLKSWAGEN" —
reads as a mismatch; that is a stated limitation, and the reason a
mismatch caps a claim rather than alleging fraud.

## Live evidence

<!-- ARC:BEGIN -->
Run 13 Sep 2026 against the deployment of record
`0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998` (operator `0x8af429f1…6fd1`),
by [`scripts/arc.mjs`](scripts/arc.mjs) — every line below is either
backed by a hard assertion in that script (it exits non-zero without it)
or marked *observed* where the value is the live panel's judgment. Every
transaction FINALIZED under MAJORITY_AGREE. Explorer:
`https://explorer-studio-dev.genlayer.com/tx/<hash>`.

**Act I — the sale record** (`ac-000003`): a real VIN, declared honestly.
Before the record existed, every validator decoded it at the federal
registry — **CONFIRMED, 2003 HONDA Accord**. Then the seller's invoice and
the buyer's history record enter with their text hashes recomputed at
entry, the buyer's dispute is recorded, and the packet seals.

| step | tx |
|---|---|
| create (registry decoded by every validator) | `0x2684686e5d25ed7c8ddaeaac374e646c62015016e3c4a8b777ff2f934d00b897` |
| seller invoice enters | `0x1af08ff5bf279ef28191b4905bdb7c0ae04a902f3f2202df50b61b689f755c03` |
| buyer history enters | `0x90aa4517c0f3eb9ef9b44ef9cfc57dd9b546a945da969efeffe85285120a2b77` |
| buyer disputes CL-02 | `0x92117a2306f81e8824bb77e1633ed04b87ee035f6a4ab59d27693016dd92581b` |
| seal | `0x3c1ba9812543f09d4e533ba9ccc4c9ba856921126d90e1532b204697f1dd9d9d` |
| adjudicate (panel) | `0x81e01018e1f2850650f90b2cab21d427282a38ee35dbcb5118a2e2bfb4f9b0d8` |

Derived on-chain: rollup `PARTIALLY_VERIFIED`. CL-01 support classes
`[FIRST_PARTY]`, confidence LOW; CL-02 support `[ADVERSE]` — the disputing
buyer's own record backing the claim it disputes — confidence MEDIUM.
**Asserted**: the registry confirms the declared vehicle, and neither
claim reaches `VERIFIED` without an INDEPENDENT anchor.

**Act II — the rollback record** (`ac-000004`): a later-dated LOWER
odometer reading enters from a second account, with its dispute.

| step | tx |
|---|---|
| create | `0xd2868a6c78c627399172ba6ef3b5d572aa7c9af0c23d1ddb8e26b6750714f73b` |
| invoice enters | `0x8a7e45f4ba72b05dc4ad914f0ddc3124aa449d317e053dd38a36eaffead6abfe` |
| later-dated lower reading | `0x59dd27fcc44ab1d179105d7511560c736cce056d72e8844fa018439b62083ed3` |
| second account disputes | `0xcfde7cef0c90eb953ec167a32c93ccabaaf36c5a9a0bd6566b96883799e8ef9e` |
| seal | `0xd08d344c35a81a479d2ca92be3a3a7dd07f36d1149e29162d7d54889d980d4e9` |
| adjudicate (panel) | `0x0374c932e36edd2a748409b67c8472816ed18597470fc417826f8d4411464795` |

**Asserted**: the contract recomputes the mileage conflict from typed
observation rows. *Observed*: the panel found no explanation in the
record, so the rollup is `POSSIBLE_ODOMETER_ROLLBACK`.

**Act III — the appeal** (`ac-000003`): the buyer's post-verdict
counter-report enters tagged NEW; the appeal re-judges the stored bytes
plus it.

| step | tx |
|---|---|
| counter-report enters (NEW) | `0xcd4120671015228ff37889ea811635bd1b300f7143499f3c43ca1a274d64dc3d` |
| readjudicate (panel) | `0x3e61ccac402ee6c17e7419e7d934c8718a71c75c186cf01db3d571222a9a696c` |

Run 2 rollup `PHYSICAL_INSPECTION_REQUIRED`. **Asserted**: run 1 is
byte-identical after the appeal; the new item was judged at packet v2 and
tagged post-verdict; and the accuser-only contradiction is floored at
inspection rather than becoming `CLAIM_CONTRADICTED`.

**The wall** — five refusals, each FINALIZED with the contract's own
sentence decoded from the leader receipt. **None unproven.** The two
pre-seal gates run on a dedicated OPEN fixture (`ac-000005`), because on a
sealed record the seal gate fires first and would prove the wrong sentence.

| wall | the contract's sentence | tx |
|---|---|---|
| re-judge an unchanged packet | `[EXPECTED] run 2 already judged this exact packet; a re-judgment is an appeal (readjudicate)` | `0x53d558b149e38579b1db1185273cf26ad78c7828be2f8f225b6c2325dff04c62` |
| stranger appeal | `[EXPECTED] only a recorded party may appeal` | `0xd890fbd057451b0e7cef09b1847d19f5651b5f5fb8b212170e533c363d67092d` |
| evidence after seal | `[EXPECTED] evidence closes at seal; new evidence after a verdict enters through submit_appeal_evidence` | `0xbfd5c5e1e24339cb99222de6e164a6ed99ed2d5eef9a5f9a3f8ef6fac48b8a2a` |
| hash not covering the bytes | `[EXPECTED] text_sha256 does not match the supplied text` | `0x8445359f255a437d1e30372350ea9e02304b48e129ba1f82492169703a1cf98e` |
| anchor off the allowlist | `[EXPECTED] anchor host is not on the deployment allowlist` | `0x8924d76b99a3ad7a0fda04c00f5e5cf7f43675ca4bf0f6fbc613d5ec1cda80b1` |
<!-- ARC:END -->

## Running it

```
npm install
cp .env.example .env        # set SESSION_SECRET, GENLAYER_OPERATOR_PK
npx prisma generate --schema packages/db/prisma/schema.prisma
node scripts/dev-db.mjs     # real PostgreSQL 16, no Docker needed (keep running)
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
npx next dev apps/web       # the 13 screens
npm run worker              # the job mover (or a cron on /api/jobs/drain)
```

`npm run worker` compiles first (`tsc -b`) and then runs the built
output. Every workspace package resolves to `dist/`, so plain Node cannot
be pointed at the TypeScript source — and `tsc -b` decides what to
rebuild from `tsconfig.tsbuildinfo`, not from whether `dist/` is actually
there, so never skip the compile step.

`scripts/dev-db.mjs` serves a real PostgreSQL 16 on `localhost:5455`
from binaries the `embedded-postgres` dev dependency ships — nothing to
install and no Docker; the cluster lives in `var/pg` (gitignored), with
both `autocourt` and the browser tests' `autocourt_e2e`. It is created
UTF-8 on purpose: left to itself, initdb on Windows takes the ANSI code
page, and a panel's non-breaking hyphen could not be stored. A cluster
made before that is refused, by name, until
`node scripts/dev-db-reencode.mjs` rebuilds it as UTF-8 — every row
copied and counted, the original kept beside it. A
machine with Docker can use
`docker compose -f infrastructure/docker/docker-compose.yml up -d`
instead (then point `DATABASE_URL` at `:5432`); CI runs the same
`postgres:16` as a service container. The web app reads the repo-root
`.env` (next.config.mjs loads it; a deployment's own environment always
wins).

Sign-in is wallet-only: an EIP-191 signature over a server nonce; no
transaction, no fee. The wallet address is the account — on the site and
in the on-chain record. Wallets are discovered via EIP-6963 (with a
legacy `window.ethereum` fallback), so multiple installed wallet
extensions each get their own sign-in button instead of fighting over
one global.

## Tests

| suite | count | what it proves |
|---|---|---|
| `pytest tests/direct` | 128 | the whole contract against a runtime-strict stub: floors, walls, appeals, forged-leader replays (a fabricated-but-consistent dossier is refused because its quotes do not ground), every equivalence lesson pinned in both directions — decision cut, sufficiency materiality, citation materiality, explanation shadings — and the independent identity check and uploader attestation |
| `npx vitest run` | 86 | VIN/OBD-II/mileage code, evidence pipeline honesty, the packet builder (with a golden pinning TS `manifestRoot` byte-equal to the contract's), S40 act availability as a pure function, and the rule that the run limit is read from `get_config()` rather than remembered. With `DATABASE_URL` set (CI sets it), 20 of them run against real PostgreSQL in a throwaway schema: the job queue's ordering, failure and retry rules driven through the real drainer with a stub chain — a failure fails only what was queued behind it, never the retry that follows; a write that missed consensus is sent again as a new attempt while an unanswered one never is; a judgment is re-run only by the parties; a verdict is stored byte for byte in any script — and the claim and record lock that let exactly one of two simultaneous requests through. Every rule is mutation-checked |
| `npx playwright test` | 1 journey | the complete seller-to-buyer path in a real browser against a real server and Postgres: landing → two wallets signing in with real EIP-191 signatures → list → upload (fixture bytes) → **redact a card number and prove it is gone from the bytes that will be published** → typed rows → the consent gate refusing an unconsented packet, now signing the attestation → share → buyer disputes and counters → submit → the revoked link answers with its reason. Runs on an isolated database so its fixtures never ride the local drain onto the chain |
| `CHAIN_E2E=1 npx playwright test` | + 1 verdict | the post-verdict screens the journey cannot reach, rendered against a REAL adjudicated record (`ac-000003`, two runs and an appeal, produced by the arc): the identity row, the report's run-of-total, code-derived confidence and non-consensus prose label, Provenance, the intake receipt read from the contract's own manifest, and the appeal gate. Skipped without the flag, because it reads a live contract |
| `node scripts/seam-pass.mjs` | live | the app→chain seam: the same API the browser drives, then the drain loop carrying every queued write to the deployment of record — on-chain id linked, evidence landed, dispute recorded, sealed, and the intake receipt confirming every item inside the on-chain manifest |
| `node scripts/appeal-pass.mjs` | live | the APPEAL path through the product, which the browser tests structurally cannot reach: a full cycle of submit → adjudicate → post-verdict counter-evidence → appeal → readjudicate. Ten assertions, including that run 1 stays byte-identical (an appeal adds a run, it never edits one) and that the Appeal row is linked to the run it produced rather than orphaned |
| `node scripts/anchor-app-demo.mjs` | live | the independent-source lane from the app: a party-controlled source refused by the allowlist, an allowlisted one accepted and EXTRACTED once every validator agreed |
| `node scripts/prove-verified.mjs` | live | the two outcomes no live round had ever produced: `ac-000010` reaching **`VERIFIED` / HIGH** on `INDEPENDENT` corroboration (the flagship verdict, and the whole point of the anchor lane), and `ac-000012` raising `diagnostic_concern_supported` — a stored trouble code is never an auto-failure, so the flag needs the panel to find symptom support in the record |
| `node scripts/prove-identity-cap.mjs` | live | the registry identity check as a **controlled pair**: two records whose evidence is byte-identical apart from the VIN. `ac-000015` (undecodable) reached `VERIFIED` / HIGH; `ac-000016`, whose VIN decodes at the federal registry to a 1989 bus while the listing claims a 2019 wagon, reached `CONFLICTING_EVIDENCE` / LOW at `MATERIAL_CONCERN`. The seller supplied every byte of both; the one fact no party supplied moved the outcome |
| `node scripts/prove-runs-cap.mjs` | live | a record driven to the contract's 4-run limit (`ac-000022`: an adjudication and three appeals, standing run 4), then refused in both places it has to be: the app answers 409 before writing anything ("this record already holds the 4 runs the contract allows"), and the contract refuses a `readjudicate` called directly with an operator key, in its own words — `[EXPECTED] the record holds at most 4 runs` (tx `0x9e066eae…01cd`) |
| `node scripts/prove-double-clicks.mjs` | live | every act that moves a record, sent twice at the same instant through the live product — add a source, dispute a claim, submit, adjudicate, appeal. On `ac-000021` each was accepted once and refused once with a 409 in words, and the record's queue holds exactly one job of each of its eight kinds of write, all landed. That includes the buyer's dispute, which reached the chain once although an anchor had already created the record while it was a draft. A real RPC failure mid-run hit the seal before it had a transaction; it was retried and landed. `REJECTED`, the status this script began by producing, stays proven by `ac-000019`, where a double click before the fix drew the contract's own refusal: "run 1 already judged this exact packet" |
| `node scripts/prove-app-paths.mjs` | live | the app-side paths that were only ever unit-tested: an image with no OCR recorded `UNEXTRACTED` with its type read from the bytes, rate limiting on a real request, share-link expiry by wall clock answering 410, and the compare and report screens rendering |
| `genvm-lint` | clean | AST-level GenVM validity |

## The docs

[ARCHITECTURE.md](docs/ARCHITECTURE.md) — what is built ·
[STANDARDS-MAP.md](docs/STANDARDS-MAP.md) — why it must be built that way ·
[THREAT-MODEL.md](docs/THREAT-MODEL.md) — eliminated / detectable / honest limits ·
[PROBE-REPORT.md](docs/PROBE-REPORT.md) — the measurements ·
[design-review-findings.md](docs/design-review-findings.md) — the 38
pre-code findings this build answers

## Honest limits

Adjudicated evidence is public, permanently — consent is per-item and
redaction precedes submission, because afterwards it is impossible. The
operator can refuse service but cannot forge or alter a record. Wallets
are self-attested identity; the contract, not the login, makes a second
wallet worthless. Extraction of uploaded files is the operator's
testimony — detectable via dual hashes and `scripts/verify-extraction.mjs`,
not prevented. The demo anchor allowlist trusts commit-pinned GitHub raw
as a stand-in registry; a production deployment would list actual
registries.
