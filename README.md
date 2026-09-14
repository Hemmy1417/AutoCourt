<p align="center">
  <img src="web/app/icon.svg" width="72" alt="AutoCourt" />
</p>

<h1 align="center">AutoCourt</h1>

<p align="center">
  Used-vehicle claims, adjudicated. A seller declares the claims, evidence
  goes on a public record — both sides — a validator panel judges it, and
  deterministic public code derives every verdict. Nobody authors the outcome.
</p>

---

## The deployment of record

AutoCourt reads and writes one deployment of record: `0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998`.

| | |
|---|---|
| Contract | [`0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998`](https://explorer-studio-dev.genlayer.com/address/0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998) |
| Network | GenLayer Studio Next, chain 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Source | [`contracts/autocourt_assessment.py`](contracts/autocourt_assessment.py) — byte-verified: `cd web && node scripts/deploy.mjs verify 0xE26B3C4A…7998` reports byte-for-byte identity (sha256 `aac854f1…01ac`) |
| Superseded | `0x214821A6…5555` (opening round split on an immaterial sufficiency bit), `0xE9d81837…C6a9` (appeal round split on one marginal citation), then `0x283E59d0…3c30` (superseded by the independent identity check below, not by a defect) — every split is documented with its receipts in [PROBE-REPORT](docs/PROBE-REPORT.md) |
| Anchor allowlist | `["raw.githubusercontent.com"]` — the proven independent evidence host on this network, standing in for vehicle registries; visible in `get_config()`, and `VERIFIED` is reachable only through it |

## The app

One web app in [`web/`](web) that talks to the contract directly, in the shape
of the author's Verda repository. There is no server, database, queue or key
behind it:

- **Reads** go from the visitor's browser straight to Studio Next, typed and
  paced under the RPC's measured limit of 30 contract reads a minute per IP.
  Every page renders from the contract's own views, so what you see is the
  record, not a copy of it.
- **Writes** are signed by the connected wallet. Each one sizes its fee
  deposit, surfaces a refusal in the contract's own words before anything is
  signed, confirms by reading the record back, and says "finalized" only when
  the transaction reports it.
- **Evidence never leaves your browser as a file.** It is read, fingerprinted
  and redacted there; what you publish is the text you reviewed, both
  fingerprints, your typed readings and your wallet's signature over them.
- **Test GEN** for fees comes from the wallet menu, which asks Studio Next's
  faucet for the connected address.

The screens: the records list, list a vehicle, the record (claims and
disputes, evidence, independent sources, the next step), the verdict report,
claim-by-claim evidence with quotes, the intake receipt, and the appeal.

AutoCourt was first built full stack, with an operator wallet sending every
transaction through a job queue. The contract never required an operator, so
the rebuild (14 Sep) serves the same deployment of record: every record and
proof below is unchanged and renders in the app.

## What the contract owns, and what it refuses to

Each party extracts, redacts and signs their own evidence and writes it from
their own wallet; that part is the party's testimony, made attributable by the
signature and tamper-evident by dual hashes in the sealed manifest. Everything
downstream is consensus:

- **The contract checks the listing's core claim itself.** Before a record
  exists, every validator decodes the VIN at the public federal registry
  (NHTSA vPIC) and must agree on what it read. This is the one fact on an
  AutoCourt record that no party supplies, and it runs on every assessment.
  A mismatch caps every claim below `VERIFIED` and takes the headline; an
  unreachable or undecodable registry is recorded as absence, never as an
  accusation.
- **Evidence is corroborated where it enters the record.** Uploaded text
  arrives as calldata with its hash recomputed at entry by every validator;
  independent sources are fetched by every validator itself. No
  leader-private byte exists anywhere. "Add an independent source" is the
  only path to `VERIFIED`.
- **Uploaders attest to their own bytes.** The uploading wallet signs both of
  an item's hashes, and the signature sits on the public record beside them.
  The app checks it on every view, and anyone can repeat the check from
  chain data alone. Unsigned items are shown AS unsigned.
- **The model returns findings; code derives every verdict.** The panel
  outputs per-claim, per-item findings with quotes that must ground
  word-token-wise in the recorded text. Deterministic code, run identically
  inside every validator, derives the corroboration class of every edge,
  every claim verdict, the flags, the rollup, confidence and next action.
- **Floors key on attributes, never names.** A claim backed only by its own
  side's uploads cannot reach `VERIFIED`; an accusation resting only on the
  accuser's uploads cannot become `CLAIM_CONTRADICTED`; the rollback flag
  needs two distinct wallets or an independent source.
- **Appeals re-read the recorded bytes.** Recorded items are referenced by id
  and read from contract storage: there is no parameter through which
  replacement bytes could travel. Prior runs are immutable.
- **Verdict-shopping is unrepresentable.** A second adjudication of an
  unchanged packet is refused; a re-judgment is only reachable as a recorded,
  attributed, capped appeal.

## The verdict model

| kind | values |
|---|---|
| claim verdicts (one per claim) | `VERIFIED` · `PARTIALLY_VERIFIED` · `CLAIM_CONTRADICTED` · `CONFLICTING_EVIDENCE` · `INSUFFICIENT_EVIDENCE` · `PHYSICAL_INSPECTION_REQUIRED` · `INCONCLUSIVE` |
| code-derived flags | `mileage_conflict` · `odometer_rollback_indicated` · `diagnostic_concern_supported` · `vehicle_identity_mismatch` |
| assessment rollup (fixed precedence) | identity mismatch ≻ `POSSIBLE_ODOMETER_ROLLBACK` ≻ `MILEAGE_CONFLICT` ≻ `MATERIAL_CONCERN` ≻ `DIAGNOSTIC_CONCERN_SUPPORTED` ≻ … |
| statuses, never verdicts | `SOURCE_UNAVAILABLE` (an independent source, or the registry, all validators agreed was gone or did not match) |
| identity, from the registry | `CONFIRMED` · `MISMATCH` · `UNDECODABLE` · `SOURCE_UNAVAILABLE` |

Corroboration ladder, derived in-contract per (claim, item, direction) edge:
`INDEPENDENT` (every-validator fetch) > `ADVERSE` (recorded opposing stake,
distinct wallet) > `FIRST_PARTY`. Items from one wallet are one voice.
`VERIFIED` requires `INDEPENDENT`.

## Lifecycle

```
seller opens ──► evidence enters ──► disputes recorded ──► SEAL
 (claims; VIN    (per-item writes,     (opposing stakes,     (manifest root
  decoded by      signed by uploader;   from any wallet)      recomputed over
  every           sources fetched by                          stored items)
  validator)      every validator)                                 │
                                                                   ▼
        appeal ◄── ADJUDICATED ◄───────────────────────────── panel round
   (new items tagged;   │                            (findings + grounded
    recorded bytes      ├──► report · claim-by-claim ·  quotes; verdicts
    re-read from        │    intake receipt             derived in code)
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
  comparing judgment shadings that model families split on. Narrowed to the
  decision cut, the rerun finalized `MAJORITY_AGREE` deriving exactly what
  the deterministic spec predicts. Both transactions are in the report; five
  direct tests pin both directions.

## The independent source, and what hashing it taught

`submit_anchor_item` is the only lane where the contract fetches: every
validator reads the page itself, and the item enters only if the bytes it
hashed match the fingerprint the adder committed.

**The finding.** GenVM's `render(url, mode="text")` does not return a text
file's raw bytes. Its webdriver takes the page's `innerText` and normalizes
whitespace line by line (read from the GenVM source, function
`normalizeWhitespace`). The first registry extract committed to this
repository has its readings in columns separated by two spaces, so a
fingerprint taken over the raw file could never match:

| record | fingerprint committed | what every validator hashed | entered as |
|---|---|---|---|
| `ac-000023` | raw bytes `83a9bc85…fb0e3` | `4308ed17…682eb6` — every validator reached the page and agreed (tx `0x22790a41…df28f6`) | `SOURCE_UNAVAILABLE`, never judged |
| `ac-000024` | rendered text `4308ed17…682eb6` | `4308ed17…682eb6` | **`EXTRACTED`** |

The same commit-pinned file both times
([`fixtures/registry/1HGCM82633A004352.txt`](fixtures/registry/1HGCM82633A004352.txt)
at `76a39ee`, a fictional extract the fixture's README explains). The app now
fingerprints what the validators will render
([`web/lib/evidence/anchor.ts`](web/lib/evidence/anchor.ts)), and a unit test
pins that function to the digest the validators computed on chain.

## A clean record, live

The case a buyer hopes to find, on the deployment of record, driven through
the same modules the browser runs with a fresh wallet funded from the faucet
([`web/tests/live/clean-record.test.ts`](web/tests/live/clean-record.test.ts),
`AUTOCOURT_LIVE=1 npx vitest run tests/live`). Every line is an assertion the
test fails without. `ac-000024`, run 14 Sep 2026, all five transactions
FINALIZED under `MAJORITY_AGREE`:

| step | asserted | tx |
|---|---|---|
| open the record | the registry confirms the listed 2003 Honda Accord: `CONFIRMED` | `0xf273156bf2e0eb2e9c87db48ac1f816d5eaaf989ff367f0925ae4fc0a50a85ff` |
| the seller's signed invoice | read back from the chain, the signature verifies against the on-chain hashes | `0x64b8861499605c1d93bde273f831ae4351afa197776e1271b7064c6a72b1c069` |
| this repository's registry extract | `EXTRACTED`; the stored fingerprint is the rendered text's, and the stored text hash recomputes | `0x259f79e6a40c5598f8193a31e5b17198369f8bd4e8d364a7b644f28c66937386` |
| seal | the root computed in the app is the root the contract recomputed | `0x4903f92386d56e54e16729289f305121cf8e6e2e0107f640441615d23137d74e` |
| adjudicate | mileage claim **`VERIFIED` / HIGH**, supported by `INDEPENDENT` (and `FIRST_PARTY`), nothing against it; headline **`VERIFIED`**; no flag raised | `0xa8f7f90b57b64fffa85298c19f22ad0dbba841626ef9c7b8984b157b7a9c54f9` |

## The identity check, live

Two assessments differing only in their VIN, on the deployment of record.
Nothing about either outcome came from a party — four validators each decoded
the VIN at the federal registry and had to agree
([`web/scripts/identity-demo.mjs`](web/scripts/identity-demo.mjs)):

| listing | seller declares | the registry reads | result |
|---|---|---|---|
| honest — `1HGCM82633A004352` | 2003 Honda Accord | 2003 HONDA Accord (Coupe) | **CONFIRMED** |
| false — `1M8GDM9AXKP042788` | 2019 Meridian GT Wagon | **1989 MOTOR COACH INDUSTRIES 102C3 Intercity (Bus)** | **MISMATCH** |

`0x629fce9a7e6813096accfffe563862b105a84f11a7dc91fe9cb7c6b3d848a30d` ·
`0xf8180b706a3db89404156bc27b972ef37d2b6a0264898f4ea588f35505ee6c0b`

The second row is the point. The seller supplied every other byte on that
record, and the contract still caught the identity — because the one question
that matters most was never asked of the seller.

Make comparison is deliberately forgiving ("Mercedes" matches
"MERCEDES-BENZ"), because a false mismatch accuses an honest seller. An
abbreviation the registry does not share — "VW" against "VOLKSWAGEN" — reads
as a mismatch; that is a stated limitation, and the reason a mismatch caps a
claim rather than alleging fraud.

## Live evidence

<!-- ARC:BEGIN -->
Run 13 Sep 2026 against the deployment of record
`0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998` (operator `0x8af429f1…6fd1`),
by [`web/scripts/arc.mjs`](web/scripts/arc.mjs) — every line below is either
backed by a hard assertion in that script (it exits non-zero without it) or
marked *observed* where the value is the live panel's judgment. Every
transaction FINALIZED under MAJORITY_AGREE. Explorer:
`https://explorer-studio-dev.genlayer.com/tx/<hash>`.

**Act I — the sale record** (`ac-000003`): a real VIN, declared honestly.
Before the record existed, every validator decoded it at the federal registry
— **CONFIRMED, 2003 HONDA Accord**. Then the seller's invoice and the buyer's
history record enter with their text hashes recomputed at entry, the buyer's
dispute is recorded, and the packet seals.

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
**Asserted**: the registry confirms the declared vehicle, and neither claim
reaches `VERIFIED` without an independent source.

**Act II — the rollback record** (`ac-000004`): a later-dated LOWER odometer
reading enters from a second account, with its dispute.

| step | tx |
|---|---|
| create | `0xd2868a6c78c627399172ba6ef3b5d572aa7c9af0c23d1ddb8e26b6750714f73b` |
| invoice enters | `0x8a7e45f4ba72b05dc4ad914f0ddc3124aa449d317e053dd38a36eaffead6abfe` |
| later-dated lower reading | `0x59dd27fcc44ab1d179105d7511560c736cce056d72e8844fa018439b62083ed3` |
| second account disputes | `0xcfde7cef0c90eb953ec167a32c93ccabaaf36c5a9a0bd6566b96883799e8ef9e` |
| seal | `0xd08d344c35a81a479d2ca92be3a3a7dd07f36d1149e29162d7d54889d980d4e9` |
| adjudicate (panel) | `0x0374c932e36edd2a748409b67c8472816ed18597470fc417826f8d4411464795` |

**Asserted**: the contract recomputes the mileage conflict from typed
observation rows. *Observed*: the panel found no explanation in the record, so
the rollup is `POSSIBLE_ODOMETER_ROLLBACK`.

**Act III — the appeal** (`ac-000003`): the buyer's post-verdict
counter-report enters tagged NEW; the appeal re-judges the stored bytes plus
it.

| step | tx |
|---|---|
| counter-report enters (NEW) | `0xcd4120671015228ff37889ea811635bd1b300f7143499f3c43ca1a274d64dc3d` |
| readjudicate (panel) | `0x3e61ccac402ee6c17e7419e7d934c8718a71c75c186cf01db3d571222a9a696c` |

Run 2 rollup `PHYSICAL_INSPECTION_REQUIRED`. **Asserted**: run 1 is
byte-identical after the appeal; the new item was judged at packet v2 and
tagged post-verdict; and the accuser-only contradiction is floored at
inspection rather than becoming `CLAIM_CONTRADICTED`.

**The wall** — five refusals, each FINALIZED with the contract's own sentence
decoded from the leader receipt. **None unproven.** The two pre-seal gates run
on a dedicated OPEN fixture (`ac-000005`), because on a sealed record the seal
gate fires first and would prove the wrong sentence.

| wall | the contract's sentence | tx |
|---|---|---|
| re-judge an unchanged packet | `[EXPECTED] run 2 already judged this exact packet; a re-judgment is an appeal (readjudicate)` | `0x53d558b149e38579b1db1185273cf26ad78c7828be2f8f225b6c2325dff04c62` |
| stranger appeal | `[EXPECTED] only a recorded party may appeal` | `0xd890fbd057451b0e7cef09b1847d19f5651b5f5fb8b212170e533c363d67092d` |
| evidence after seal | `[EXPECTED] evidence closes at seal; new evidence after a verdict enters through submit_appeal_evidence` | `0xbfd5c5e1e24339cb99222de6e164a6ed99ed2d5eef9a5f9a3f8ef6fac48b8a2a` |
| hash not covering the bytes | `[EXPECTED] text_sha256 does not match the supplied text` | `0x8445359f255a437d1e30372350ea9e02304b48e129ba1f82492169703a1cf98e` |
| anchor off the allowlist | `[EXPECTED] anchor host is not on the deployment allowlist` | `0x8924d76b99a3ad7a0fda04c00f5e5cf7f43675ca4bf0f6fbc613d5ec1cda80b1` |
<!-- ARC:END -->

## Earlier live proofs

Produced on 13–14 Sep by the full-stack build this repository replaced. Their
scripts drove that build's HTTP API, so they live at commit
[`76a39ee`](https://github.com/Hemmy1417/AutoCourt/tree/76a39eea547c8286dcdaf360899303f9c75b481b/scripts);
the records they made are permanent on the deployment of record and open in
the app today.

| record | what it proved |
|---|---|
| `ac-000006` | the independent-source lane from the app: an allowlisted source entered `EXTRACTED` once every validator agreed (tx `0x3fa2050b…73558f9`); the contract's own refusal of an off-allowlist source is the arc's wall above |
| `ac-000009` | a full appeal cycle; run 1 byte-identical after run 2 |
| `ac-000010` | **`VERIFIED` / HIGH** on `INDEPENDENT` corroboration: a disclosed accident, corroborated by a police report no party authored |
| `ac-000012` | `diagnostic_concern_supported`: a trouble code with symptom support in the record (a stored code alone is never an auto-failure) |
| `ac-000015` / `ac-000016` | the identity check as a controlled pair: byte-identical evidence apart from the VIN; the undecodable VIN reached `VERIFIED` / HIGH, the VIN that decodes to a 1989 bus reached `CONFLICTING_EVIDENCE` / LOW at `MATERIAL_CONCERN` |
| `ac-000019` | a re-judgment of an unchanged packet refused in the contract's words: "run 1 already judged this exact packet" |
| `ac-000022` | a record at the contract's 4-run limit, and the contract refusing a fifth: `[EXPECTED] the record holds at most 4 runs` (tx `0x9e066eae…01cd`) |

## Running it

```bash
cd web
npm ci
npm run dev
```

Open `http://localhost:3000` with a browser wallet (MetaMask or any EVM
wallet). The app adds GenLayer Studio Next to the wallet when you connect, and
the wallet menu gets you test GEN. No environment variables are needed: the
deployment of record is the default, and
[`web/.env.example`](web/.env.example) shows the `NEXT_PUBLIC_*` values that
override it.

## Deploying it

Vercel, with the project's **Root Directory set to `web`**. No environment
variables and no secrets are required; the build is `next build`, and CI runs
the same `npm ci` and build on every push.

## Tests

| suite | count | what it proves |
|---|---|---|
| `pytest tests/direct` | 128 | the whole contract against a runtime-strict stub: floors, walls, appeals, forged-leader replays (a fabricated-but-consistent dossier is refused because its quotes do not ground), every equivalence lesson pinned in both directions — decision cut, sufficiency materiality, citation materiality, explanation shadings — and the independent identity check and uploader attestation |
| `cd web && npm run test` | 83 | the browser's half: the independent-source fingerprint pinned to the digest validators computed on chain, each rule of GenVM's whitespace normalization, and code-point capping; the manifest root against a golden from the contract's own function; act availability across states × roles (S40), with every limit read from `get_config()`; the write lifecycle against a fake client — a refusal stopped in the simulation with the contract's sentence and nothing sent, a finalized refusal and an undetermined round reported as such, no finality claimed that was not seen, no zero deposit; read pacing under the RPC's limit; VIN, OBD-II and mileage code; extraction honesty; the chain helpers |
| `AUTOCOURT_LIVE=1 npx vitest run tests/live` | live | a clean record on the deployment of record (above), skipped without the flag |
| `npm run verify` | gate | one contract address in the app's default, `web/.env.example` and this README |
| `genvm-lint` | clean | AST-level GenVM validity |

## The docs

[ARCHITECTURE.md](docs/ARCHITECTURE.md) — what is built ·
[STANDARDS-MAP.md](docs/STANDARDS-MAP.md) — why it must be built that way ·
[THREAT-MODEL.md](docs/THREAT-MODEL.md) — eliminated / detectable / honest limits ·
[PROBE-REPORT.md](docs/PROBE-REPORT.md) — the measurements ·
[design-review-findings.md](docs/design-review-findings.md) — the 38 pre-code
findings this build answers

## Honest limits

- **Evidence is public, permanently.** Redaction happens before publishing,
  because afterwards it is impossible; the publish step says so and requires
  an acknowledgement.
- **The contract's record writes are open to any wallet.** It checks no
  sender on sealing, evidence entry or adjudication, so a stranger can seal an
  open record early or spend its evidence slots. That cannot change how a
  verdict is derived or forge a signature, but it can disrupt a record; the
  earlier build hid it behind an operator wallet, and a future contract would
  bind those writes to the seller's address.
- **Wallets are self-attested identity**; the contract's floors, not a login,
  make a second wallet worthless.
- **Extraction reads plain text and PDFs with embedded text.** Scans and
  images enter as fingerprints with no text, and the panel is told so.
- **The anchor allowlist trusts commit-pinned GitHub raw** as a stand-in
  registry, and its registry extract is fictional; a production deployment
  would list actual registries.
