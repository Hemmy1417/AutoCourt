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
| Contract | [`0x214821A6F32fb35CCaa2CfaAC11087850fe95555`](https://explorer-studio-dev.genlayer.com/address/0x214821A6F32fb35CCaa2CfaAC11087850fe95555) |
| Network | GenLayer Studio Next, chain 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Source | [`contracts/autocourt_assessment.py`](contracts/autocourt_assessment.py) — byte-verified: `node scripts/deploy.mjs verify 0x214821A6…5555` reports byte-for-byte identity (sha256 `f0f8d30a…97a2d`) |
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
The live arc is running against the deployment of record; this section is
written from its output when it completes.
<!-- ARC:END -->

## Running it

```
npm install
npx prisma generate --schema packages/db/prisma/schema.prisma
docker compose -f infrastructure/docker/docker-compose.yml up -d
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
cp .env.example .env        # set SESSION_SECRET, GENLAYER_OPERATOR_PK
npx next dev apps/web       # the 13 screens
node apps/worker/src/index.ts   # the job mover (or a cron on /api/jobs/drain)
```

Sign-in is wallet-only: an EIP-191 signature over a server nonce; no
transaction, no fee. The wallet address is the account — on the site and
in the on-chain record.

## Tests

| suite | count | what it proves |
|---|---|---|
| `pytest tests/direct` | 105 | the whole contract against a runtime-strict stub: floors, walls, appeals, forged-leader replays (a fabricated-but-consistent dossier is refused because its quotes do not ground), decision-cut equivalence in both directions |
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
