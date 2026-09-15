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

AutoCourt reads and writes one deployment of record: `0x081Fe3bEb829226E0C8E95f5f81146132E9C35A7`.

| | |
|---|---|
| Live app | [auto-court-web.vercel.app](https://auto-court-web.vercel.app) |
| Contract | [`0x081Fe3bEb829226E0C8E95f5f81146132E9C35A7`](https://explorer-studio-dev.genlayer.com/address/0x081Fe3bEb829226E0C8E95f5f81146132E9C35A7) |
| Network | GenLayer Studio Next, chain 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Source | [`contracts/autocourt_assessment.py`](contracts/autocourt_assessment.py), ruleset `autocourt-rules-4` — byte-verified: `cd web && node scripts/deploy.mjs verify 0x081Fe3bE…35A7` reports byte-for-byte identity (sha256 `7cf6b22c…db28`); deploy tx `0xa7878647ddd54832d74829b730aee43320cd98a7d6fa244e3e6d25cbd435cbc8` |
| Anchor allowlist | `["api.nhtsa.gov", "raw.githubusercontent.com"]` — NHTSA's public recall records, and commit-pinned GitHub raw standing in for registries no public API serves; visible in `get_config()`, and `VERIFIED` is reachable only through a source |
| Superseded | `0xb13808bC…0854` (signed writes, replaced before its first record by the floor the recall proof found), `0xE26B3C4A…7998` (writes open to any wallet), and before it `0x283E59d0…3c30`, `0xE9d81837…C6a9`, `0x214821A6…5555`. Records do not carry across deployments: the app and this README show only the deployment of record's. Why each deployment was replaced is measured in [PROBE-REPORT](docs/PROBE-REPORT.md) |

## The app

One web app in [`web/`](web), live at
[auto-court-web.vercel.app](https://auto-court-web.vercel.app), that talks to
the contract directly, in the shape of the author's Verda repository. There is
no server, database, queue or key behind it:

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
- **Independent sources are one click for the common case.** The record page
  fills in NHTSA's recall list for the listed make, model and year, and
  fingerprints it the way the validators will render it.
- **Test GEN** for fees comes from the wallet menu, which asks Studio Next's
  faucet for the connected address.

The screens: the records list, list a vehicle, the record (claims and
disputes, evidence, independent sources, the next step), the verdict report,
claim-by-claim evidence with quotes, the intake receipt, and the appeal. Every
act a wallet cannot take on a record is shown with the contract's reason in
words, and each upload card says how many intake slots that wallet's side has
left.

AutoCourt was first built full stack, with an operator wallet sending every
transaction through a job queue. The rebuild as a dApp (14 Sep) removed the
operator, which exposed that the contract accepted writes from any wallet;
the contract was redeployed the same day with every write bound to its signer.

## What the contract owns, and what it refuses to

Each party extracts, redacts and signs their own evidence and writes it from
their own wallet; that part is the party's testimony, made attributable by the
signature and tamper-evident by dual hashes in the sealed manifest. Everything
downstream is consensus:

- **Every write is the signer's.** The seller of record, each uploader, each
  disputer, each appellant and the wallet that asks for each independent
  source is the wallet that signed the transaction; a claimed account that
  differs is refused in words. Only the seller seals. Only a recorded party
  (the seller, a disputer, an uploader or a source's requester) can ask for
  the panel, add appeal evidence or appeal. Intake slots are split by side:
  the seller owns 5 of the 8 before sealing and every other wallet shares 3,
  and each appeal's 4 split 2 and 2.
- **The contract checks the listing's core claim itself.** Before a record
  exists, every validator decodes the VIN at the public federal registry
  (NHTSA vPIC) and must agree on what it read. This is the one fact on an
  AutoCourt record that no party supplies, and it runs on every assessment.
  A mismatch caps every claim below `VERIFIED` and takes the headline; an
  unreachable or undecodable registry is recorded as absence, never as an
  accusation.
- **Evidence is corroborated where it enters the record.** Uploaded text
  arrives as calldata with its hash recomputed at entry by every validator;
  independent sources are fetched by every validator itself, from a host the
  contract parses strictly before it checks the allowlist. No leader-private
  byte exists anywhere. "Add an independent source" is the only path to
  `VERIFIED`.
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
  accuser's uploads cannot become `CLAIM_CONTRADICTED`; neither side's own
  uploads can turn an independent source into a conflict; the rollback flag
  needs two distinct wallets or an independent source.
- **Appeals re-read the recorded bytes.** Recorded items are referenced by id
  and read from contract storage: there is no parameter through which
  replacement bytes could travel, and a source is never refetched. Prior runs
  are immutable.
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
 (claims; VIN    (per-item writes in   (in the disputer's    (seller only;
  decoded by      the signer's name,    own name)             manifest root
  every           slots split by side;                        recomputed over
  validator)      sources fetched by                          stored items)
                  every validator)                                 │
                                                                   ▼
        appeal ◄── ADJUDICATED ◄───────────────────────────── panel round
   (a recorded party;   │                            (asked for by a recorded
    new items tagged;   ├──► report · claim-by-claim ·  party; findings +
    recorded bytes      │    intake receipt             grounded quotes;
    re-read; ≤4 runs)   ▼                               verdicts in code)
                  the standing verdict names its run AND the total
```

## Live on the deployment of record

Three proofs, run 14 Sep 2026 through the same modules the browser runs, with
fresh wallets funded from the faucet:
`cd web && AUTOCOURT_LIVE=1 npx vitest run tests/live/<file>`. Every row
below is an assertion its test fails without, unless it is marked
*observed*. Every transaction listed FINALIZED under `MAJORITY_AGREE`.
Explorer: `https://explorer-studio-dev.genlayer.com/tx/<hash>`.

### A claim against NHTSA's recall list

`ac-000002`, [`web/tests/live/recall-record.test.ts`](web/tests/live/recall-record.test.ts).
The seller lists a 2003 Honda Accord and declares *"No safety recall has ever
been issued for the 2003 Honda Accord"*. A buyer's wallet disputes it and asks
every validator to fetch NHTSA's recall list for that make, model and year —
a record neither party wrote.

| step | who signs | asserted | tx |
|---|---|---|---|
| open the record | seller | the registry confirms the listed vehicle; the seller of record is the signing wallet | `0xcbbc963c71949db1a29908b724ac793ce54307e598f00720cfe8523b150bbfea` |
| dispute the claim | buyer | recorded in the buyer's name | `0x09e524bcd0cb14d66abd454471d47e06e3afae1cdbf10f50532a22f556889c38` |
| NHTSA's recall list | buyer | `api.nhtsa.gov/recalls/recallsByVehicle?make=Honda&model=Accord&modelYear=2003` enters `EXTRACTED` under the fingerprint the app took over the rendered page (`5b463894…efc7690`); the stored text hash recomputes; `added_by` is the buyer | `0xff0b4530a61972675ae1b86696e5c3e9e065b3fef574d631f7909f381a382171` |
| seal | seller | the root the app computed is the sealed manifest's | `0x1b4b6c71fbb092a81faea5ead3728b55319cdc1e0ceec8f90144dd6100925b9e` |
| adjudicate | buyer, a recorded party | **`CLAIM_CONTRADICTED` / HIGH** on `INDEPENDENT` evidence; next action raise it with the seller; headline `MATERIAL_CONCERN` | `0xb912b15d78f265cd4a1341e91396472df1dfd6ade6f07017a82c2b682fbc50a1` |
| the seller's signed declaration | seller | enters as appeal evidence, judged at packet version 2 | `0x35fe0af475e6d3baa7bf5473ea1b24b8813b2cdd7a612e6ca50cc74cd4d2eec9` |
| appeal | seller | run 2 is an appeal in the seller's name; the NHTSA entry in the manifest is unchanged, so the appeal judged the recorded bytes; the claim **stays `CLAIM_CONTRADICTED`** on `INDEPENDENT` evidence | `0x2bf0489fe7a6d2d4c74b7019ee7a1da98c24481d3e23c3acf5e062539d5adccc` |

*Observed*: the appeal panel read the seller's declaration as support
(`FIRST_PARTY`). Under the superseded ruleset those findings derived
`CONFLICTING_EVIDENCE`: a seller could answer a public recall list with their
own paperwork. That asymmetry was found while designing this proof and fixed
before the deployment of record held a record
([PROBE-REPORT](docs/PROBE-REPORT.md#signed-writes-and-the-floor-the-recall-proof-found-14-sep)).
One of four voting validators disagreed on the appeal, reading the same
declaration as undercutting the claim; its verdict, confidence and headline
matched, and the round finalized.

### The wallet walls

`ac-000005`, [`web/tests/live/signer-walls.test.ts`](web/tests/live/signer-walls.test.ts).
A stranger's wallet sends each forbidden write straight to the chain, priced
with the plain fee estimate and never simulated, so nothing but the contract
stands in its way. Each one FINALIZED with the leader's execution in `ERROR`
and the contract's own sentence, decoded from the leader receipt:

| the stranger tries to | the contract's sentence | tx |
|---|---|---|
| open a record naming the seller's wallet as seller | `[EXPECTED] seller_account must be the wallet that signs this transaction` | `0xe2f8660c585e84407399a90873a86e67cfcfba34c4456c14c9a6a6713cd27697` |
| dispute a claim in another wallet's name | `[EXPECTED] the disputing account must be the wallet that signs this transaction` | `0xd5ce86ba2cfd1277fc2b3013162d37aae8ef3ed25c715ceab46790a5f0ed30ed` |
| upload a document attributed to the seller | `[EXPECTED] uploader_account must be the wallet that signs this transaction` | `0xf6f8ff5de4148917d353c00acf472091e022ab911c3bb608f04de9995a2bed8b` |
| add a source at `https://raw.githubusercontent.com:x@evil.example/…` | `[EXPECTED] anchor url must name a plain host` | `0xc86e2205232f31a124cf0749c5ef5d47a2dd4835e0a8ced2413f017e49d58314` |
| seal the seller's packet | `[EXPECTED] only the seller of record can seal the packet` | `0xa233245e4ac6c2cd56eec40ec0b4c92f76b3acd80874eedff7dc68bd766a7098` |
| ask for the panel with no part in the record | `[EXPECTED] only a recorded party may request adjudication` | `0xe607f2fefe86cceb14c9039f6dfa6fb934d88d9b43e1573a3964c95155fb5e0f` |

Also asserted: no refused write changed the record (no new assessment, no
item, still `OPEN`, still no run), and the app's own path stopped the same
seal in its fee simulation with the contract's sentence and sent nothing.

The positive controls, and the record's identity:

| step | who signs | asserted | tx |
|---|---|---|---|
| open the record | seller | the VIN is a real motor coach's, listed as a 2019 Meridian GT Wagon: every validator's registry read is `MISMATCH` (1989 MOTOR COACH INDUSTRIES) | `0x303394eb0a359fd02de26c38e375a281f6886dc73c0110f3342e62f3121eae90` |
| the seller's invoice | seller | enters in the seller's name | `0xf7f51b16caa9745e7b16fde67e0024275e0d04bbbfd94449c63a01217578e184` |
| seal | seller | sealed | `0x63682db54b4ce7687c587b837e421f63e6df1722ef3a5da03124dcd59acc706b` |
| dispute, in its own name | stranger | recorded under the stranger's own wallet, which makes it a party | `0xc5e1a87ef4a7e9497ab3ea9b45bbfbd5cff517c9084e5a1872dd4bc407e18587` |
| adjudicate | the same stranger | the request refused above goes through; `vehicle_identity_mismatch` raised, headline `MATERIAL_CONCERN`, no claim `VERIFIED` | `0x0b1d148564f182a27cdf171323460a4437cfadb34ff1a34c044fb238b8180b70` |

*Observed*: the mileage claim derived `PARTIALLY_VERIFIED` / LOW; one of four
voting validators read the invoice against the claim and derived
`INCONCLUSIVE`, under the same headline.

`ac-000001` and `ac-000004` were opened by two earlier runs of this proof
that stopped on mistakes in the test itself. The first expected the
registry's model year to be 2019 and stopped before any wall; the second
passed the same six walls, then compared the dispute's recorded sender in the
wrong letter case. Both remain on chain unfinished.

### A clean record

`ac-000003`, [`web/tests/live/clean-record.test.ts`](web/tests/live/clean-record.test.ts).
The case a buyer hopes to find.

| step | asserted | tx |
|---|---|---|
| open the record | the registry confirms the listed 2003 Honda Accord: `CONFIRMED` | `0x0b1ab1f5f0faaa0fdc622a1554850c9506b31c0171bbb32d7f259a42c9d194ee` |
| the seller's signed invoice | read back from the chain, the signature verifies against the on-chain hashes | `0xb199cd2d4614352425ddafb7c52fb6acff8a91159f0fa5f7466f56773982e9b6` |
| this repository's registry extract | `EXTRACTED` under the rendered text's fingerprint (`4308ed17…682eb6`); the stored text hash recomputes; no uploader, `added_by` the seller | `0xb8b696efe1f5b2c179997a32ee54aad3bc59d3cb8f1df6847abdd89a3aba6afc` |
| seal | the root computed in the app is the root the contract recomputed | `0xfab6d83b965e5de7481a6ebb0f3b3c62109a5a9ef5f858ec02ff5efdce5387c9` |
| adjudicate | mileage claim **`VERIFIED` / HIGH**, supported by `INDEPENDENT` (and `FIRST_PARTY`), nothing against it; headline **`VERIFIED`**; no flag raised | `0x551737441ec1b30e1d83dd8d6d445993c8d0feb2bb8959ef924bdc363bdb9ad5` |

## The independent source, and what hashing it taught

`submit_anchor_item` is the only lane where the contract fetches: every
validator reads the page itself, and the item enters only if the bytes it
hashed match the fingerprint the adder committed.

**The finding.** GenVM's `render(url, mode="text")` does not return a text
file's raw bytes. Its webdriver takes the page's `innerText` and normalizes
whitespace line by line (read from the GenVM source, function
`normalizeWhitespace`). The registry extract committed to this repository has
its readings in columns separated by two spaces, so a fingerprint taken over
the raw file can never match what a validator hashes:

| fingerprint taken over | sha256 | on the deployment of record |
|---|---|---|
| the file's raw bytes | `83a9bc85…fb0e3` | no validator computes it, so a source committed under it enters `SOURCE_UNAVAILABLE` and is never judged |
| the text every validator renders | `4308ed17…682eb6` | the clean record's source entered **`EXTRACTED`** under it (`ac-000003`, tx `0xb8b696ef…a6afc`) |

The file is commit-pinned
([`fixtures/registry/1HGCM82633A004352.txt`](fixtures/registry/1HGCM82633A004352.txt)
at `76a39ee`, a fictional extract the fixture's README explains). The app
fingerprints what the validators will render
([`web/lib/evidence/anchor.ts`](web/lib/evidence/anchor.ts)), and a unit test
pins that function to the digest above. Before NHTSA's host went on the
allowlist, a disposable probe had every validator render this file and
NHTSA's recall list and agree, and the same function reproduced every digest
([PROBE-REPORT, "The render probe"](docs/PROBE-REPORT.md#the-render-probe-14-sep-can-every-validator-read-a-real-authority)).

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
| `pytest tests/direct` | 154 | the whole contract against a runtime-strict stub: every write bound to its signer and each wall named (seal, adjudication, appeal evidence, appeal, slots by side, URL smuggling), floors in both directions including the mirror floor, walls, appeals, forged-leader replays (a fabricated-but-consistent dossier is refused because its quotes do not ground), every equivalence lesson pinned in both directions — decision cut, sufficiency materiality, citation materiality, explanation shadings — and the independent identity check and uploader attestation. The signer walls were mutation-checked (14 of 14 mutants killed), and so was the mirror floor (6 of 6) |
| `cd web && npm run test` | 92 | the browser's half: the independent-source fingerprint pinned to the digest validators computed on chain, each rule of GenVM's whitespace normalization, and code-point capping; NHTSA's recall URL encoded so no listing's words can move it; the manifest root against a golden from the contract's own function; act availability across states × roles (S40) mirroring the contract's signer and slot rules, with every limit read from `get_config()` (13 of 13 mutants killed); the write lifecycle against a fake client — a refusal stopped in the simulation with the contract's sentence and nothing sent, a finalized refusal and an undetermined round reported as such, no finality claimed that was not seen, no zero deposit; read pacing under the RPC's limit; VIN, OBD-II and mileage code; extraction honesty; the chain helpers |
| `AUTOCOURT_LIVE=1 npx vitest run tests/live` | 3 live | the recall record, the wallet walls and the clean record on the deployment of record (above), skipped without the flag |
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
- **The buyer side is first come, first served.** The 3 intake slots every
  non-seller wallet shares, and the 8 disputing accounts, can be filled by
  wallets a seller controls before a genuine buyer arrives. That forges no
  one's name and changes no derivation, but it can keep a buyer's evidence
  out of the first packet; the seller also decides when intake closes.
- **Make matching is deliberately forgiving** ("Mercedes" matches
  "MERCEDES-BENZ"), because a false mismatch accuses an honest seller. An
  abbreviation the registry does not share, "VW" against "VOLKSWAGEN", reads
  as a mismatch, which is why a mismatch caps a claim rather than alleging
  fraud.
- **Wallets are self-attested identity**; the contract's floors, not a login,
  make a second wallet worthless.
- **A recall list speaks for a model year, not a car.** NHTSA's list can
  contradict "no recall was ever issued for this model"; it cannot say
  whether one car's recall was remedied. Every validator hashes the first
  8,000 characters of a source and the panel reads the first 6,000, so a
  long list is judged in part.
- **Extraction reads plain text and PDFs with embedded text.** Scans and
  images enter as fingerprints with no text, and the panel is told so.
- **Commit-pinned GitHub raw stands in for registries** no public API serves,
  and its registry extract is fictional; a production deployment would list
  actual registries beside NHTSA.
