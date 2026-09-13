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
| Contract | [`0x283E59d0DaA5080Ac0DC8371B7D44f04f8163c30`](https://explorer-studio-dev.genlayer.com/address/0x283E59d0DaA5080Ac0DC8371B7D44f04f8163c30) |
| Network | GenLayer Studio Next, chain 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Source | [`contracts/autocourt_assessment.py`](contracts/autocourt_assessment.py) — byte-verified: `node scripts/deploy.mjs verify 0x283E59d0…3c30` reports byte-for-byte identity (sha256 `3aef79ec…f0d8`) |
| Superseded | `0x214821A6…5555` (opening round split on an immaterial sufficiency bit), then `0xE9d81837…C6a9` (its appeal round split on one marginal citation while every derived field agreed) — each split is documented with its receipts in [PROBE-REPORT](docs/PROBE-REPORT.md), each fix changed the contract, and a changed contract is a new address |
| Anchor allowlist | `["raw.githubusercontent.com"]` — the proven independent evidence host on this network, standing in for vehicle registries; visible in `get_config()`, and `VERIFIED` is reachable only through it |

## What the contract owns, and what it refuses to

The operator's app authenticates wallets, stores files, extracts text and
assembles packets — that part is testimony, made tamper-evident by dual
hashes in an on-chain manifest. Everything downstream is consensus:

- **Evidence is corroborated where it enters the record.** Uploaded text
  arrives as calldata with its hash recomputed at entry by every
  validator; anchor pages are fetched by every validator itself. No
  leader-private byte exists anywhere.
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
| code-derived flags | `mileage_conflict` · `odometer_rollback_indicated` · `diagnostic_concern_supported` |
| assessment rollup (fixed precedence) | `POSSIBLE_ODOMETER_ROLLBACK` ≻ `MILEAGE_CONFLICT` ≻ `MATERIAL_CONCERN` ≻ `DIAGNOSTIC_CONCERN_SUPPORTED` ≻ … |
| statuses, never verdicts | `REJECTED` (an attempt consensus refused — app-side with its tx hash) · `SOURCE_UNAVAILABLE` (an anchor all validators agreed was gone) |

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

## Live evidence

<!-- ARC:BEGIN -->
Run 13 Sep 2026 against the deployment of record
`0x283E59d0DaA5080Ac0DC8371B7D44f04f8163c30` (operator
`0x8af429f1…6fd1`), by [`scripts/arc.mjs`](scripts/arc.mjs) — every line
below is either backed by a hard assertion in that script (it exits
non-zero without it) or marked *observed* where the value is the live
panel's judgment. Every transaction FINALIZED under MAJORITY_AGREE;
explorer links: `https://explorer-studio-dev.genlayer.com/tx/<hash>`.

**Act I — the sale record** (`ac-000001`): seller declares mileage and
accident-history claims; the seller's invoice and the buyer's history
record enter with their text hashes recomputed at entry; the buyer's
dispute is recorded before the run; the packet seals over stored items.

| step | tx |
|---|---|
| create | `0xfe7b8f677ab61be0f1143900eb84bb480c0bbe8f2bd6b32ef0d2d6d3fed6da68` |
| seller invoice enters | `0x71398154b15a63b61960d916dc82351699766894316ff521a027d05d1b44d350` |
| buyer history enters | `0x621100fd548642bf33fcac6eac93f3346cafa326ae13cf9a538479d754ba8302` |
| buyer disputes CL-02 | `0x7031811bcf1f054c06868f388db85dd944319b3f625437c0af6b8944fd207c2b` |
| seal | `0x7a47de2f5a750bae97212a8c51169676c0303fa08633a50a5aee9958872594ef` |
| adjudicate (panel) | `0x6bee7b8ab1645b923d03f57e440fc28ae92c2f9ec0a7def6ceb63990274184f4` |

Derived on-chain: rollup `PARTIALLY_VERIFIED`. CL-01 support classes
`[FIRST_PARTY]`, confidence LOW; CL-02 support `[ADVERSE]` (the
disputing buyer's own record backing the claim it disputes), confidence
MEDIUM. **Asserted**: neither claim reaches `VERIFIED` without an
INDEPENDENT anchor, and no mileage conflict is invented from ascending
readings.

**Act II — the rollback record** (`ac-000002`): a later-dated LOWER
odometer reading enters from a second account, with its dispute.

| step | tx |
|---|---|
| create | `0x1a9d88e692beb04b2ef34cec639a3226aac586a7b9046c910eb9e3d4a4220084` |
| invoice enters | `0xe356f30afb5d40351468905c4406772514c33b8516a53999805088added2e484` |
| later-dated lower reading | `0x3584f25a0be03f7783437204e6315cef02a6a9fd7dd51c3bef5e34379a5f7cd8` |
| second account disputes | `0x811736bb9e249b271b100db1e03c3dadd7a50c5b4cd69a8396fed6819ffee7a7` |
| seal | `0xbdc4920c1443ddc09cc1c88bb0dbea230f6a7556e0a022204b79d64e7c71d984` |
| adjudicate (panel) | `0x77a4138c5ce225426431fcfa6b0774c2d44de30f0055a6a05b7a44d2dcebd92f` |

**Asserted**: the contract recomputes the mileage conflict from typed
observation rows (`mileage_conflict: true`). *Observed*: the panel found
no explanation in the record, so `odometer_rollback_indicated: true` and
the rollup is `POSSIBLE_ODOMETER_ROLLBACK`.

**Act III — the appeal on the record** (`ac-000001`): the buyer's
post-verdict counter-report enters tagged NEW; the appeal re-judges the
stored bytes plus it.

| step | tx |
|---|---|
| counter-report enters (NEW) | `0xa3cb3dd3238d5fe5e0342d7831b0eb0572c07b1468055337df402a238f1b8cc8` |
| readjudicate (panel) | `0xf2c955a92d0d758198bd279a366d50d15367ec23c6cbc3eafd313480cd0bb540` |

Run 2 rollup `PHYSICAL_INSPECTION_REQUIRED`. **Asserted**: run 1 is
byte-identical after the appeal (the record is immutable); the new item
was judged at packet v2 and tagged post-verdict; and the accuser-only
contradiction is floored at inspection — it never becomes
`CLAIM_CONTRADICTED` on the accuser's own upload.

**The wall** — every refusal FINALIZED with the contract's own sentence
decoded from the leader receipt. The two pre-seal gates are proven on a
dedicated OPEN fixture (`ac-000003`, create
`0xe5392139d8bafec9219621fab030cff573529c12149f22621a9807d5a53bd3c8`),
because on a sealed record the seal gate fires first and would prove the
wrong sentence.

| wall | the contract's sentence | tx |
|---|---|---|
| re-judge an unchanged packet | `[EXPECTED] run 2 already judged this exact packet; a re-judgment is an appeal (readjudicate)` | `0x1ee0f1c755f95ec09614c1cef46c83fbde1b5f38176d3b5f9a28bd1f9b4ac652` |
| stranger appeal | `[EXPECTED] only a recorded party may appeal` | `0xbdce02da8b02da80c42aae1e9e41b6ba5c46508541b051a80ba8c8ff45e1d37e` |
| evidence after seal | `[EXPECTED] evidence closes at seal; new evidence after a verdict enters through submit_appeal_evidence` | `0xc7dec3494339a0ce3a2a2b97572e6b451ff28b010a66f77aa37764f9d966cbfc` |
| hash not covering the bytes | `[EXPECTED] text_sha256 does not match the supplied text` | `0x62def665583445fb02c8a78bd474de03ee7e05862b614afb7a5ddc008a5468c6` |
| anchor off the allowlist | `[EXPECTED] anchor host is not on the deployment allowlist` | `0xe223e5222000b00c58cc5515750bada20ba5ff256093f250d8f1b5a3945f1eec` |
<!-- ARC:END -->

## Running it

```
npm install
cp .env.example .env        # set SESSION_SECRET, GENLAYER_OPERATOR_PK
npx prisma generate --schema packages/db/prisma/schema.prisma
node scripts/dev-db.mjs     # real PostgreSQL 16, no Docker needed (keep running)
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
npx next dev apps/web       # the 13 screens
node apps/worker/src/index.ts   # the job mover (or a cron on /api/jobs/drain)
```

`scripts/dev-db.mjs` serves a real PostgreSQL 16 on `localhost:5455`
from binaries the `embedded-postgres` dev dependency ships — nothing to
install and no Docker; the cluster lives in `var/pg` (gitignored). A
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
| `pytest tests/direct` | 110 | the whole contract against a runtime-strict stub: floors, walls, appeals, forged-leader replays (a fabricated-but-consistent dossier is refused because its quotes do not ground), and every equivalence lesson pinned in both directions — decision cut, sufficiency materiality, citation materiality, explanation shadings |
| `npx vitest run` | 48 | VIN/OBD-II/mileage code, evidence pipeline honesty, the packet builder (with a golden pinning TS `manifestRoot` byte-equal to the contract's), S40 act availability as a pure function |
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
